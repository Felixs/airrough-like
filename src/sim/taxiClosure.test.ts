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

describe('In-trail spacing', () => {
  it('lines departures up behind the hold point instead of stacking them, all through a busy Day', () => {
    const schedule = Array.from({ length: 24 }, (_, k) => ({ id: `F${k}`, type: (k % 3 ? 'A320' : 'Q400') as 'A320' | 'Q400', arrivalMinute: 6 * 60 + k * 6 }));
    let sim: Simulation = createSimulation({ layout, schedule, seed: 3 });
    let worstHolding = 0;
    let stacked = 0;
    while (sim.clock.minute < 15 * 60) {
      sim = stepSimulation(sim);
      if (sim.pendingAlert) sim = { ...sim, pendingAlert: null };
      worstHolding = Math.max(worstHolding, sim.flights.filter((f) => f.phase === 'holdShort').length);
      const still = sim.flights.filter((f) => f.position && (f.phase === 'holdShort' || f.waitingSince !== undefined));
      for (const a of still) for (const b of still) {
        if (a.id < b.id && Math.hypot(a.position!.x - b.position!.x, a.position!.y - b.position!.y) < 8) stacked++;
      }
    }
    expect(sim.flights.filter((f) => f.phase === 'departed').length).toBeGreaterThan(10);
    expect(worstHolding).toBeLessThanOrEqual(1); // one at the hold point, the rest queue behind it
    expect(stacked).toBe(0);
  });
});

describe('Oncoming traffic', () => {
  it('never passes on the same Taxiway: one of the two takes another', () => {
    const east = taxiRoute(network, { x: 8, y: 10 }, { x: 40, y: 10 });
    const west = taxiRoute(network, { x: 40, y: 10 }, { x: 8, y: 10 });
    const base = createSimulation({ layout, seed: 4, schedule: ['A', 'B'].map((id) => ({ id, type: 'A320' as const, arrivalMinute: 1200 })) });
    const go = (route: Tile[]): Partial<Flight> => ({ phase: 'taxiIn', route, routeProgress: 0, stoppedUntil: 0, standId: null, bayId: 'B1', position: { x: 0, y: 0 }, runway: 0 });
    const crafted: Partial<Record<string, Partial<Flight>>> = { A: go(east), B: go(west) };
    let sim: Simulation = { ...base, flights: base.flights.map((f) => ({ ...f, ...crafted[f.id] }) as Flight) };
    let closest = Infinity;
    let tookOther = false;
    const start = sim.clock.minute;
    while (sim.clock.minute < start + 10) {
      sim = stepSimulation(sim);
      const [a, b] = ['A', 'B'].map((id) => sim.flights.find((f) => f.id === id)!);
      tookOther ||= [a!, b!].some((f) => f.route.some((t) => t.y >= 16));
      if (a!.phase === 'taxiIn' && b!.phase === 'taxiIn') closest = Math.min(closest, Math.hypot(a!.position!.x - b!.position!.x, a!.position!.y - b!.position!.y));
    }
    expect(closest).toBeGreaterThanOrEqual(16);
    expect(tookOther).toBe(true); // one of them went round by the lower Taxiway
  });
});

describe('A blocked Runway exit', () => {
  it('keeps arrivals in Holding and lets departures go', async () => {
    const { exitFor } = await import('./taxi');
    const access = network.runways[0]!;
    const exit = exitFor(access, false, 'medium');
    const hold = network.holdPoint;
    let sim: Simulation = createSimulation({ layout, seed: 4, schedule: ['X', 'H', 'D'].map((id) => ({ id, type: 'A320' as const, arrivalMinute: 1200 })) });
    while (sim.clock.minute < 6 * 60 + 5) sim = stepSimulation(sim);
    const now = sim.clock.minute;
    const lane = taxiRoute(network, exit, { x: 40, y: 10 });
    const crafted: Partial<Record<string, Partial<Flight>>> = {
      // stopped by an Incident right at the exit
      X: { phase: 'taxiIn', route: lane, routeProgress: 1, stoppedUntil: now + 30, standId: null, bayId: 'B1', position: { x: 0, y: 0 }, runway: 0 },
      H: { phase: 'holding', phaseStart: now - 1, fuelMinutes: 40 },
      D: { phase: 'holdShort', phaseStart: now - 1, runway: 0, route: [hold], routeProgress: 0, position: { x: 0, y: 0 } },
    };
    sim = { ...sim, flights: sim.flights.map((f) => ({ ...f, ...crafted[f.id] }) as Flight) };
    const phases: string[] = [];
    while (sim.clock.minute < now + 10) {
      sim = stepSimulation(sim);
      if (sim.pendingAlert) sim = { ...sim, pendingAlert: null };
      phases.push(sim.flights.find((f) => f.id === 'H')!.phase);
    }
    expect(phases.every((p) => p === 'holding')).toBe(true);
    expect(['takeoff', 'departed']).toContain(sim.flights.find((f) => f.id === 'D')!.phase);
    while (sim.clock.minute < now + 45) {
      sim = stepSimulation(sim);
      if (sim.pendingAlert) sim = { ...sim, pendingAlert: null };
    }
    expect(sim.flights.find((f) => f.id === 'H')!.phase).not.toBe('holding'); // lands once the exit is clear again
  });
});
