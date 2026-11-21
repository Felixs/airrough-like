import { describe, expect, it } from 'vitest';
import { BUILD_COSTS, addPending, confirmBuild, openBuild, pendingTotal, placementChecks, taxiwayFromDrag, undoPending } from './build';
import { holdShortLines, taxiwayEdgeLights } from './markings';
import { startRun, upkeep } from './run';
import { buildTaxiNetwork, routeToStand, taxiRoute } from './taxi';

const run = () => ({ ...startRun(1), money: 100_000 });

describe('Drawing a Taxiway', () => {
  it('snaps a drag to a straight 3-tile-wide strip centred on the dragged line', () => {
    expect(taxiwayFromDrag({ x: 21, y: 13 }, { x: 22, y: 14 })).toMatchObject({ kind: 'taxiway', x: 20, y: 13, w: 3, h: 2 });
    expect(taxiwayFromDrag({ x: 30, y: 30 }, { x: 20, y: 31 })).toMatchObject({ kind: 'taxiway', x: 20, y: 29, w: 11, h: 3 });
  });

  it('costs 600 per tile with 2 Upkeep per tile', () => {
    const t = taxiwayFromDrag({ x: 21, y: 14 }, { x: 21, y: 17 });
    const checks = placementChecks(openBuild(run()), t);
    expect(checks.cost).toBe(12 * 600);
    expect(checks.upkeep).toBe(12 * BUILD_COSTS.taxiwayUpkeepPerTile);
  });

  it('may end in a dead end, as long as one end joins the network', () => {
    const spur = taxiwayFromDrag({ x: 21, y: 14 }, { x: 21, y: 15 });
    expect(placementChecks(openBuild(run()), spur).ok).toBe(true);
  });

  it('merges with the Taxiway it extends instead of drawing a junction', () => {
    let session = addPending(openBuild(run()), taxiwayFromDrag({ x: 21, y: 14 }, { x: 21, y: 15 }));
    session = addPending(session, taxiwayFromDrag({ x: 21, y: 16 }, { x: 21, y: 17 }));
    expect(session.layout.structures.filter((s) => s.kind === 'taxiway' && s.x === 20 && s.y === 14)).toEqual([{ kind: 'taxiway', x: 20, y: 14, w: 3, h: 4 }]);
  });

  it('is valid when it connects at both ends inside owned land without crossing a Runway', () => {
    // A link between the apron taxilane (y 9–11) and Taxiway A (y 16–18)
    const link = taxiwayFromDrag({ x: 21, y: 14 }, { x: 21, y: 17 });
    const checks = placementChecks(openBuild(run()), link);
    expect(checks.ok).toBe(true);
    expect(checks.items.every((c: { ok: boolean }) => c.ok)).toBe(true);
  });

  it('explains why a placement is invalid', () => {
    const session = openBuild(run());
    const reasons = (s: ReturnType<typeof taxiwayFromDrag>) => placementChecks(session, s).items.filter((c: { ok: boolean }) => !c.ok).map((c: { label: string }) => c.label);
    expect(reasons(taxiwayFromDrag({ x: 21, y: 15 }, { x: 21, y: 16 }))).toContain('Connects to a Taxiway or Runway');
    expect(reasons(taxiwayFromDrag({ x: 21, y: 21 }, { x: 21, y: 29 }))).toContain('Crosses no Runway');
    expect(reasons(taxiwayFromDrag({ x: 44, y: 17 }, { x: 60, y: 17 }))).toContain('Inside owned land');
    expect(reasons(taxiwayFromDrag({ x: -10, y: 17 }, { x: 4, y: 17 }))).toContain('Inside owned land');
    expect(reasons(taxiwayFromDrag({ x: 12, y: 4 }, { x: 12, y: 10 }))).toContain('Clear of buildings and Stands');
  });
});

describe('Pending changes', () => {
  it('list with a total, Undo, and Confirm that pays and rebuilds the layout', () => {
    const link = taxiwayFromDrag({ x: 21, y: 14 }, { x: 21, y: 17 });
    let session = addPending(openBuild(run()), link);
    session = addPending(session, taxiwayFromDrag({ x: 27, y: 14 }, { x: 27, y: 17 }));
    expect(session.pending).toHaveLength(2);
    expect(pendingTotal(session).cost).toBe(24 * 600);
    session = undoPending(session);
    expect(session.pending).toHaveLength(1);
    const before = run();
    const after = confirmBuild(session);
    expect(after.money).toBe(before.money - 12 * 600);
    expect(after.layout.structures).toContainEqual(link);
    expect(upkeep(after)).toBe(upkeep(before) + 12 * BUILD_COSTS.taxiwayUpkeepPerTile);
  });

  it('refuses invalid placements and Confirm while in Debt or short of Money', () => {
    expect(() => addPending(openBuild(run()), taxiwayFromDrag({ x: 21, y: 15 }, { x: 21, y: 16 }))).toThrow();
    const link = taxiwayFromDrag({ x: 21, y: 14 }, { x: 21, y: 17 });
    expect(() => confirmBuild(addPending(openBuild({ ...run(), money: 1_000 }), link))).toThrow();
    expect(() => addPending(openBuild({ ...run(), money: -5, inDebt: true }), link)).toThrow();
  });
});

describe('Taxi network after building', () => {
  it('routes through new junctions on the next Day', () => {
    const r = run();
    const apron = { x: 21, y: 13 };
    const taxiwayA = { x: 21, y: 18 };
    // Before: round via the nearest existing link; after: straight down the new link (T-junctions at both ends)
    expect(taxiRoute(buildTaxiNetwork(r.layout), apron, taxiwayA).length).toBeGreaterThan(6);
    const built = confirmBuild(addPending(openBuild(r), taxiwayFromDrag({ x: 21, y: 14 }, { x: 21, y: 17 })));
    expect(taxiRoute(buildTaxiNetwork(built.layout), apron, taxiwayA)).toHaveLength(6);
    const stand3 = built.layout.stands.find((s) => s.id === '3')!;
    const network = buildTaxiNetwork(built.layout);
    expect(routeToStand(network, network.runwayExit, stand3).length).toBeGreaterThan(0);
  });
});

describe('Markings', () => {
  it('put hold-short lines where Taxiways meet the Runway', () => {
    const lines = holdShortLines(startRun(1).layout);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ x: 6, y: 23, w: 3, side: 'north', sign: '09-27' });
  });

  it('place blue edge lights along Taxiway edges but not across junction mouths', () => {
    const lights = taxiwayEdgeLights(startRun(1).layout);
    const key = (x: number, y: number) => lights.some((l) => Math.abs(l.x - x) < 1e-6 && Math.abs(l.y - y) < 1e-6);
    // the parallel Taxiway's north edge (y = 18, drawn half a tile in) has a light at x 20.5 but not at x 16.5, where
    // the link from the apron joins
    expect(key(20.5, 18.5)).toBe(true);
    expect(key(16.5, 18.5)).toBe(false);
  });
});
