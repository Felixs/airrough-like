/**
 * Balance lab: scripted players. Each one plays Plan Mode by a fixed policy (the Live Day plays itself, as for a real
 * Player who uses no Emergency Actions), so the lab can ask how a kind of player fares under some tuning.
 *
 * - idle: never builds or buys anything.
 * - reactive: fixes what tomorrow's Money Warnings point at, when it has the money; little else.
 * - planner: the "expert" reference. Looks three Days ahead (and at the Week's Boss Day) and builds Stands for every
 *   flight that would be turned away, a longer Runway for Large aircraft, Lit before evening flights divert and ILS
 *   before an ILS-only storm, a Holding Bay per size, Radar 3 and Controller Training; keeps two Days of Upkeep back.
 * - random: each Day, with even odds, does one random affordable thing (a Stand, a pier, a longer Runway, an upgrade).
 */
import { AIRCRAFT_TYPES, type Purpose } from '../aircraft';
import { confirmBuild, openBuild, type BuildSession } from '../build';
import type { SizeClass } from '../layout';
import { createRandom, mixSeed } from '../random';
import { buyUpgrade, moneyWarnings, upgradeOffers, type UpgradeId } from '../plan';
import { dayPlan, upkeep, type RunState } from '../run';
import { SCHEDULE_RULES } from '../schedule';
import { twistsFor } from '../twists';
import { buildParallelRunway, buildPier, lengthenRunway, placeHoldingBay, placeStand } from './placer';

/** About how many Movements a Day one Runway can carry with the planner's Tower (found with the lab). */
export const RUNWAY_QUOTA = 130;

/** One thing a player paid for, for the report. */
export interface Purchase {
  readonly day: number;
  readonly what: string;
  readonly cost: number;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  /** Plays Plan Mode before a Day; records what it bought in `log`. */
  plan(run: RunState, log: Purchase[]): RunState;
}

/** What a player may still spend: the money minus what it keeps back. */
const spendable = (run: RunState, reserve: number) => Math.max(0, run.money - reserve);

/** Opens a build session that may only spend `budget` (the rest of the money is kept back). */
function budgetSession(run: RunState, budget: number): BuildSession {
  return openBuild({ ...run, money: budget });
}

/** Confirms a session opened by budgetSession and puts the money kept back into the Run again. */
function confirmWithin(run: RunState, s: BuildSession, log: Purchase[], what: string): RunState {
  if (!s.pending.length) return run;
  const after = confirmBuild(s);
  const cost = s.pending.reduce((n, p) => n + p.cost, 0);
  log.push({ day: run.dayIndex, what, cost });
  return { ...after, money: run.money - cost };
}

/** The Run as it will be `ahead` Days from now (same airport), to read that Day's Schedule. */
export function daysAhead(run: RunState, ahead: number): RunState {
  const index = run.weekday + ahead;
  return { ...run, week: run.week + Math.floor(index / 7), weekday: index % 7, dayIndex: run.dayIndex + ahead, bonusTwist: false };
}

/** Stands to add, by size and Purpose, so that no flight in the next `days` Days is turned away for want of a Stand. */
export function standsNeeded(run: RunState, days: readonly number[]): Map<string, { size: SizeClass; purpose: Purpose; stands: number }> {
  const out = new Map<string, { size: SizeClass; purpose: Purpose; stands: number }>();
  for (const d of days) {
    for (const t of dayPlan(daysAhead(run, d)).forecast.turnedAwayDetail) {
      if (t.reason === 'noFittingRunway') continue;
      const stands = Math.ceil(t.count / SCHEDULE_RULES.arrivalsPerStand[t.size]);
      const key = `${t.size}/${t.purpose}`;
      if ((out.get(key)?.stands ?? 0) < stands) out.set(key, { size: t.size, purpose: t.purpose, stands });
    }
  }
  return out;
}

/** Whether Large aircraft would be turned away for want of a long enough Runway in the next Days. */
function needsLongerRunway(run: RunState, days: readonly number[]): boolean {
  return days.some((d) => dayPlan(daysAhead(run, d)).forecast.turnedAway.noFittingRunway > 0);
}

/** Adds one Stand of this size for this Purpose: where one fits, else on a new pier. */
function addStand(run: RunState, budget: number, size: SizeClass, purpose: Purpose, log: Purchase[]): RunState | null {
  const serves = purpose === 'passenger' ? 'terminal' : 'cargoHub';
  const s = budgetSession(run, budget);
  const direct = placeStand(s, size, serves, run.modifiers.unlocks.includes('remoteStands'));
  if (direct) return confirmWithin(run, direct, log, `${size} ${purpose} Stand`);
  const pier = buildPier(s, serves);
  const onPier = pier && placeStand(pier, size, serves, false);
  if (onPier) return confirmWithin(run, onPier, log, `${serves === 'terminal' ? 'Terminal' : 'Cargo'} pier + ${size} Stand`);
  return null;
}

function tryUpgrade(run: RunState, id: UpgradeId, budget: number, log: Purchase[]): RunState | null {
  const offer = upgradeOffers(run).find((o) => o.id === id);
  if (!offer?.available || offer.cost > budget) return null;
  const after = buyUpgrade(run, id);
  log.push({ day: run.dayIndex, what: `upgrade ${id} ${offer.nextLevel}`, cost: offer.cost });
  return after;
}

const level = (run: RunState, id: UpgradeId) => upgradeOffers(run).find((o) => o.id === id)?.level ?? 0;

export const idle: Player = { id: 'idle', name: 'Idle (builds nothing)', plan: (run) => run };

export const reactive: Player = {
  id: 'reactive',
  name: 'Reactive (fixes tomorrow’s warnings)',
  plan(run, log) {
    const reserve = upkeep(run) + 5_000;
    for (let guard = 0; guard < 8; guard++) {
      const w = moneyWarnings(run)[0];
      if (!w) break;
      let next: RunState | null = null;
      if (w.kind === 'dark') next = tryUpgrade(run, 'surface', spendable(run, reserve), log);
      else if (w.kind === 'runway') {
        const s = lengthenRunway(budgetSession(run, spendable(run, reserve)));
        next = s && confirmWithin(run, s, log, 'longer Runway');
      } else {
        const need = [...standsNeeded(run, [0]).values()][0];
        if (need) next = addStand(run, spendable(run, reserve), need.size, need.purpose, log);
      }
      if (!next) break;
      run = next;
    }
    if (spendable(run, reserve) > 40_000 && level(run, 'radar') < 2) run = tryUpgrade(run, 'radar', spendable(run, reserve), log) ?? run;
    return run;
  },
};

/** What a planner may be told to leave out, to measure what each thing is worth. */
export type PlannerSkip = 'lit' | 'tower' | 'secondRunway' | 'holdingBays' | 'ils';

/** The planner, optionally leaving some things out (for upgrade-value experiments). */
export function makePlanner(skip: readonly PlannerSkip[] = []): Player {
  const skips = new Set(skip);
  return {
    id: skip.length ? `planner-no-${skip.join('-')}` : 'planner',
    name: skip.length ? `Planner without ${skip.join(', ')}` : 'Planner (expert: plans 3 Days and the Boss Day ahead)',
    plan: (run, log) => planAhead(run, log, skips),
  };
}

function planAhead(run: RunState, log: Purchase[], skips: ReadonlySet<PlannerSkip>): RunState {
  {
    const reserve = 2 * upkeep(run) + 5_000;
    const budget = () => spendable(run, reserve);
    const bossIn = 6 - run.weekday;
    const horizon = [0, 1, 2, ...(bossIn > 2 ? [bossIn] : [])];
    // 0. Lit first when evening flights would divert tomorrow: it pays for itself within days
    if (!skips.has('lit') && moneyWarnings(run).some((w) => w.kind === 'dark')) run = tryUpgrade(run, 'surface', budget(), log) ?? run;
    // 1. a Runway Large aircraft can use, if they are coming
    if (needsLongerRunway(run, horizon)) {
      const s = lengthenRunway(budgetSession(run, budget()));
      if (s) run = confirmWithin(run, s, log, 'longer Runway');
    }
    // 2. Stands for every flight that would be turned away in the horizon, biggest shortfall first
    const busiest = Math.max(...horizon.map((d) => dayPlan(daysAhead(run, d)).forecast.quota));
    const wantRunway = !skips.has('secondRunway') && busiest > RUNWAY_QUOTA * run.layout.runways.length;
    const standDays = horizon;
    for (let guard = 0; guard < 12; guard++) {
      const needs = [...standsNeeded(run, standDays).values()].sort((a, b) => b.stands - a.stands);
      const need = needs[0];
      if (!need) break;
      const next = addStand(run, budget(), need.size, need.purpose, log);
      if (!next) break;
      run = next;
    }
    // still short of Stands that could be built with more money (a new pier costs ~100k): save up, buy nothing else
    const short = [...standsNeeded(run, standDays).values()][0];
    if (short && addStand(run, Number.MAX_SAFE_INTEGER, short.size, short.purpose, [])) return run;
    // 3. Lit before evening arrivals divert (they come every Day)
    if (!skips.has('lit') && level(run, 'surface') < 2) run = tryUpgrade(run, 'surface', budget(), log) ?? run;
    // 4. throughput: shorter Runway Separation from Radar and Controller Training
    for (const [id, upTo] of [['radar', 3], ['controllerTraining', 2]] as const) {
      if (!skips.has('tower') && level(run, id) < upTo) run = tryUpgrade(run, id, budget(), log) ?? run;
    }
    // 5. a second Runway once one can't carry the busiest Day ahead (about RUNWAY_QUOTA Movements); save up for it
    if (wantRunway) {
      const s = buildParallelRunway(budgetSession(run, budget()), 'medium');
      if (s) run = confirmWithin(run, s, log, 'second Runway');
    }
    // 4. ILS before an ILS-only storm in the next three Days
    const storm = [0, 1, 2].some((d) => {
      const day = daysAhead(run, d);
      return twistsFor(run.seed, day.week, day.weekday).some((t) => t.family === 'weather' && t.severity >= 3);
    });
    if (storm && !skips.has('ils') && level(run, 'surface') >= 2) run = tryUpgrade(run, 'surface', budget(), log) ?? run;
    // 5. a Holding Bay of each size in use, so landed aircraft wait off the Taxiways
    const sizes = new Set(Object.values(AIRCRAFT_TYPES).map((t) => t.size));
    for (const size of sizes) {
      if (skips.has('holdingBays') || run.layout.holdingBays.some((b) => b.size === size)) continue;
      const comes = dayPlan(run).forecast.arrivalsBySize[size] > 0;
      if (!comes) continue;
      const s = placeHoldingBay(budgetSession(run, budget()), size);
      if (s) run = confirmWithin(run, s, log, `${size} Holding Bay`);
    }
    // 6. safety and throughput with what is left over
    for (const [id, upTo] of [['groundRadar', 2], ['weatherStation', 2]] as const) {
      if (level(run, id) < upTo && budget() > 30_000) run = tryUpgrade(run, id, budget() - 20_000, log) ?? run;
    }
    return run;
  }
}

export const planner: Player = makePlanner();

export const random: Player = {
  id: 'random',
  name: 'Random (one random affordable thing a Day)',
  plan(run, log) {
    const rng = createRandom(mixSeed(run.seed, run.dayIndex, 0x7a2d));
    if (rng.next() < 0.5) return run;
    const budget = spendable(run, upkeep(run));
    const sizes: SizeClass[] = ['small', 'medium', 'large'];
    const purposes: Purpose[] = ['passenger', 'cargo'];
    const ups: UpgradeId[] = ['surface', 'radar', 'groundRadar', 'weatherStation', 'controllerTraining', 'fireRescue'];
    const pick = Math.floor(rng.next() * 3);
    if (pick === 0) return addStand(run, budget, sizes[Math.floor(rng.next() * 3)]!, purposes[Math.floor(rng.next() * 2)]!, log) ?? run;
    if (pick === 1) {
      const s = lengthenRunway(budgetSession(run, budget));
      return s ? confirmWithin(run, s, log, 'longer Runway') : run;
    }
    return tryUpgrade(run, ups[Math.floor(rng.next() * ups.length)]!, budget, log) ?? run;
  },
};

export const PLAYERS: readonly Player[] = [idle, reactive, planner, random];

/** A player by id, including planners that leave things out ("planner-no-lit-tower"). */
export function playerById(id: string): Player {
  const fixed = PLAYERS.find((p) => p.id === id);
  if (fixed) return fixed;
  if (id.startsWith('planner-no-')) return makePlanner(id.slice('planner-no-'.length).split('-') as PlannerSkip[]);
  throw new Error(`Unknown player: ${id}`);
}
