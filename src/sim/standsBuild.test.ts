import { describe, expect, it } from 'vitest';
import { addPending, confirmBuild, newHoldingBay, newStand, openBuild, placementChecks } from './build';
import { startRun } from './run';
import { planDay } from './schedule';
import { buildTaxiNetwork, routeToStand } from './taxi';

const run = () => ({ ...startRun(1), money: 500_000 });
const failing = (session: ReturnType<typeof openBuild>, s: Parameters<typeof placementChecks>[1]) =>
  placementChecks(session, s).items.filter((c: { ok: boolean }) => !c.ok).map((c: { label: string }) => c.label);

describe('Stand footprints', () => {
  it('are 3 tiles deep and 2 / 3 / 4 wide by Size Class, opening onto the Taxiway below', () => {
    const session = openBuild(run());
    expect(newStand(session, { x: 20, y: 6 }, 'small', 'contact', 'terminal')).toMatchObject({ kind: 'stand', w: 2, h: 3, size: 'small', placement: 'contact', serves: 'terminal' });
    expect(newStand(session, { x: 32, y: 6 }, 'large', 'contact', 'cargoHub')).toMatchObject({ w: 4, h: 3 });
    expect(newHoldingBay(session, { x: 35, y: 6 }, 'medium')).toMatchObject({ kind: 'holdingBay', w: 3, h: 3, id: 'B2' });
  });

  it('get fresh ids per kind', () => {
    const session = openBuild(run());
    expect(newStand(session, { x: 20, y: 6 }, 'small', 'contact', 'terminal').id).toBe('5');
    expect(newStand(session, { x: 32, y: 6 }, 'medium', 'contact', 'cargoHub').id).toBe('C3');
    expect(newStand(session, { x: 20, y: 13 }, 'medium', 'remote', 'terminal').id).toBe('R1');
  });
});

describe('Stand and Holding Bay prices', () => {
  it('start at Small 8k / Medium 16k / Large 36k, Remote half, Bays 4k / 8k / 16k, +25% per copy already built', () => {
    const session = openBuild(run());
    const cost = (s: Parameters<typeof placementChecks>[1]) => placementChecks(session, s).cost;
    expect(cost(newStand(session, { x: 20, y: 6 }, 'small', 'contact', 'terminal'))).toBe(8_000);
    // six Medium Contact Stands already exist
    expect(cost(newStand(session, { x: 32, y: 6 }, 'medium', 'contact', 'cargoHub'))).toBe(16_000 * 2.5);
    expect(cost(newStand(session, { x: 20, y: 13 }, 'medium', 'remote', 'terminal'))).toBe(8_000);
    expect(cost(newHoldingBay(session, { x: 35, y: 6 }, 'medium'))).toBe(8_000 * 1.25);
  });

  it('raises the price of the next copy while one is pending', () => {
    const first = newStand(openBuild(run()), { x: 20, y: 13 }, 'medium', 'remote', 'terminal');
    const session = addPending(openBuild(run()), first);
    expect(placementChecks(session, newStand(session, { x: 24, y: 13 }, 'medium', 'remote', 'terminal')).cost).toBe(10_000);
  });
});

describe('Invalid placements explain why', () => {
  it('covers overlap, Taxiway access, owned land and attachment', () => {
    const session = openBuild(run());
    expect(failing(session, newStand(session, { x: 17, y: 6 }, 'medium', 'contact', 'terminal'))).toContain('Clear of other structures');
    expect(failing(session, newStand(session, { x: 20, y: 12 }, 'medium', 'remote', 'terminal'))).toContain('Taxiway access');
    expect(failing(session, newStand(session, { x: 50, y: 13 }, 'medium', 'remote', 'terminal'))).toContain('Inside owned land');
    expect(failing(session, newStand(session, { x: 20, y: 13 }, 'medium', 'contact', 'terminal'))).toContain('Attached to the Terminal');
  });
});

describe('After building', () => {
  it('aircraft can taxi to the new Stand', () => {
    const session = openBuild(run());
    const stand = newStand(session, { x: 20, y: 13 }, 'medium', 'remote', 'terminal');
    const built = confirmBuild(addPending(session, stand));
    const network = buildTaxiNetwork(built.layout);
    const s = built.layout.stands.find((x) => x.id === stand.id)!;
    expect(routeToStand(network, network.runwayExit, s).length).toBeGreaterThan(0);
  });

  it('the next Forecast sends more flights of that size', () => {
    const before = run();
    const session = openBuild(before);
    const built = confirmBuild(addPending(session, newStand(session, { x: 32, y: 6 }, 'medium', 'contact', 'cargoHub')));
    const day = (layout: typeof before.layout) => planDay({ layout, week: 4, weekday: 5, seed: 5 }).forecast;
    expect(day(built.layout).turnedAway.standCapacity).toBeLessThan(day(before.layout).turnedAway.standCapacity);
  });
});
