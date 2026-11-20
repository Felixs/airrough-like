import { describe, expect, it } from 'vitest';
import { startingAirport } from './layout';
import { createSimulation, stepSimulation, type Flight, type Simulation } from './simulation';
import { buildTaxiNetwork, detour, taxiRoute, type Tile } from './taxi';

const layout = startingAirport();
const network = buildTaxiNetwork(layout);
const key = (t: Tile) => `${t.x},${t.y}`;
const square = (cx: number, cy: number, r: number) => {
  const out = new Set<string>();
  for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) out.add(`${x},${y}`);
  return out;
};

describe('A Taxiway closed by an Incident', () => {
  it('is driven round when there is another way', () => {
    const route = taxiRoute(network, { x: 8, y: 10 }, { x: 40, y: 10 });
    const closed = square(22, 10, 2);
    const round = detour(network, route, 1, closed)!;
    expect(round).not.toBeNull();
    expect(round.some((t) => closed.has(key(t)))).toBe(false);
    expect(round.slice(0, 2)).toEqual(route.slice(0, 2));
    expect(round[round.length - 1]).toEqual({ x: 40, y: 10 });
    expect(round.some((t) => t.y >= 16)).toBe(true); // down a connector and along the lower Taxiway
  });

  it('has no way round on a dead end', () => {
    const route = taxiRoute(network, { x: 25, y: 10 }, { x: 40, y: 10 });
    expect(detour(network, route, 1, square(36, 10, 2))).toBeNull();
  });

  it('makes aircraft wait in line in front of it, and carry on once it is cleared', () => {
    const lane = taxiRoute(network, { x: 25, y: 10 }, { x: 40, y: 10 });
    const base = createSimulation({
      layout, seed: 4, groundRadarLevel: 5,
      schedule: ['A', 'B', 'C'].map((id) => ({ id, type: 'A320' as const, arrivalMinute: 1200 })),
    });
    const now = base.clock.minute;
    const at = (progress: number, stoppedUntil = 0): Partial<Flight> => ({
      phase: 'taxiIn', route: lane, routeProgress: progress, stoppedUntil, standId: null, bayId: 'B1', position: { x: 0, y: 0 }, runway: 0,
    });
    const crafted: Partial<Record<string, Partial<Flight>>> = { A: at(11, now + 10), B: at(3), C: at(0) };
    let sim: Simulation = { ...base, flights: base.flights.map((f) => ({ ...f, ...crafted[f.id] }) as Flight) };
    const get = (id: string) => sim.flights.find((f) => f.id === id)!;
    const x = (id: string) => get(id).route[Math.floor(get(id).routeProgress)]!.x;
    while (sim.clock.minute < now + 8) sim = stepSimulation(sim);
    expect(get('A').routeProgress).toBe(11);
    expect(x('B')).toBeLessThan(lane[10]!.x - 1); // stopped short of the closed Taxiway (A's tiles ±1)
    expect(get('B').waitingSince).toBeDefined();
    expect(x('C')).toBeLessThan(x('B') - 1); // in line behind B, not on top of it
    const waited = get('B').routeProgress;
    while (sim.clock.minute < now + 11) sim = stepSimulation(sim);
    expect(get('B').waitingSince).toBeUndefined();
    expect(get('B').route !== lane || get('B').routeProgress > waited).toBe(true); // moving again once it is cleared
  });
});

describe('Taxi routes', () => {
  it('keep to the centre line (the yellow line) and leave it only to turn into a Stand', async () => {
    const { routeToStand } = await import('./taxi');
    const along = taxiRoute(network, { x: 8, y: 10 }, { x: 40, y: 10 });
    expect(along.every((t) => t.y === 10)).toBe(true);
    const stand = layout.stands.find((s) => s.id === 'C2')!;
    const route = routeToStand(network, network.runwayExit, stand);
    const onTaxiway = route.filter((t) => network.tiles.has(key(t)));
    const off = onTaxiway.filter((t) => !network.centre.has(key(t)));
    expect(off.length).toBeLessThanOrEqual(3); // the hold point / exit and the Stand entry only
  });
});
