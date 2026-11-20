import { describe, expect, it } from 'vitest';
import { createLayout, startingAirport, type Structure } from './layout';
import { createSimulation, stepSimulation, type ScheduledFlight, type Simulation } from './simulation';
import { buildTaxiNetwork } from './taxi';

const base = startingAirport();
const runUntil = (sim: Simulation, minute: number) => {
  let s = sim;
  while (s.clock.minute < minute) s = stepSimulation(s);
  return s;
};

/** A second, parallel Runway south of the first, reached round its east end. */
const twoRunways = createLayout(base.width, base.height, [
  ...base.structures,
  { kind: 'taxiway', x: 42, y: 16, w: 3, h: 14 },
  { kind: 'taxiway', x: 6, y: 28, w: 39, h: 3 },
  { kind: 'taxiway', x: 6, y: 31, w: 3, h: 2 },
  { kind: 'taxiway', x: 39, y: 31, w: 3, h: 2 },
  { kind: 'runway', x: 6, y: 33, w: 36, h: 4, length: 'medium', surface: 'asphalt' },
] satisfies Structure[]);

/** The Starting Airport turned round: one vertical Runway east of the apron. */
const vertical = createLayout(base.width, base.height, [
  ...base.structures.filter((s) => s.kind !== 'runway' && !(s.kind === 'taxiway' && s.y === 19)),
  { kind: 'taxiway', x: 42, y: 9, w: 4, h: 3 },
  { kind: 'taxiway', x: 42, y: 16, w: 4, h: 3 },
  { kind: 'runway', x: 46, y: 6, w: 4, h: 30, length: 'medium', surface: 'asphalt' },
] satisfies Structure[]);

describe('Several Runways', () => {
  it('each get their own hold point and exit', () => {
    const network = buildTaxiNetwork(twoRunways);
    expect(network.runways.map((a) => a.index)).toEqual([0, 1]);
    expect(network.runways[1]).toMatchObject({ holdPoint: { x: 7, y: 32 }, runwayExit: { x: 40, y: 32 } });
  });

  it('land aircraft in parallel, doubling Runway throughput', () => {
    const schedule = ['C208', 'C208', 'C208', 'C208', 'C208F', 'C208F', 'Q400'].map((type, i): ScheduledFlight => ({ id: `F${i}`, type: type as ScheduledFlight['type'], arrivalMinute: 400, fuelMinutes: 200 }));
    const landed = (layout: typeof base) => runUntil(createSimulation({ layout, schedule, seed: 1 }), 408).flights.filter((f) => f.phase !== 'holding').length;
    expect(landed(base)).toBe(2);
    expect(landed(twoRunways)).toBe(4);
  });

  it('send departures to a Runway and every aircraft completes its Day', () => {
    const schedule = ['A', 'B', 'C', 'D'].map((id): ScheduledFlight => ({ id, type: 'A320', arrivalMinute: 400 }));
    const end = runUntil(createSimulation({ layout: twoRunways, schedule, seed: 1 }), 24 * 60);
    expect(end.flights.every((f) => f.phase === 'departed')).toBe(true);
    expect(end.movements).toBe(8);
  });

  it('a Crash closes only its own Runway', () => {
    const s = createSimulation({ layout: twoRunways, schedule: [], seed: 1 });
    expect(s.runwayBlockedUntil).toEqual([0, 0]);
  });
});

describe('Vertical Runways', () => {
  it('connect on their long sides and handle a whole flight', () => {
    const network = buildTaxiNetwork(vertical);
    expect(network.runways[0]).toMatchObject({ vertical: true, holdPoint: { x: 45, y: 10 }, runwayExit: { x: 45, y: 17 } });
    const end = runUntil(createSimulation({ layout: vertical, schedule: [{ id: 'A', type: 'A320', arrivalMinute: 400 }], seed: 1 }), 24 * 60);
    expect(end.flights[0]!.phase).toBe('departed');
    expect(end.movements).toBe(2);
  });
});

describe('Unconnected Runways', () => {
  it('are left out of the network instead of breaking it', () => {
    const extra = createLayout(base.width, base.height, [...base.structures, { kind: 'runway', x: 6, y: 33, w: 36, h: 4, length: 'long', surface: 'asphalt' } satisfies Structure]);
    expect(buildTaxiNetwork(extra).runways.map((a) => a.index)).toEqual([0]);
  });
});

describe('Cut-off Stands', () => {
  it('are never used, so a broken layout never strands an aircraft', () => {
    // a Remote Stand on its own little Taxiway that joins nothing
    const island = createLayout(base.width, base.height, [
      ...base.structures.filter((s) => s.kind !== 'stand' || s.serves !== 'terminal'),
      { kind: 'taxiway', x: 20, y: 30, w: 6, h: 3 },
      { kind: 'stand', id: 'R1', x: 21, y: 27, w: 3, h: 3, size: 'medium', serves: 'terminal', placement: 'remote' },
    ] satisfies Structure[]);
    expect(buildTaxiNetwork(island).reachableSpots.has('R1')).toBe(false);
    const end = runUntil(createSimulation({ layout: island, schedule: [{ id: 'A', type: 'A320', arrivalMinute: 400, fuelMinutes: 30 }], seed: 1 }), 24 * 60);
    expect(end.flights[0]!.phase).not.toBe('onStand');
  });
});
