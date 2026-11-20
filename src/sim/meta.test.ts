import { describe, expect, it } from 'vitest';
import { checkChange, newRunway, openBuild } from './build';
import {
  BOOSTS, MILESTONES, PERKS, awardRun, buyBoost, buyPerk, emptyMeta, metaShop, type MetaState,
} from './meta';
import { upgradeOffers } from './plan';
import { airMiles, startLiveDay, startRun, upkeep, type RunState } from './run';
import { stepSimulation } from './simulation';

const rich = (meta: MetaState): MetaState => ({ ...meta, airMiles: 100_000 });
const ended = (overrides: Partial<RunState['stats']>): RunState => {
  const run = startRun(9);
  return { ...run, status: 'lost', stats: { ...run.stats, daysSurvived: 3, movements: 100, fees: 40_000, ...overrides } };
};

describe('Air Miles', () => {
  it('are awarded once per Run on the Score Screen, topping up after Endless', () => {
    const run = ended({});
    const once = awardRun(emptyMeta(), run);
    expect(once.airMiles).toBe(airMiles(run));
    expect(awardRun(once, run).airMiles).toBe(once.airMiles);
    const longer = { ...run, stats: { ...run.stats, daysSurvived: 30 } };
    expect(awardRun(once, longer).airMiles).toBe(airMiles(longer));
  });
});

describe('Milestones', () => {
  it('unlock permanently from Run results and lifetime totals', () => {
    expect(MILESTONES.length).toBeGreaterThanOrEqual(3);
    const week1 = awardRun(emptyMeta(), ended({ daysSurvived: 7 }));
    expect(week1.milestones).toContain('surviveWeek1');
    expect(week1.milestones).not.toContain('surviveWeek2');
    const large = awardRun(awardRun(emptyMeta(), { ...ended({ largeLandings: 60 }), seed: 1 }), { ...ended({ largeLandings: 50 }), seed: 2 });
    expect(large.lifetime.largeLandings).toBe(110);
    expect(large.milestones).toContain('land100Large');
  });

  it('gate ILS, Fire & Rescue 4–5 and Tower level 5 until reached, but never Long Runways', () => {
    const locked = startRun(1, emptyMeta());
    const s = openBuild({ ...locked, money: 1_000_000 });
    expect(checkChange(s, { kind: 'add', structure: newRunway(s, { x: 6, y: 30 }, 'long', false) }).items.filter((i) => !i.ok).map((i) => i.label))
      .not.toContain('Unlocked (Milestone: Survive Week 1)');
    const ils = upgradeOffers({ ...locked, money: 1e6, layout: upgradeLayoutToLit(locked) }).find((o) => o.id === 'surface')!;
    expect(ils.reason).toBe('Unlock: Survive Week 2');
    expect(upgradeOffers({ ...locked, money: 1e6, fireRescueLevel: 3 }).find((o) => o.id === 'fireRescue')!.reason).toBe('Unlock: Survive Week 1');
    expect(upgradeOffers({ ...locked, money: 1e6, towerModules: { ...locked.towerModules, radar: 4 } }).find((o) => o.id === 'radar')!.reason)
      .toBe('Unlock: Land 100 Large aircraft');
    const open = startRun(1, { ...emptyMeta(), milestones: ['surviveWeek1', 'surviveWeek2', 'land100Large'] });
    expect(upgradeOffers({ ...open, money: 1e6, towerModules: { ...open.towerModules, radar: 4 } }).find((o) => o.id === 'radar')!.available).toBe(true);
  });
});

function upgradeLayoutToLit(run: RunState) {
  const structures = run.layout.structures.map((s) => (s.kind === 'runway' ? { ...s, surface: 'lit' as const } : s));
  return { ...run.layout, structures, runways: structures.filter((s) => s.kind === 'runway') } as RunState['layout'];
}

describe('Boosts', () => {
  it('cost more per level and stop at the max', () => {
    expect(BOOSTS.length).toBeGreaterThanOrEqual(3);
    let meta = rich(emptyMeta());
    meta = buyBoost(meta, 'higherFees');
    expect(meta.boosts.higherFees).toBe(1);
    expect(meta.airMiles).toBe(100_000 - 500);
    expect(metaShop(meta).boosts.find((b) => b.id === 'higherFees')!.cost).toBe(1_000);
    meta = buyBoost(buyBoost(meta, 'higherFees'), 'higherFees');
    expect(() => buyBoost(meta, 'higherFees')).toThrow();
    expect(() => buyBoost(emptyMeta(), 'lowerUpkeep')).toThrow();
  });

  it('apply from the next Run: higher fees, lower Upkeep, longer Fuel Reserve, shorter cooldowns', () => {
    const meta: MetaState = { ...emptyMeta(), boosts: { higherFees: 2, lowerUpkeep: 2, longerFuel: 1, shorterCooldowns: 1 } };
    const plain = startRun(3);
    const boosted = startRun(3, meta);
    expect(upkeep(boosted)).toBe(Math.round(upkeep(plain) * 0.9));
    const sim = startLiveDay(boosted);
    expect(sim.feeFactor).toBeCloseTo(1.1);
    expect(sim.cooldownFactor).toBeCloseTo(0.9);
    const a320 = { ...sim, flights: [] };
    void a320;
    let s = startLiveDay(boosted);
    let p = startLiveDay(plain);
    while (s.clock.minute < 24 * 60) s = stepSimulation(s);
    while (p.clock.minute < 24 * 60) p = stepSimulation(p);
    expect(s.fees).toBeGreaterThan(p.fees);
    const firstFuel = (r: RunState) => startLiveDay(r).flights.find((f) => !f.overnight)!.fuelMinutes;
    expect(firstFuel(boosted)).toBe(firstFuel(plain) + 5);
  });
});

describe('Starting Perks', () => {
  it('give extra cash, a larger Land Plot and an upgraded ATC Tower', () => {
    expect(PERKS.length).toBeGreaterThanOrEqual(3);
    let meta = rich(emptyMeta());
    for (const p of ['extraCash', 'largerLand', 'upgradedTower'] as const) meta = buyPerk(meta, p);
    expect(() => buyPerk(meta, 'extraCash')).toThrow();
    const run = startRun(1, meta);
    const plain = startRun(1);
    expect(run.money).toBe(plain.money + 15_000);
    expect(run.ownedPlots.length).toBe(plain.ownedPlots.length + 1);
    expect(run.towerModules.radar).toBe(2);
  });
});
