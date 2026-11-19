import { describe, expect, it } from 'vitest';
import { startingAirport } from './layout';
import { buildTaxiNetwork, routeFromStand, routeToStand } from './taxi';

describe('Taxi routing on the Starting Airport', () => {
  const airport = startingAirport();
  const network = buildTaxiNetwork(airport);
  const isTaxiwayTile = (x: number, y: number) =>
    airport.structures.some((s) => s.kind === 'taxiway' && x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h);

  it('reaches Stand 3 from the Runway exit on the shortest path', () => {
    const stand = airport.stands.find((s) => s.id === '3')!;
    const route = routeToStand(network, network.runwayExit, stand);
    // Exit (40,21) to the centre of Stand 3 (15,7): 25 tiles west + 14 tiles north, no detour needed.
    expect(route.length - 1).toBe(39);
    expect(route[0]).toEqual({ x: 40, y: 21 });
    expect(route[route.length - 1]).toEqual({ x: 15, y: 7 });
  });

  it('reaches every Stand from the Runway exit and back to the hold point using only Taxiway and that Stand', () => {
    for (const stand of airport.stands) {
      const inside = (t: { x: number; y: number }) => t.x >= stand.x && t.x < stand.x + stand.w && t.y >= stand.y && t.y < stand.y + stand.h;
      const inbound = routeToStand(network, network.runwayExit, stand);
      const outbound = routeFromStand(network, stand, network.holdPoint);
      for (const t of [...inbound, ...outbound]) expect(isTaxiwayTile(t.x, t.y) || inside(t)).toBe(true);
      expect(outbound[outbound.length - 1]).toEqual(network.holdPoint);
      // consecutive tiles are neighbours: no jumps across the Runway or grass
      for (const r of [inbound, outbound]) for (let i = 1; i < r.length; i++) expect(Math.abs(r[i]!.x - r[i - 1]!.x) + Math.abs(r[i]!.y - r[i - 1]!.y)).toBe(1);
    }
  });

  it('holds short at the near end of Runway 09 and exits at the far end', () => {
    expect(network.holdPoint).toEqual({ x: 7, y: 21 });
    expect(network.runwayExit).toEqual({ x: 40, y: 21 });
  });
});
