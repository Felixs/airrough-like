/**
 * The Run loop: Days chain into Weeks, Upkeep is paid at 24:00, the Daily Quota is checked
 * (one miss loses the Run, ADR 0002) and the Score is kept. RunState is a plain, serializable object.
 */
import { createLayout, startingAirport, type AirportLayout, type Structure, type SupportRole } from './layout';
import { mixSeed } from './random';
import { WEEKDAY_NAMES, planDay, type DayPlan } from './schedule';
import { FAMILIES, describeTwist, simulationEffects, twistsFor, type Twist } from './twists';
import { createRandom } from './random';
import { emptyMeta, modifiersFrom, type MetaState, type RunModifiers } from './meta';
import { AIRCRAFT_TYPES } from './aircraft';
import { acknowledgeAlert, type DiversionReason, carryOver, createSimulation, daySettled, finishDay, stepSimulation, type ScheduledFlight, type Simulation } from './simulation';

export interface LandPlot {
  readonly px: number;
  readonly py: number;
}

export interface TowerModules {
  readonly radar: number;
  readonly groundRadar: number;
  readonly weatherStation: number;
  readonly controllerTraining: number;
}

export interface RunStats {
  /** Days whose Daily Quota was met. */
  readonly daysSurvived: number;
  readonly movements: number;
  readonly fees: number;
  /** Upkeep, Crash Fines, Incident costs and building. */
  readonly spending: number;
  readonly crashes: number;
  readonly diversions: number;
  readonly largeLandings: number;
  /** Extra Score from Bonus Twists. */
  readonly bonusScore?: number;
}

export interface DayReport {
  readonly week: number;
  readonly weekday: number;
  readonly quota: number;
  readonly movements: number;
  readonly fees: number;
  readonly upkeep: number;
  /** Crash Fines and Incident costs. */
  readonly penalties: number;
  readonly crashes: number;
  readonly diversions: number;
  readonly quotaMet: boolean;
  readonly moneyAfter: number;
  /** Fees minus Upkeep, Crash Fines and Incident costs. */
  readonly net: number;
  /** Aircraft that landed today, by Purpose. */
  readonly landed: { readonly passenger: number; readonly cargo: number };
  readonly diversionsByReason: Readonly<Record<DiversionReason, number>>;
  /** Hour with the most Movements. */
  readonly busiestHour: number;
  /** Crashes and Incidents, in order. */
  readonly highlights: readonly DayHighlight[];
}

export interface DayHighlight {
  readonly minute: number;
  readonly kind: 'crash' | 'incident' | 'taxiIncident';
  readonly callsign: string;
  readonly aircraft: string;
  readonly cost: number;
}

export type RunStatus = 'planning' | 'lost' | 'won';

/** Surviving this many Weeks wins the Run. */
export const WEEKS_TO_WIN = 4;

export interface RunState {
  readonly seed: number;
  /** 0-based count of Days started. */
  readonly dayIndex: number;
  /** 1-based; Week 5+ is Endless. */
  readonly week: number;
  /** 0 = Monday … 6 = Sunday (Boss Day). */
  readonly weekday: number;
  readonly status: RunStatus;
  /** Continuing after a win, until a Daily Quota is missed. */
  readonly endless: boolean;
  readonly layout: AirportLayout;
  /** Land Plots owned, by plot column/row (see WORLD). */
  readonly ownedPlots: readonly LandPlot[];
  /** Land Plots the Run started with (they don't count towards the next plot's price). */
  readonly startingPlots: number;
  /** Boosts and Unlockables from meta-progression, fixed when the Run starts. */
  readonly modifiers: RunModifiers;
  readonly towerModules: TowerModules;
  /** 0 = no Fire & Rescue Station. */
  readonly fireRescueLevel: number;
  readonly money: number;
  /** Money below zero: building is blocked until it is paid off. */
  readonly inDebt: boolean;
  readonly crashesThisWeek: number;
  /** The next Day carries a Bonus Twist for extra Score. */
  readonly bonusTwist: boolean;
  /** Aircraft left on the ground last night. */
  readonly overnight: readonly ScheduledFlight[];
  readonly stats: RunStats;
  readonly history: readonly DayReport[];
}

/** Daily Upkeep *(first guess)*. */
export const UPKEEP = {
  runway: { short: 300, medium: 600, long: 1_200 },
  surface: { grass: 0, asphalt: 0, lit: 300, ils: 600 },
  stand: { small: 50, medium: 100, large: 200 },
  holdingBay: { small: 30, medium: 60, large: 120 },
  /** Per Tower Module level above 1. */
  towerModuleLevel: 150,
  /** Per Fire & Rescue Station level. */
  fireRescueLevel: 150,
  supportBuilding: 200,
  taxiwayPerTile: 2,
} as const;

export const STARTING_MONEY = 30_000;

export const SCORE = { perDay: 1_000, perMovement: 50, milesPerScore: 1 / 1_000 } as const;

export function startRun(seed: number, meta: MetaState = emptyMeta()): RunState {
  const lvl = (id: keyof MetaState['boosts']) => meta.boosts[id] ?? 0;
  const plots: LandPlot[] = [0, 1, 2].flatMap((px) => [0, 1].map((py) => ({ px, py })));
  if (lvl('largerStartingLand')) plots.push({ px: 3, py: 0 });
  const run = baseRun(seed);
  const layout = lvl('startingHoldingBay')
    ? createLayout(run.layout.width, run.layout.height, [
      ...run.layout.structures, { kind: 'holdingBay', id: 'B2', x: 34, y: 6, w: 3, h: 3, size: 'medium' },
    ])
    : run.layout;
  return {
    ...run,
    layout,
    money: run.money + 15_000 * lvl('startingMoney'),
    ownedPlots: plots,
    startingPlots: plots.length,
    towerModules: { ...run.towerModules, radar: 1 + lvl('betterStartingRadar') },
    modifiers: modifiersFrom(meta),
  };
}

function baseRun(seed: number): RunState {
  return {
    seed,
    dayIndex: 0,
    week: 1,
    weekday: 0,
    status: 'planning',
    endless: false,
    bonusTwist: false,
    layout: startingAirport(),
    ownedPlots: [0, 1, 2].flatMap((px) => [0, 1].map((py) => ({ px, py }))),
    startingPlots: 6,
    modifiers: modifiersFrom(emptyMeta()),
    towerModules: { radar: 1, groundRadar: 1, weatherStation: 1, controllerTraining: 1 },
    fireRescueLevel: 0,
    money: STARTING_MONEY,
    inDebt: false,
    crashesThisWeek: 0,
    overnight: [],
    stats: { daysSurvived: 0, movements: 0, fees: 0, spending: 0, crashes: 0, diversions: 0, largeLandings: 0 },
    history: [],
  };
}

function structureUpkeep(s: Structure): number {
  switch (s.kind) {
    case 'runway':
      return UPKEEP.runway[s.length] + UPKEEP.surface[s.surface];
    case 'stand':
      return UPKEEP.stand[s.size];
    case 'holdingBay':
      return UPKEEP.holdingBay[s.size];
    case 'supportBuilding':
      return UPKEEP.supportBuilding;
    case 'taxiway':
      return UPKEEP.taxiwayPerTile * s.w * s.h;
    default:
      return 0;
  }
}

export function upkeep(run: RunState): number {
  const modules = Object.values(run.towerModules).reduce((n, level) => n + Math.max(0, level - 1), 0);
  const total = run.layout.structures.reduce((n, s) => n + structureUpkeep(s), 0) +
    modules * UPKEEP.towerModuleLevel +
    run.fireRescueLevel * UPKEEP.fireRescueLevel;
  return Math.round(total * (run.modifiers?.upkeepFactor ?? 1));
}

/** The current Day's Twists (Endless Boss Days stack several). */
export function dayTwists(run: RunState): Twist[] {
  const twists = twistsFor(run.seed, run.week, run.weekday);
  return run.bonusTwist ? [...twists, bonusTwistFor(run.seed, run.week, run.weekday, twists)] : twists;
}

/** Bonus Twists (Unlockable): extra Score for meeting the Quota with an extra Twist. */
export const BONUS_TWIST_SCORE_PER_WEEK = 3_000;

/** Whether the next Day can take a Bonus Twist (weekdays only, once unlocked). */
export function canTakeBonusTwist(run: RunState): boolean {
  return run.modifiers.unlocks.includes('bonusTwists') && run.weekday < 5;
}

/** Plan Mode toggle for the next Day's Bonus Twist. */
export function setBonusTwist(run: RunState, on: boolean): RunState {
  return { ...run, bonusTwist: on && canTakeBonusTwist(run) };
}

/** Whether a Support Building of this kind is placed. */
export const hasBuilding = (run: RunState, role: SupportRole) => run.layout.structures.some((s) => s.kind === 'supportBuilding' && s.role === role);

/** The current Day's first Twist, if any. */
export function dayTwist(run: RunState): Twist | null {
  return dayTwists(run)[0] ?? null;
}

export function dayPlan(run: RunState): DayPlan {
  return planDay({
    layout: run.layout, week: run.week, weekday: run.weekday, seed: run.seed, includeOvernight: run.dayIndex === 0, twist: dayTwists(run),
  });
}

/** The Live Day simulation for the current Day: last night's aircraft plus today's Schedule. */
export function startLiveDay(run: RunState): Simulation {
  const plan = dayPlan(run);
  // On the first Day the Schedule's overnight aircraft stand in for "last night"; afterwards the real ones carry over.
  const today = plan.schedule.map((f) => ({ ...f, id: `D${run.dayIndex + 1}-${f.id}` }));
  const effects = simulationEffects(dayTwists(run), mixSeed(run.seed, run.dayIndex), run.towerModules.weatherStation, hasBuilding(run, 'deIcingPad'));
  return createSimulation({
    wind: { seed: mixSeed(run.seed, run.dayIndex, 0x3171d), shifts: effects.windShifts },
    riskMultiplier: effects.riskMultiplier,
    windows: effects.windows,
    noLights: effects.noLights,
    taxiSpeedFactor: effects.taxiSpeedFactor,
    layout: run.layout,
    schedule: [...run.overnight, ...today],
    seed: mixSeed(run.seed, run.dayIndex, 0x5eed),
    money: run.money,
    radarLevel: run.towerModules.radar,
    controllerTrainingLevel: run.towerModules.controllerTraining,
    groundRadarLevel: run.towerModules.groundRadar,
    fireRescueLevel: run.fireRescueLevel,
    earlierCrashesThisWeek: run.crashesThisWeek,
    pauseOnEvents: true,
    feeFactor: run.modifiers.feeFactor,
    fuelBonusMinutes: run.modifiers.fuelBonusMinutes + (hasBuilding(run, 'fuelFarm') ? 5 : 0),
    turnaroundFactor: run.modifiers.turnaroundFactor,
    cargoNightTurnaroundFactor: run.modifiers.unlocks.includes('cargoApronLighting') ? 0.8 : 1,
    crashFineFactor: run.modifiers.crashFineFactor,
    blockageFactor: run.modifiers.blockageFactor,
    cooldownFactor: run.modifiers.cooldownFactor,
  });
}

/** At 24:00: pay Upkeep, check the Daily Quota and move to the next Day (or end the Run). */
export function endDay(run: RunState, sim: Simulation): RunState {
  const quota = dayPlan(run).quota;
  const quotaMet = sim.movements >= quota;
  const endOfWeek = run.weekday === 6;
  const cost = upkeep(run);
  const penalties = sim.events.reduce((n, e) => n + e.cost, 0);
  const money = sim.money - cost;
  const byId = new Map(sim.flights.map((f) => [f.id, f]));
  const diversionsByReason: Record<DiversionReason, number> = { curfew: 0, dark: 0, noRunway: 0, manual: 0 };
  for (const e of sim.events) if (e.kind === 'diversion') diversionsByReason[e.reason ?? 'noRunway']++;
  const landed = { passenger: 0, cargo: 0 };
  for (const f of sim.flights) {
    if (f.landedSeq > 0 && !['holding', 'landing', 'crashed', 'diverted'].includes(f.phase)) landed[AIRCRAFT_TYPES[f.type].purpose]++;
  }
  const highlights: DayHighlight[] = sim.events
    .filter((e): e is typeof e & { kind: DayHighlight['kind'] } => e.kind === 'crash' || e.kind === 'incident' || e.kind === 'taxiIncident')
    .map((e) => ({ minute: e.minute, kind: e.kind, callsign: byId.get(e.flightId)?.callsign ?? e.flightId, aircraft: byId.get(e.flightId)?.type ?? '', cost: e.cost }));
  const report: DayReport = {
    week: run.week, weekday: run.weekday, quota, movements: sim.movements, fees: sim.fees, upkeep: cost, penalties,
    crashes: sim.crashes, diversions: sim.diversions, quotaMet, moneyAfter: money, net: sim.fees - cost - penalties,
    landed, diversionsByReason, busiestHour: sim.movementsByHour.indexOf(Math.max(...sim.movementsByHour)), highlights,
  };
  const won = quotaMet && !run.endless && endOfWeek && run.week === WEEKS_TO_WIN;
  return {
    ...run,
    bonusTwist: false,
    status: !quotaMet ? 'lost' : won ? 'won' : 'planning',
    dayIndex: run.dayIndex + 1,
    week: endOfWeek ? run.week + 1 : run.week,
    weekday: endOfWeek ? 0 : run.weekday + 1,
    money,
    inDebt: money < 0,
    crashesThisWeek: endOfWeek ? 0 : run.crashesThisWeek + sim.crashes,
    overnight: carryOver(sim),
    stats: {
      daysSurvived: run.stats.daysSurvived + (quotaMet ? 1 : 0),
      movements: run.stats.movements + sim.movements,
      fees: run.stats.fees + sim.fees,
      bonusScore: (run.stats.bonusScore ?? 0) + (run.bonusTwist && quotaMet ? BONUS_TWIST_SCORE_PER_WEEK * run.week : 0),
      spending: run.stats.spending + cost + penalties,
      crashes: run.stats.crashes + sim.crashes,
      diversions: run.stats.diversions + sim.diversions,
      largeLandings: run.stats.largeLandings + sim.flights.filter((f) =>
        AIRCRAFT_TYPES[f.type].size === 'large' && f.landedSeq > 0 && f.phase !== 'holding' && f.phase !== 'landing' && f.phase !== 'crashed' && f.phase !== 'diverted').length,
    },
    history: [...run.history, report],
  };
}

/** After a win: keep playing into Endless Mode. */
export function continueEndless(run: RunState): RunState {
  if (run.status !== 'won') return run;
  return { ...run, status: 'planning', endless: true };
}

/** Plays the current Day to the end without any Player input (tests, autoplay). */
export function playDay(run: RunState): RunState {
  let sim = startLiveDay(run);
  while (sim.clock.minute < 24 * 60) sim = sim.pendingAlert ? acknowledgeAlert(sim) : daySettled(sim) ? finishDay(sim) : stepSimulation(sim);
  return endDay(run, sim);
}

export function runScore(run: RunState): number {
  return run.stats.daysSurvived * SCORE.perDay + run.stats.movements * SCORE.perMovement + run.stats.fees + (run.stats.bonusScore ?? 0);
}

export function airMiles(run: RunState): number {
  return Math.floor(runScore(run) * SCORE.milesPerScore);
}

function bonusTwistFor(seed: number, week: number, weekday: number, existing: readonly Twist[]): Twist {
  const rng = createRandom(mixSeed(seed, week, weekday, 0xb0b));
  const families = FAMILIES.filter((f) => !existing.some((t) => t.family === f));
  return describeTwist({ family: rng.pick(families.length ? families : FAMILIES), severity: Math.min(3, week + 1) }, false);
}

/** One line that pins down where a Run is, for bug reports: replay with the same seed (`?seed=` or the Main Menu). */
export function runInfo(run: RunState, build: string): string {
  return `Seed ${run.seed} · Week ${run.week} · ${WEEKDAY_NAMES[run.weekday]} · Day ${run.dayIndex + 1}${run.endless ? ' · Endless' : ''} · build ${build}`;
}

/** Reads a seed typed by the Player ("42", "Seed 42"); null when there is none. */
export function parseSeed(text: string | null | undefined): number | null {
  const n = Number((text ?? '').replace(/[^0-9]/g, ''));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
