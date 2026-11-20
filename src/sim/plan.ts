/**
 * Plan Mode between Days: the Run Calendar, the Forecast, suggestions, and upgrades that need no placing
 * (Tower Modules, Runway Surface, Fire & Rescue levels).
 */
import type { RunwaySurface, SizeClass, Structure } from './layout';
import { airportSurface, createLayout } from './layout';
import { dayPlan, hasBuilding, upkeep, type DayReport, type RunState, type TowerModules } from './run';
import { AIRCRAFT_TYPES, type Purpose } from './aircraft';
import { HOURS } from './simulation';
import { BOSS_DAY, RUSH_DAY, planDay } from './schedule';
import { twistsFor, type Twist } from './twists';
import { unlockableName, type UnlockableId } from './meta';

/** Prices *(first guess)*. */
export const PRICES = {
  /** Tower Module upgrade: this × current level. */
  towerModulePerLevel: 12_000,
  surface: { asphalt: 16_000, lit: 30_000, ils: 80_000 },
  /** Fire & Rescue Station level n costs this × n. */
  fireRescuePerLevel: 15_000,
  maxLevel: 5,
} as const;

const SURFACE_ORDER: readonly RunwaySurface[] = ['grass', 'asphalt', 'lit', 'ils'];
const SURFACE_NAME: Record<RunwaySurface, string> = { grass: 'Grass', asphalt: 'Asphalt', lit: 'Lit', ils: 'ILS' };
const MODULE_NAME: Record<keyof TowerModules, string> = {
  radar: 'Radar', groundRadar: 'Ground Radar', weatherStation: 'Weather Station', controllerTraining: 'Controller Training',
};
const MODULE_EFFECT: Record<keyof TowerModules, string> = {
  radar: 'More aircraft airborne before ATC Errors rise; shorter Runway Separation; Emergency Alerts at 3–4',
  groundRadar: 'Fewer Taxiway Incidents',
  weatherStation: 'Handles storms better',
  controllerTraining: 'Lower ATC Error chance; shorter Runway Separation; better second rolls',
};

export type UpgradeId = keyof TowerModules | 'surface' | 'fireRescue';

export interface UpgradeOffer {
  readonly id: UpgradeId;
  readonly label: string;
  readonly effect: string;
  readonly level: number;
  readonly nextLevel: number | null;
  readonly cost: number;
  /** Daily Upkeep added by buying it. */
  readonly upkeepDelta: number;
  readonly available: boolean;
  readonly reason: string | null;
}

function applyUpgrade(run: RunState, id: UpgradeId): RunState {
  if (id === 'surface') {
    // airport-wide: every Runway gets the next surface (Grass strips stay Grass once the airport is paved)
    const current = airportSurface(run.layout);
    const next = SURFACE_ORDER[SURFACE_ORDER.indexOf(current) + 1]!;
    const structures = run.layout.structures.map((s): Structure =>
      (s.kind === 'runway' && (s.surface !== 'grass' || current === 'grass') ? { ...s, surface: next } : s));
    return { ...run, layout: createLayout(run.layout.width, run.layout.height, structures) };
  }
  if (id === 'fireRescue') return { ...run, fireRescueLevel: run.fireRescueLevel + 1 };
  return { ...run, towerModules: { ...run.towerModules, [id]: run.towerModules[id] + 1 } };
}

/** Unlockable (or building) needed for an upgrade level, if any. */
function lockFor(run: RunState, id: UpgradeId, nextLevel: number): string | null {
  const has = (u: UnlockableId) => run.modifiers.unlocks.includes(u);
  if (id !== 'surface' && id !== 'fireRescue' && nextLevel >= 4 && !has('towerLevel45')) return `🔒 Needs Unlockable: ${unlockableName('towerLevel45')}`;
  if (id === 'fireRescue' && !has('fireRescueStation')) return `🔒 Needs Unlockable: ${unlockableName('fireRescueStation')}`;
  if (id === 'fireRescue' && !hasBuilding(run, 'fireRescueStation')) return 'Place a Fire & Rescue Station in Build Mode first';
  return null;
}

export function upgradeOffers(run: RunState): UpgradeOffer[] {
  const make = (id: UpgradeId, label: string, effect: string, level: number, maxed: boolean, cost: number): UpgradeOffer => {
    const locked = maxed ? null : lockFor(run, id, level + 1);
    const reason = maxed ? 'Max level' : locked ? locked : run.inDebt ? 'In Debt: pay it off first' : run.money < cost ? 'Not enough Money' : null;
    return {
      id, label, effect, level, nextLevel: maxed ? null : level + 1, cost,
      upkeepDelta: maxed ? 0 : upkeep(applyUpgrade(run, id)) - upkeep(run), available: reason === null, reason,
    };
  };
  const modules = (Object.keys(MODULE_NAME) as Array<keyof TowerModules>).map((id) => {
    const level = run.towerModules[id];
    return make(id, `${MODULE_NAME[id]} ${Math.min(level + 1, PRICES.maxLevel)}`, MODULE_EFFECT[id], level, level >= PRICES.maxLevel, PRICES.towerModulePerLevel * level);
  });
  const surface = airportSurface(run.layout);
  const next = SURFACE_ORDER[SURFACE_ORDER.indexOf(surface) + 1];
  const surfaceOffer = make(
    'surface', next ? `Runway Surface: ${SURFACE_NAME[next]}` : `Runway Surface: ${SURFACE_NAME[surface]}`,
    (next === 'lit' ? 'Night operations after 20:00 (no dusk Diversions)' : next === 'ils' ? 'Bad-weather landings; Pilot Error ×0.6' : 'Medium and Large aircraft, daylight')
      + (next && next !== 'asphalt' && run.layout.runways.some((r) => r.surface === 'grass') ? '. Grass strips stay grass' : ''),
    SURFACE_ORDER.indexOf(surface), !next, next ? PRICES.surface[next as keyof typeof PRICES.surface] : 0,
  );
  const fire = run.fireRescueLevel;
  const fireOffer = make(
    'fireRescue', `Fire & Rescue ${Math.min(fire + 1, PRICES.maxLevel)}`,
    'Crashes and Incidents block the Runway for less time', fire, fire >= PRICES.maxLevel, PRICES.fireRescuePerLevel * (fire + 1),
  );
  return [surfaceOffer, ...modules, fireOffer];
}

export function buyUpgrade(run: RunState, id: UpgradeId): RunState {
  const offer = upgradeOffers(run).find((o) => o.id === id);
  if (!offer || !offer.available) throw new Error(offer?.reason ?? 'Unknown upgrade');
  const after = applyUpgrade(run, id);
  return { ...after, money: run.money - offer.cost, stats: { ...run.stats, spending: run.stats.spending + offer.cost } };
}

// ---------------------------------------------------------------- Run Calendar

export interface CalendarDay {
  readonly weekday: number;
  readonly demand: number;
  readonly quota: number;
  readonly rush: boolean;
  readonly boss: boolean;
  readonly state: 'done' | 'today' | 'upcoming' | 'locked';
  readonly result: DayReport | null;
  /** Shown from the start of its Week; null on locked Weeks. */
  readonly twist: Twist | null;
  /** All Twists (Endless Boss Days stack several). */
  readonly twists: readonly Twist[];
}

export interface CalendarWeek {
  readonly week: number;
  readonly locked: boolean;
  readonly days: readonly CalendarDay[];
}

/** Four Weeks (or the current Endless Week); only the current Week is open. */
export function runCalendar(run: RunState): CalendarWeek[] {
  const weeks = run.week <= 4 ? [1, 2, 3, 4] : [run.week];
  return weeks.map((week) => {
    const locked = week > run.week;
    const days = [0, 1, 2, 3, 4, 5, 6].map((weekday): CalendarDay => {
      const twists = locked ? [] : twistsFor(run.seed, week, weekday);
      const twist = twists[0] ?? null;
      const plan = planDay({ layout: run.layout, week, weekday, seed: run.seed, twist: twists });
      const result = run.history.find((h) => h.week === week && h.weekday === weekday) ?? null;
      const state = locked ? 'locked' : result ? 'done' : week === run.week && weekday === run.weekday ? 'today' : week < run.week ? 'done' : 'upcoming';
      return { weekday, demand: plan.demand, quota: plan.quota, rush: weekday === RUSH_DAY, boss: weekday === BOSS_DAY, state, result, twist, twists };
    });
    return { week, locked, days };
  });
}

// ---------------------------------------------------------------- Suggestions

export interface Suggestion {
  readonly text: string;
  readonly upgrade: UpgradeId | null;
}

/** Tips that are not about money lost tomorrow (those are Money Warnings). */
export function suggestions(run: RunState): Suggestion[] {
  const out: Suggestion[] = [];
  const surface = airportSurface(run.layout);
  if (surface === 'grass' || surface === 'asphalt') out.push({ text: 'A Lit Runway lets aircraft land and take off after 20:00', upgrade: 'surface' });
  if (run.towerModules.radar < 3) out.push({ text: 'Radar 3 unlocks Emergency Alerts before a Crash', upgrade: 'radar' });
  if (run.fireRescueLevel === 0) out.push({ text: 'A Fire & Rescue Station clears Crashes and Incidents faster', upgrade: 'fireRescue' });
  return out.slice(0, 4);
}

/** Something about the airport that will cost money (or the Run) on the next Day, with what it costs and the fix. */
export interface MoneyWarning {
  readonly severity: 'critical' | 'warn';
  /** What kind of problem, for its icon: the Quota, Stands, Runway length, darkness. */
  readonly kind: 'quota' | 'stands' | 'runway' | 'dark';
  readonly title: string;
  readonly detail: string;
  /** Fees lost (Arrival + Departure) on the next Day, roughly; 0 when not about fees. */
  readonly lost: number;
  readonly fix: string;
  /** An upgrade that fixes it, offered as a button; otherwise the fix is in Build Mode. */
  readonly upgrade: UpgradeId | null;
}

const SIZE_WORD = { small: 'Small', medium: 'Medium', large: 'Large' } as const;
/** The average fee of the Aircraft Types of one Size Class and Purpose. */
function typicalFee(size: SizeClass, purpose: Purpose, factor: number): number {
  const types = Object.values(AIRCRAFT_TYPES).filter((t) => t.size === size && t.purpose === purpose);
  return types.length ? (types.reduce((n, t) => n + t.fee, 0) / types.length) * factor : 0;
}

/**
 * What will lose money on the next Day, worst first: a Quota the Schedule can't reach, flights turned away (no
 * Runway long enough, no Stand big enough, Stands booked up), and evening arrivals that divert at dusk without a Lit
 * Runway. Each says roughly how much it costs (Arrival + Departure Fees of the flights lost) and what fixes it.
 */
export function moneyWarnings(run: RunState): MoneyWarning[] {
  const plan = dayPlan(run);
  const f = plan.forecast;
  const fee = (size: SizeClass, purpose: Purpose) => typicalFee(size, purpose, run.modifiers.feeFactor) * 2;
  const out: MoneyWarning[] = [];
  if (f.maxMovements < f.quota) {
    out.push({
      severity: 'critical', kind: 'quota', title: `The Quota can't be met: at most ${f.maxMovements} of ${f.quota} Movements`,
      detail: `Only ${f.demand - f.turnedAway.total} of ${f.demand} flights can come to the airport as it is, so even a perfect Day falls short and loses the Run.`,
      lost: 0, fix: 'Build Stands (or a longer Runway) so the flights below can come.', upgrade: null,
    });
  }
  const list = (ds: typeof f.turnedAwayDetail) => ds.map((d) => `${d.count} ${SIZE_WORD[d.size]}`).join(', ');
  for (const purpose of ['passenger', 'cargo'] as const) {
    const building = purpose === 'passenger' ? 'Terminal' : 'Cargo Hub';
    const of = (reason: string) => f.turnedAwayDetail.filter((d) => d.purpose === purpose && d.reason === reason);
    const lost = (ds: typeof f.turnedAwayDetail) => Math.round(ds.reduce((n, d) => n + d.count * fee(d.size, d.purpose), 0));
    const count = (ds: typeof f.turnedAwayDetail) => ds.reduce((n, d) => n + d.count, 0);
    const runway = of('noFittingRunway');
    if (runway.length) {
      const biggest = runway.some((d) => d.size === 'large') ? 'Long' : 'Medium';
      out.push({
        severity: 'warn', kind: 'runway', title: `${count(runway)} ${purpose} flights won't come: no Runway long enough`,
        detail: `${list(runway)} aircraft need a longer Runway than the airport has.`, lost: lost(runway),
        fix: `Build or lengthen a Runway to ${biggest}.`, upgrade: null,
      });
    }
    const noStand = of('noFittingStand');
    if (noStand.length) {
      out.push({
        severity: 'warn', kind: 'stands', title: `${count(noStand)} ${purpose} flights won't come: no ${building} Stand big enough`,
        detail: `${list(noStand)} aircraft have no ${building} Stand of their size or larger.`, lost: lost(noStand),
        fix: `Build a ${SIZE_WORD[noStand.some((d) => d.size === 'large') ? 'large' : 'medium']} ${building} Stand.`, upgrade: null,
      });
    }
    const full = of('standCapacity');
    if (full.length) {
      out.push({
        severity: 'warn', kind: 'stands', title: `${count(full)} ${purpose} flights won't come: ${building} Stands booked up`,
        detail: `${list(full)} aircraft find every fitting ${building} Stand full for the Day (a Stand takes about 10 Small, 8 Medium or 6 Large arrivals).`,
        lost: lost(full), fix: `Build more ${building} Stands of those sizes (or larger).`, upgrade: null,
      });
    }
  }
  const fits = { short: 1, medium: 2, long: 3 } as const;
  const rank = { small: 1, medium: 2, large: 3 } as const;
  const nightFor = (size: SizeClass) => run.layout.runways.some((r) => (r.surface === 'lit' || r.surface === 'ils') && fits[r.length] >= rank[size]);
  const late = plan.schedule.filter((s) => !s.overnight && s.arrivalMinute >= HOURS.dusk && !nightFor(AIRCRAFT_TYPES[s.type].size));
  if (late.length) {
    out.push({
      severity: 'warn', kind: 'dark', title: `${late.length} evening flights will divert: no Lit Runway after 20:00`,
      detail: 'Flights arriving after dusk can only land on a Lit or ILS Runway; without one they leave for another airport.',
      lost: Math.round(late.reduce((n, s) => n + AIRCRAFT_TYPES[s.type].fee * run.modifiers.feeFactor * 2, 0)),
      fix: 'Buy the Lit Runway Surface.', upgrade: 'surface',
    });
  }
  return out.sort((a, b) => Number(b.severity === 'critical') - Number(a.severity === 'critical') || b.lost - a.lost);
}
