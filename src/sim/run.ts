/**
 * The Run loop: Days chain into Weeks, Upkeep is paid at 24:00, the Daily Quota is checked
 * (one miss loses the Run, ADR 0002) and the Score is kept. RunState is a plain, serializable object.
 */
import { startingAirport, type AirportLayout, type Structure } from './layout';
import { mixSeed } from './random';
import { planDay, type DayPlan } from './schedule';
import { carryOver, createSimulation, stepSimulation, type ScheduledFlight, type Simulation } from './simulation';

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
}

export type RunStatus = 'planning' | 'lost';

export interface RunState {
  readonly seed: number;
  /** 0-based count of Days started. */
  readonly dayIndex: number;
  /** 1-based; Week 5+ is Endless. */
  readonly week: number;
  /** 0 = Monday … 6 = Sunday (Boss Day). */
  readonly weekday: number;
  readonly status: RunStatus;
  readonly layout: AirportLayout;
  /** Land Plots owned, by plot column/row (see WORLD). */
  readonly ownedPlots: readonly LandPlot[];
  readonly towerModules: TowerModules;
  /** 0 = no Fire & Rescue Station. */
  readonly fireRescueLevel: number;
  readonly money: number;
  /** Money below zero: building is blocked until it is paid off. */
  readonly inDebt: boolean;
  readonly crashesThisWeek: number;
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

export const SCORE = { perDay: 1_000, perMovement: 50, milesPerScore: 1 / 100 } as const;

export function startRun(seed: number): RunState {
  return {
    seed,
    dayIndex: 0,
    week: 1,
    weekday: 0,
    status: 'planning',
    layout: startingAirport(),
    ownedPlots: [0, 1, 2].flatMap((px) => [0, 1].map((py) => ({ px, py }))),
    towerModules: { radar: 1, groundRadar: 1, weatherStation: 1, controllerTraining: 1 },
    fireRescueLevel: 0,
    money: STARTING_MONEY,
    inDebt: false,
    crashesThisWeek: 0,
    overnight: [],
    stats: { daysSurvived: 0, movements: 0, fees: 0, spending: 0, crashes: 0, diversions: 0 },
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
  return (
    run.layout.structures.reduce((n, s) => n + structureUpkeep(s), 0) +
    modules * UPKEEP.towerModuleLevel +
    run.fireRescueLevel * UPKEEP.fireRescueLevel
  );
}

export function dayPlan(run: RunState): DayPlan {
  return planDay({ layout: run.layout, week: run.week, weekday: run.weekday, seed: run.seed, includeOvernight: run.dayIndex === 0 });
}

/** The Live Day simulation for the current Day: last night's aircraft plus today's Schedule. */
export function startLiveDay(run: RunState): Simulation {
  const plan = dayPlan(run);
  // On the first Day the Schedule's overnight aircraft stand in for "last night"; afterwards the real ones carry over.
  const today = plan.schedule.map((f) => ({ ...f, id: `D${run.dayIndex + 1}-${f.id}` }));
  return createSimulation({
    layout: run.layout,
    schedule: [...run.overnight, ...today],
    seed: mixSeed(run.seed, run.dayIndex, 0x5eed),
    money: run.money,
    radarLevel: run.towerModules.radar,
    controllerTrainingLevel: run.towerModules.controllerTraining,
    groundRadarLevel: run.towerModules.groundRadar,
    fireRescueLevel: run.fireRescueLevel,
    earlierCrashesThisWeek: run.crashesThisWeek,
  });
}

/** At 24:00: pay Upkeep, check the Daily Quota and move to the next Day (or end the Run). */
export function endDay(run: RunState, sim: Simulation): RunState {
  const quota = dayPlan(run).quota;
  const quotaMet = sim.movements >= quota;
  const cost = upkeep(run);
  const penalties = sim.events.reduce((n, e) => n + e.cost, 0);
  const money = sim.money - cost;
  const report: DayReport = {
    week: run.week, weekday: run.weekday, quota, movements: sim.movements, fees: sim.fees, upkeep: cost, penalties,
    crashes: sim.crashes, diversions: sim.diversions, quotaMet, moneyAfter: money,
  };
  const endOfWeek = run.weekday === 6;
  return {
    ...run,
    status: quotaMet ? 'planning' : 'lost',
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
      spending: run.stats.spending + cost + penalties,
      crashes: run.stats.crashes + sim.crashes,
      diversions: run.stats.diversions + sim.diversions,
    },
    history: [...run.history, report],
  };
}

/** Plays the current Day to the end without any Player input (tests, autoplay). */
export function playDay(run: RunState): RunState {
  let sim = startLiveDay(run);
  while (sim.clock.minute < 24 * 60) sim = stepSimulation(sim);
  return endDay(run, sim);
}

export function runScore(run: RunState): number {
  return run.stats.daysSurvived * SCORE.perDay + run.stats.movements * SCORE.perMovement + run.stats.fees;
}

export function airMiles(run: RunState): number {
  return Math.floor(runScore(run) * SCORE.milesPerScore);
}
