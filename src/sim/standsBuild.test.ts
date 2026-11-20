import { describe, expect, it } from 'vitest';
import { addPending, confirmBuild, newHoldingBay, newStand, openBuild, placementChecks } from './build';
import { startRun } from './run';
import { emptyMeta } from './meta';
import { planDay } from './schedule';
import { buildTaxiNetwork, routeToStand } from './taxi';

const run = () => ({ ...startRun(1, { ...emptyMeta(), unlocks: ['remoteStands'] }), money: 500_000 });
const failing = (session: ReturnType<typeof openBuild>, s: Parameters<typeof placementChecks>[1]) =>
  placementChecks(session, s).items.filter((c: { ok: boolean }) => !c.ok).map((c: { label: string }) => c.label);

describe('Stand footprints', () => {
  it('are 3 tiles deep and 2 / 3 / 4 wide by Size Class, opening onto the Taxiway below', () => {
    const session = openBuild(run());
    expect(newStand(session, { x: 23, y: 8 }, 'small', 'contact', 'terminal')).toMatchObject({ kind: 'stand', w: 2, h: 3, size: 'small', placement: 'contact', serves: 'terminal' });
    expect(newStand(session, { x: 38, y: 8 }, 'large', 'contact', 'cargoHub')).toMatchObject({ w: 4, h: 3 });
    expect(newHoldingBay(session, { x: 38, y: 8 }, 'medium')).toMatchObject({ kind: 'holdingBay', w: 3, h: 3, id: 'B3' });
  });

  it('get fresh ids per kind', () => {
    const session = openBuild(run());
    expect(newStand(session, { x: 23, y: 8 }, 'small', 'contact', 'terminal').id).toBe('4');
    expect(newStand(session, { x: 38, y: 8 }, 'medium', 'contact', 'cargoHub').id).toBe('C3');
    expect(newStand(session, { x: 20, y: 15 }, 'medium', 'remote', 'terminal').id).toBe('R1');
  });
});

describe('Stand and Holding Bay prices', () => {
  it('cost Small 8k / Medium 16k / Large 36k, Remote half, Bays 4k / 8k / 16k, however many are built', () => {
    const session = openBuild(run());
    const cost = (s: Parameters<typeof placementChecks>[1]) => placementChecks(session, s).cost;
    // three Small and two Medium Contact Stands and one Medium Holding Bay already exist
    expect(cost(newStand(session, { x: 23, y: 8 }, 'small', 'contact', 'terminal'))).toBe(8_000);
    expect(cost(newStand(session, { x: 23, y: 8 }, 'medium', 'contact', 'terminal'))).toBe(16_000);
    expect(cost(newStand(session, { x: 20, y: 15 }, 'medium', 'remote', 'terminal'))).toBe(8_000);
    expect(cost(newHoldingBay(session, { x: 38, y: 8 }, 'medium'))).toBe(8_000);
  });

  it('keeps the price of the next one while one is pending', () => {
    const first = newStand(openBuild(run()), { x: 20, y: 15 }, 'medium', 'remote', 'terminal');
    const session = addPending(openBuild(run()), first);
    expect(placementChecks(session, newStand(session, { x: 24, y: 15 }, 'medium', 'remote', 'terminal')).cost).toBe(8_000);
  });
});

describe('Invalid placements explain why', () => {
  it('covers overlap, Taxiway access, owned land and attachment', () => {
    const session = openBuild(run());
    expect(failing(session, newStand(session, { x: 17, y: 8 }, 'medium', 'contact', 'terminal'))).toContain('Clear of other structures');
    expect(failing(session, newStand(session, { x: 44, y: 13 }, 'medium', 'remote', 'terminal'))).toContain('Taxiway access');
    expect(failing(session, newStand(session, { x: 50, y: 13 }, 'medium', 'remote', 'terminal'))).toContain('Inside owned land');
    expect(failing(session, newStand(session, { x: 20, y: 15 }, 'medium', 'contact', 'terminal'))).toContain('Attached to the Terminal');
  });
});

describe('After building', () => {
  it('aircraft can taxi to the new Stand', () => {
    const session = openBuild(run());
    const stand = newStand(session, { x: 20, y: 15 }, 'medium', 'remote', 'terminal');
    const built = confirmBuild(addPending(session, stand));
    const network = buildTaxiNetwork(built.layout);
    const s = built.layout.stands.find((x) => x.id === stand.id)!;
    expect(routeToStand(network, network.runwayExit, s).length).toBeGreaterThan(0);
  });

  it('the next Forecast sends more flights of that size', () => {
    const before = run();
    const session = openBuild(before);
    const built = confirmBuild(addPending(session, newStand(session, { x: 23, y: 8 }, 'medium', 'contact', 'terminal')));
    const day = (layout: typeof before.layout) => planDay({ layout, week: 4, weekday: 5, seed: 5 }).forecast;
    expect(day(built.layout).turnedAway.standCapacity).toBeLessThan(day(before.layout).turnedAway.standCapacity);
  });
});

describe('Contact Stands on any side of a building', () => {
  it('count as attached when at least one full tile touches the building', async () => {
    const { sharesEdge } = await import('./layout');
    expect(sharesEdge({ x: 0, y: 0, w: 3, h: 3 }, { x: 3, y: 2, w: 3, h: 3 })).toBe(true); // one tile of the side
    expect(sharesEdge({ x: 0, y: 0, w: 3, h: 3 }, { x: 3, y: 3, w: 3, h: 3 })).toBe(false); // corner only
  });

  it('can sit beside the Cargo Hub and open onto the Taxiway in front of them', () => {
    let session = openBuild(run());
    // a spur north from the end of the apron taxilane, right of the Cargo Hub (x 28–34, y 4–7)
    session = addPending(session, { kind: 'taxiway', x: 38, y: 4, w: 3, h: 10 });
    const stand = newStand(session, { x: 35, y: 4 }, 'medium', 'contact', 'cargoHub');
    expect(stand).toMatchObject({ facing: 'east' });
    expect(placementChecks(session, stand).ok).toBe(true);
    const built = confirmBuild(addPending(session, stand));
    expect(buildTaxiNetwork(built.layout).reachableSpots.has(stand.id)).toBe(true);
  });

  it('turn to whichever side has a Taxiway', () => {
    const session = openBuild(run());
    const stand = newStand(session, { x: 38, y: 11 }, 'medium', 'remote', 'terminal'); // the apron taxilane ends at x 37
    expect(stand.facing).toBe('west');
    expect(placementChecks(session, stand).items.find((i) => i.label === 'Taxiway access')!.ok).toBe(true);
    const built = confirmBuild(addPending(session, stand));
    const network = buildTaxiNetwork(built.layout);
    const route = routeToStand(network, network.runwayExit, built.layout.stands.find((s) => s.id === stand.id)!);
    expect(route.slice(-2)).toEqual([{ x: 38, y: 12 }, { x: 39, y: 12 }]);
  });
});
