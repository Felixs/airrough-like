import { describe, expect, it } from 'vitest';
import { checkChange, newBuilding, newRunway, newStand, openBuild } from './build';
import { BOOSTS, UNLOCKABLES, awardRun, buyBoost, buyUnlockable, emptyMeta, metaShop, type MetaState } from './meta';
import { upgradeOffers } from './plan';
import { airMiles, startLiveDay, startRun, upkeep, type RunState } from './run';
import { acknowledgeAlert, stepSimulation } from './simulation';

const rich = (meta: MetaState = emptyMeta()): MetaState => ({ ...meta, airMiles: 100_000 });
const ended = (overrides: Partial<RunState['stats']>): RunState => {
  const run = startRun(9);
  return { ...run, status: 'lost', stats: { ...run.stats, daysSurvived: 3, movements: 100, fees: 40_000, ...overrides } };
};
const failing = (c: ReturnType<typeof checkChange>) => c.items.filter((i) => !i.ok).map((i) => i.label);

describe('Air Miles', () => {
  it('are awarded once per Run, topping up after Endless', () => {
    const run = ended({});
    const once = awardRun(emptyMeta(), run);
    expect(once.airMiles).toBe(airMiles(run));
    expect(awardRun(once, run).airMiles).toBe(once.airMiles);
    const longer = { ...run, stats: { ...run.stats, daysSurvived: 30 } };
    expect(awardRun(once, longer).airMiles).toBe(airMiles(longer));
  });
});

describe('Unlockables', () => {
  it('are bought once and cost 300 to 1,200 Air Miles', () => {
    expect(UNLOCKABLES.length).toBeGreaterThanOrEqual(13);
    expect(Math.min(...UNLOCKABLES.map((u) => u.cost))).toBe(300);
    let meta = rich();
    meta = buyUnlockable(meta, 'remoteStands');
    expect(meta.unlocks).toContain('remoteStands');
    expect(meta.airMiles).toBe(100_000 - 300);
    expect(() => buyUnlockable(meta, 'remoteStands')).toThrow();
    expect(() => buyUnlockable(emptyMeta(), 'adminOffice')).toThrow();
  });

  it('lock buildings and features until bought, but never what the airport needs to run', () => {
    const locked = openBuild({ ...startRun(1), money: 1_000_000 });
    const stand = newStand(locked, { x: 20, y: 15 }, 'medium', 'remote', 'terminal');
    expect(failing(checkChange(locked, { kind: 'add', structure: stand }))).toContain('🔒 Needs Unlockable: Remote Stands');
    expect(failing(checkChange(locked, { kind: 'add', structure: newBuilding(locked, { x: 2, y: 14 }, 'adminOffice') }))).toContain('🔒 Needs Unlockable: Admin Office');
    expect(failing(checkChange(locked, { kind: 'add', structure: { kind: 'terminal', x: 20, y: 0, w: 3, h: 4 } }))).toContain('🔒 Needs Unlockable: Terminal wing');
    // Long Runways and ILS are never locked
    expect(failing(checkChange(locked, { kind: 'add', structure: newRunway(locked, { x: 6, y: 30 }, 'long', false) })).join()).not.toMatch(/🔒/);
    const lit = { ...startRun(1), money: 1e6 };
    expect(upgradeOffers(lit).find((o) => o.id === 'surface')!.reason).toBe(null);

    const unlocked = openBuild({ ...startRun(1, { ...emptyMeta(), unlocks: ['remoteStands', 'adminOffice'] }), money: 1_000_000 });
    expect(checkChange(unlocked, { kind: 'add', structure: newStand(unlocked, { x: 20, y: 15 }, 'medium', 'remote', 'terminal') }).ok).toBe(true);
    expect(checkChange(unlocked, { kind: 'add', structure: newBuilding(unlocked, { x: 2, y: 14 }, 'adminOffice') }).ok).toBe(true);
  });

  it('gate Tower Modules 4–5', () => {
    const run = { ...startRun(1), money: 1e6 };
    expect(upgradeOffers({ ...run, towerModules: { ...run.towerModules, radar: 3 } }).find((o) => o.id === 'radar')!.reason)
      .toBe('🔒 Needs Unlockable: Tower Modules 4–5');
    const open = startRun(1, { ...emptyMeta(), unlocks: ['towerLevel45'] });
    expect(upgradeOffers({ ...open, money: 1e6, towerModules: { ...open.towerModules, radar: 4 } }).find((o) => o.id === 'radar')!.available).toBe(true);
  });

  it('Grass strip allows cheap Short Grass Runways', () => {
    const s = openBuild({ ...startRun(1, { ...emptyMeta(), unlocks: ['grassStrip'] }), money: 1e6 });
    const grass = newRunway(s, { x: 44, y: 0 }, 'long', true, true);
    expect(grass).toMatchObject({ length: 'short', surface: 'grass', h: 24 });
    expect(checkChange(s, { kind: 'add', structure: grass })).toMatchObject({ ok: true, cost: 12_000 });
  });
});

describe('Boosts', () => {
  it('cost 500 × the next level, stop at the max, and wait for the building they belong to', () => {
    expect(BOOSTS.length).toBeGreaterThanOrEqual(12);
    let meta = buyBoost(rich(), 'higherFees');
    expect(meta.boosts.higherFees).toBe(1);
    expect(meta.airMiles).toBe(100_000 - 500);
    expect(metaShop(meta).boosts.find((b) => b.id === 'higherFees')!.cost).toBe(1_000);
    meta = buyBoost(buyBoost(meta, 'higherFees'), 'higherFees');
    expect(() => buyBoost(meta, 'higherFees')).toThrow();
    const fire = metaShop(rich()).boosts.find((b) => b.id === 'fasterFireCrews')!;
    expect(fire).toMatchObject({ locked: true, available: false, reason: 'Needs: Fire & Rescue Station' });
    expect(metaShop(rich({ ...emptyMeta(), unlocks: ['fireRescueStation'] })).boosts.find((b) => b.id === 'fasterFireCrews')!.available).toBe(true);
  });

  it('apply from the next Run', () => {
    const meta: MetaState = {
      ...emptyMeta(),
      boosts: { higherFees: 2, lowerUpkeep: 2, longerFuel: 1, shorterCooldowns: 1, fasterTurnaround: 1, cheaperTaxiways: 1, startingMoney: 1, startingHoldingBay: 1, largerStartingLand: 1, betterStartingRadar: 2 },
    };
    const plain = startRun(3);
    const boosted = startRun(3, meta);
    expect(boosted.money).toBe(plain.money + 15_000);
    expect(boosted.ownedPlots.length).toBe(plain.ownedPlots.length + 1);
    expect(boosted.towerModules.radar).toBe(3);
    expect(boosted.layout.holdingBays).toHaveLength(3);
    expect(upkeep(boosted)).toBe(Math.round((upkeep(plain) + 60 + 9 * 2 + 2 * 150) * 0.9)); // + Holding Bay and its lane + Radar 3
    const sim = startLiveDay(boosted);
    expect(sim.feeFactor).toBeCloseTo(1.1);
    expect(sim.cooldownFactor).toBeCloseTo(0.9);
    expect(sim.turnaroundFactor).toBeCloseTo(0.95);
    let s = startLiveDay(boosted);
    let p = startLiveDay(plain);
    while (s.clock.minute < 24 * 60) s = s.pendingAlert ? acknowledgeAlert(s) : stepSimulation(s);
    while (p.clock.minute < 24 * 60) p = p.pendingAlert ? acknowledgeAlert(p) : stepSimulation(p);
    expect(s.fees).toBeGreaterThan(p.fees);
    const firstFuel = (r: RunState) => startLiveDay(r).flights.find((f) => !f.overnight)!.fuelMinutes;
    expect(firstFuel(boosted)).toBe(firstFuel(plain) + 5);
  });
});
