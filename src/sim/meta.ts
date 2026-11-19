/**
 * Meta-progression between Runs: Air Miles earned on the Score Screen, Boosts and Starting Perks bought with
 * them, and Milestones that permanently unlock structures and upgrades. Everything is plain, saveable data.
 */
import type { RunState } from './run';
import { airMiles } from './run';

export type BoostId = 'higherFees' | 'lowerUpkeep' | 'longerFuel' | 'shorterCooldowns';
export type PerkId = 'extraCash' | 'largerLand' | 'upgradedTower';
export type MilestoneId = 'surviveWeek1' | 'surviveWeek2' | 'land100Large';

export interface MetaState {
  readonly airMiles: number;
  readonly boosts: Partial<Record<BoostId, number>>;
  readonly perks: readonly PerkId[];
  readonly milestones: readonly MilestoneId[];
  readonly lifetime: { readonly largeLandings: number; readonly runs: number };
  /** Air Miles already paid out per Run seed (so Endless only tops up). */
  readonly credited: Readonly<Record<string, number>>;
  /** Large landings already counted per Run seed. */
  readonly creditedLarge?: Readonly<Record<string, number>>;
}

export const BOOSTS: ReadonlyArray<{ readonly id: BoostId; readonly name: string; readonly perLevel: string; readonly maxLevel: number }> = [
  { id: 'higherFees', name: 'Higher fees', perLevel: '+5% Arrival and Departure Fees', maxLevel: 3 },
  { id: 'lowerUpkeep', name: 'Lower Upkeep', perLevel: '−5% Upkeep', maxLevel: 3 },
  { id: 'longerFuel', name: 'Longer Fuel Reserve', perLevel: '+5 min Fuel Reserve', maxLevel: 3 },
  { id: 'shorterCooldowns', name: 'Shorter cooldowns', perLevel: '−10% Emergency Action cooldowns', maxLevel: 3 },
];

export const PERKS: ReadonlyArray<{ readonly id: PerkId; readonly name: string; readonly effect: string; readonly cost: number }> = [
  { id: 'extraCash', name: 'Extra cash', effect: 'Start every Run with $15,000 more', cost: 800 },
  { id: 'largerLand', name: 'Larger Land Plot', effect: 'Start every Run with one more Land Plot', cost: 1_200 },
  { id: 'upgradedTower', name: 'Upgraded ATC Tower', effect: 'Start every Run with Radar 2', cost: 1_500 },
];

export const MILESTONES: ReadonlyArray<{ readonly id: MilestoneId; readonly name: string; readonly unlocks: string }> = [
  { id: 'surviveWeek1', name: 'Survive Week 1', unlocks: 'Long Runways' },
  { id: 'surviveWeek2', name: 'Survive Week 2', unlocks: 'ILS Runway Surface' },
  { id: 'land100Large', name: 'Land 100 Large aircraft', unlocks: 'Tower Modules level 5' },
];

export const milestoneName = (id: MilestoneId) => MILESTONES.find((m) => m.id === id)!.name;

/** Boost level n+1 costs this × (n+1) Air Miles *(first guess)*. */
export const BOOST_COST_PER_LEVEL = 500;

/** Per-Run effects of meta-progression, stored on the Run when it starts. */
export interface RunModifiers {
  readonly feeFactor: number;
  readonly upkeepFactor: number;
  readonly fuelBonusMinutes: number;
  readonly cooldownFactor: number;
  readonly unlocks: readonly MilestoneId[];
}

export function emptyMeta(): MetaState {
  return { airMiles: 0, boosts: {}, perks: [], milestones: [], lifetime: { largeLandings: 0, runs: 0 }, credited: {} };
}

export function modifiersFrom(meta: MetaState): RunModifiers {
  const lvl = (id: BoostId) => meta.boosts[id] ?? 0;
  return {
    feeFactor: 1 + 0.05 * lvl('higherFees'),
    upkeepFactor: 1 - 0.05 * lvl('lowerUpkeep'),
    fuelBonusMinutes: 5 * lvl('longerFuel'),
    cooldownFactor: 1 - 0.1 * lvl('shorterCooldowns'),
    unlocks: meta.milestones,
  };
}

/** Pays out a finished (or won) Run's Air Miles once, updates lifetime totals and Milestones. */
export function awardRun(meta: MetaState, run: RunState): MetaState {
  const key = String(run.seed);
  const earned = airMiles(run);
  const already = meta.credited[key] ?? 0;
  const firstTime = !(key in meta.credited);
  const largeBefore = firstTime ? 0 : (meta.creditedLarge?.[key] ?? 0);
  const largeLandings = meta.lifetime.largeLandings + Math.max(0, run.stats.largeLandings - largeBefore);
  const reached = new Set(meta.milestones);
  if (run.stats.daysSurvived >= 7) reached.add('surviveWeek1');
  if (run.stats.daysSurvived >= 14) reached.add('surviveWeek2');
  if (largeLandings >= 100) reached.add('land100Large');
  return {
    ...meta,
    airMiles: meta.airMiles + Math.max(0, earned - already),
    milestones: MILESTONES.map((m) => m.id).filter((id) => reached.has(id)),
    lifetime: { largeLandings, runs: meta.lifetime.runs + (firstTime ? 1 : 0) },
    credited: { ...meta.credited, [key]: Math.max(already, earned) },
    creditedLarge: { ...(meta.creditedLarge ?? {}), [key]: run.stats.largeLandings },
  };
}

export interface ShopItem {
  readonly id: string;
  readonly name: string;
  readonly effect: string;
  readonly level: number;
  readonly maxLevel: number;
  readonly cost: number;
  readonly available: boolean;
  readonly reason: string | null;
}

export function metaShop(meta: MetaState): { boosts: ShopItem[]; perks: ShopItem[] } {
  const reason = (owned: boolean, cost: number) => (owned ? 'Owned' : meta.airMiles < cost ? 'Not enough Air Miles' : null);
  return {
    boosts: BOOSTS.map((b) => {
      const level = meta.boosts[b.id] ?? 0;
      const cost = BOOST_COST_PER_LEVEL * (level + 1);
      const r = level >= b.maxLevel ? 'Max level' : reason(false, cost);
      return { id: b.id, name: b.name, effect: b.perLevel, level, maxLevel: b.maxLevel, cost, available: r === null, reason: r };
    }),
    perks: PERKS.map((p) => {
      const owned = meta.perks.includes(p.id);
      const r = reason(owned, p.cost);
      return { id: p.id, name: p.name, effect: p.effect, level: owned ? 1 : 0, maxLevel: 1, cost: p.cost, available: r === null, reason: r };
    }),
  };
}

export function buyBoost(meta: MetaState, id: BoostId): MetaState {
  const item = metaShop(meta).boosts.find((b) => b.id === id)!;
  if (!item.available) throw new Error(item.reason ?? 'Not available');
  return { ...meta, airMiles: meta.airMiles - item.cost, boosts: { ...meta.boosts, [id]: item.level + 1 } };
}

export function buyPerk(meta: MetaState, id: PerkId): MetaState {
  const item = metaShop(meta).perks.find((p) => p.id === id)!;
  if (!item.available) throw new Error(item.reason ?? 'Not available');
  return { ...meta, airMiles: meta.airMiles - item.cost, perks: [...meta.perks, id] };
}
