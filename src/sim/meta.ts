/**
 * Meta-progression between Runs: Air Miles earned at the end of a Run buy Unlockables (buildings or features,
 * bought once) and Boosts (permanent bonuses in levels). Effects are fixed on a Run when it starts.
 * See docs/meta-progression.md.
 */
import type { RunState } from './run';
import { airMiles } from './run';

export type UnlockableId =
  | 'remoteStands' | 'adminOffice' | 'rampAgentStation' | 'cargoApronLighting'
  | 'airlineOffice' | 'fuelFarm' | 'fireRescueStation' | 'deIcingPad' | 'bonusTwists' | 'towerLevel45';

export type BoostId =
  | 'higherFees' | 'lowerUpkeep' | 'longerFuel' | 'shorterCooldowns' | 'fasterTurnaround' | 'cheaperTaxiways' | 'cheaperLand'
  | 'fasterFireCrews' | 'startingMoney' | 'startingHoldingBay' | 'largerStartingLand' | 'betterStartingRadar';

export interface MetaState {
  readonly airMiles: number;
  readonly unlocks: readonly UnlockableId[];
  readonly boosts: Partial<Record<BoostId, number>>;
  readonly lifetime: { readonly runs: number };
  /** Air Miles already paid out per Run seed (so Endless only tops up). */
  readonly credited: Readonly<Record<string, number>>;
}

export const UNLOCKABLES: ReadonlyArray<{ readonly id: UnlockableId; readonly name: string; readonly effect: string; readonly cost: number }> = [
  { id: 'remoteStands', name: 'Remote Stands', effect: 'Place Stands away from the buildings (slower Turnaround)', cost: 300 },
  { id: 'adminOffice', name: 'Admin Office', effect: 'Building that enables Manual Divert', cost: 300 },
  { id: 'rampAgentStation', name: 'Ramp Agent Station', effect: 'Building that enables Rush Turnaround', cost: 500 },
  { id: 'cargoApronLighting', name: 'Cargo apron lighting', effect: 'Cargo Turnarounds 20% faster after dusk', cost: 500 },
  { id: 'airlineOffice', name: 'Airline Office', effect: 'Building that enables Priority Landing', cost: 600 },
  { id: 'fuelFarm', name: 'Fuel farm', effect: 'Building: arriving aircraft carry +5 min Fuel Reserve', cost: 600 },
  { id: 'fireRescueStation', name: 'Fire & Rescue Station', effect: 'Building that clears Crashes and Incidents faster; levels in Plan Mode', cost: 700 },
  { id: 'deIcingPad', name: 'De-icing pad', effect: 'Building: Weather Twists raise error chances 30% less', cost: 800 },
  { id: 'bonusTwists', name: 'Bonus Twists', effect: 'In Plan Mode, add a Twist to a weekday for extra Score', cost: 1_000 },
  { id: 'towerLevel45', name: 'Tower Modules 4–5', effect: 'Tower Modules can go to level 4 and 5', cost: 1_200 },
];

export const BOOSTS: ReadonlyArray<{
  readonly id: BoostId; readonly name: string; readonly perLevel: string; readonly maxLevel: number; readonly needs?: UnlockableId;
}> = [
  { id: 'higherFees', name: 'Higher fees', perLevel: '+5% Arrival and Departure Fees', maxLevel: 3 },
  { id: 'lowerUpkeep', name: 'Lower Upkeep', perLevel: '−5% Upkeep', maxLevel: 3 },
  { id: 'longerFuel', name: 'Longer Fuel Reserve', perLevel: '+5 min Fuel Reserve', maxLevel: 3 },
  { id: 'shorterCooldowns', name: 'Shorter cooldowns', perLevel: '−10% Emergency Action cooldowns', maxLevel: 3 },
  { id: 'fasterTurnaround', name: 'Faster Turnaround', perLevel: '−5% Turnaround', maxLevel: 3 },
  { id: 'cheaperTaxiways', name: 'Cheaper Taxiways', perLevel: '−10% Taxiway price', maxLevel: 3 },
  { id: 'cheaperLand', name: 'Cheaper Land', perLevel: '−10% Land Plot price', maxLevel: 3 },
  { id: 'fasterFireCrews', name: 'Faster fire crews', perLevel: '−10% Runway blockage', maxLevel: 3, needs: 'fireRescueStation' },
  { id: 'startingMoney', name: 'Starting Money', perLevel: '+$15,000 at the start of a Run', maxLevel: 3 },
  { id: 'startingHoldingBay', name: 'Starting Holding Bay', perLevel: 'Start with a third, Medium Holding Bay', maxLevel: 1 },
  { id: 'largerStartingLand', name: 'Larger starting land', perLevel: 'Start with one more Land Plot', maxLevel: 1 },
  { id: 'betterStartingRadar', name: 'Better starting Radar', perLevel: '+1 starting Radar level', maxLevel: 2 },
];

/** Boost level n+1 costs this × (n+1) Air Miles *(first guess)*. */
export const BOOST_COST_PER_LEVEL = 500;

export const unlockableName = (id: UnlockableId) => UNLOCKABLES.find((u) => u.id === id)!.name;

/** Per-Run effects of meta-progression, fixed when the Run starts. */
export interface RunModifiers {
  readonly feeFactor: number;
  readonly upkeepFactor: number;
  readonly fuelBonusMinutes: number;
  readonly cooldownFactor: number;
  readonly turnaroundFactor: number;
  readonly taxiwayCostFactor: number;
  readonly landCostFactor: number;
  readonly blockageFactor: number;
  readonly unlocks: readonly UnlockableId[];
}

export function emptyMeta(): MetaState {
  return { airMiles: 0, unlocks: [], boosts: {}, lifetime: { runs: 0 }, credited: {} };
}

export function modifiersFrom(meta: MetaState): RunModifiers {
  const lvl = (id: BoostId) => meta.boosts[id] ?? 0;
  return {
    feeFactor: 1 + 0.05 * lvl('higherFees'),
    upkeepFactor: 1 - 0.05 * lvl('lowerUpkeep'),
    fuelBonusMinutes: 5 * lvl('longerFuel'),
    cooldownFactor: 1 - 0.1 * lvl('shorterCooldowns'),
    turnaroundFactor: 1 - 0.05 * lvl('fasterTurnaround'),
    taxiwayCostFactor: 1 - 0.1 * lvl('cheaperTaxiways'),
    landCostFactor: 1 - 0.1 * lvl('cheaperLand'),
    blockageFactor: 1 - 0.1 * lvl('fasterFireCrews'),
    unlocks: meta.unlocks,
  };
}

/** Pays out a finished (or won) Run's Air Miles once; Endless only tops up. */
export function awardRun(meta: MetaState, run: RunState): MetaState {
  const key = String(run.seed);
  const earned = airMiles(run);
  const already = meta.credited[key] ?? 0;
  const firstTime = !(key in meta.credited);
  return {
    ...meta,
    airMiles: meta.airMiles + Math.max(0, earned - already),
    lifetime: { runs: meta.lifetime.runs + (firstTime ? 1 : 0) },
    credited: { ...meta.credited, [key]: Math.max(already, earned) },
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
  /** Why it can't be bought: Owned, Max level, Needs: …, Not enough Air Miles. */
  readonly reason: string | null;
  readonly locked: boolean;
}

export function metaShop(meta: MetaState): { unlockables: ShopItem[]; boosts: ShopItem[] } {
  const short = (cost: number) => (meta.airMiles < cost ? 'Not enough Air Miles' : null);
  return {
    unlockables: UNLOCKABLES.map((u) => {
      const owned = meta.unlocks.includes(u.id);
      const reason = owned ? 'Owned' : short(u.cost);
      return { id: u.id, name: u.name, effect: u.effect, level: owned ? 1 : 0, maxLevel: 1, cost: u.cost, available: reason === null, reason, locked: false };
    }),
    boosts: BOOSTS.map((b) => {
      const level = meta.boosts[b.id] ?? 0;
      const cost = BOOST_COST_PER_LEVEL * (level + 1);
      const locked = !!b.needs && !meta.unlocks.includes(b.needs);
      const reason = locked ? `Needs: ${unlockableName(b.needs!)}` : level >= b.maxLevel ? 'Max level' : short(cost);
      return { id: b.id, name: b.name, effect: b.perLevel, level, maxLevel: b.maxLevel, cost, available: reason === null, reason, locked };
    }),
  };
}

export function buyUnlockable(meta: MetaState, id: UnlockableId): MetaState {
  const item = metaShop(meta).unlockables.find((u) => u.id === id)!;
  if (!item.available) throw new Error(item.reason ?? 'Not available');
  return { ...meta, airMiles: meta.airMiles - item.cost, unlocks: [...meta.unlocks, id] };
}

export function buyBoost(meta: MetaState, id: BoostId): MetaState {
  const item = metaShop(meta).boosts.find((b) => b.id === id)!;
  if (!item.available) throw new Error(item.reason ?? 'Not available');
  return { ...meta, airMiles: meta.airMiles - item.cost, boosts: { ...meta.boosts, [id]: item.level + 1 } };
}
