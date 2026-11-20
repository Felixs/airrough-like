/**
 * Plan Mode between Days: the Run Calendar, the Forecast, suggestions, and upgrades that need no placing
 * (Tower Modules, Runway Surface, Fire & Rescue levels).
 */
import type { RunwaySurface, Structure } from './layout';
import { airportSurface, createLayout } from './layout';
import { dayPlan, hasBuilding, upkeep, type DayReport, type RunState, type TowerModules } from './run';
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

export function suggestions(run: RunState): Suggestion[] {
  const forecast = dayPlan(run).forecast;
  const out: Suggestion[] = [];
  const surface = airportSurface(run.layout);
  if (forecast.turnedAway.noFittingRunway > 0) out.push({ text: `${forecast.turnedAway.noFittingRunway} flights need a longer Runway`, upgrade: null });
  // say which Stands are missing: by size and by building
  const SIZE_WORD = { small: 'Small', medium: 'Medium', large: 'Large' } as const;
  const groups = (reason: 'noFittingStand' | 'standCapacity') => forecast.turnedAwayDetail.filter((d) => d.reason === reason)
    .map((d) => `${d.count} ${SIZE_WORD[d.size]} ${d.purpose}`).join(', ');
  const building = (reason: 'noFittingStand' | 'standCapacity') => {
    const kinds = new Set(forecast.turnedAwayDetail.filter((d) => d.reason === reason).map((d) => d.purpose === 'passenger' ? 'Terminal' : 'Cargo Hub'));
    return [...kinds].join(' and ');
  };
  if (forecast.turnedAway.noFittingStand > 0) {
    out.push({ text: `${forecast.turnedAway.noFittingStand} flights won't come because no Stand is big enough for them (${groups('noFittingStand')}). Build a ${building('noFittingStand')} Stand of that size or larger.`, upgrade: null });
  }
  if (forecast.turnedAway.standCapacity > 0) {
    out.push({ text: `${forecast.turnedAway.standCapacity} flights won't come because the Stands that fit them are booked up for the Day (${groups('standCapacity')}). A Stand takes about 10 Small, 8 Medium or 6 Large arrivals a Day; more ${building('standCapacity')} Stands of those sizes let them come.`, upgrade: null });
  }
  if (surface === 'grass' || surface === 'asphalt') out.push({ text: 'A Lit Runway stops evening flights diverting at 20:00', upgrade: 'surface' });
  if (run.towerModules.radar < 3) out.push({ text: 'Radar 3 unlocks Emergency Alerts before a Crash', upgrade: 'radar' });
  if (run.fireRescueLevel === 0) out.push({ text: 'A Fire & Rescue Station clears Crashes faster', upgrade: 'fireRescue' });
  return out.slice(0, 4);
}
