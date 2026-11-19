import { describe, expect, it } from 'vitest';
import { createLayout, startingAirport, type RunwaySurface, type Structure } from './layout';
import { carryOver, createSimulation, stepSimulation, type ScheduledFlight, type Simulation } from './simulation';

const withRunway = (surface: RunwaySurface, length: 'short' | 'medium' | 'long' = 'medium') => {
  const base = startingAirport();
  return createLayout(base.width, base.height, base.structures.map((s): Structure => (s.kind === 'runway' ? { ...s, surface, length } : s)));
};
const runUntil = (sim: Simulation, minute: number) => {
  let s = sim;
  while (s.clock.minute < minute) s = stepSimulation(s);
  return s;
};
const flight = (s: Simulation, id: string) => s.flights.find((f) => f.id === id)!;
const run = (surface: RunwaySurface, schedule: ScheduledFlight[], until = 24 * 60) =>
  runUntil(createSimulation({ layout: withRunway(surface), schedule, seed: 1 }), until);

describe('Operating hours', () => {
  it('holds overnight departures until operations start at 06:00', () => {
    const s = createSimulation({ layout: withRunway('asphalt'), schedule: [{ id: 'N', type: 'C208', arrivalMinute: 0, overnight: true }], seed: 1 });
    expect(flight(runUntil(s, 359.75), 'N').phase).toBe('holdShort');
    expect(flight(runUntil(s, 360.25), 'N').phase).toBe('takeoff');
  });
});

describe('Dusk', () => {
  it('diverts Holding aircraft at 20:00 when no Lit or ILS Runway can take them', () => {
    const late: ScheduledFlight[] = [{ id: 'A', type: 'A320', arrivalMinute: 1199 }, { id: 'B', type: 'A320', arrivalMinute: 1199 }];
    const end = run('asphalt', late);
    expect(flight(end, 'A').phase).not.toBe('diverted'); // first in the queue lands before dusk
    expect(flight(end, 'B').phase).toBe('diverted');
    expect(flight(end, 'B').phaseStart).toBe(1200);
  });

  it('diverts arrivals after dusk on an unlit Runway, but not on a Lit one', () => {
    const evening: ScheduledFlight[] = [{ id: 'E', type: 'A320', arrivalMinute: 21 * 60 }];
    expect(flight(run('asphalt', evening), 'E').phase).toBe('diverted');
    expect(flight(run('lit', evening), 'E').phase).toBe('departed');
    expect(flight(run('ils', evening), 'E').phase).toBe('departed');
  });

  it('keeps aircraft on their Stand after dusk when the Runway is unlit', () => {
    const end = run('asphalt', [{ id: 'S', type: 'A320', arrivalMinute: 19 * 60 + 30 }]);
    expect(flight(end, 'S').phase).toBe('onStand');
  });
});

describe('Grass Runways', () => {
  it('take Small aircraft only', () => {
    const end = run('grass', [{ id: 'S', type: 'C208', arrivalMinute: 360 }, { id: 'M', type: 'A320', arrivalMinute: 360 }]);
    expect(flight(end, 'S').phase).toBe('departed');
    expect(flight(end, 'M').phase).toBe('diverted');
  });
});

describe('Curfew', () => {
  it('stops new arrivals entering Holding after 22:00', () => {
    const end = run('lit', [{ id: 'X', type: 'A320', arrivalMinute: 22 * 60 + 10 }]);
    expect(flight(end, 'X').phase).toBe('diverted');
    expect(end.movements).toBe(0);
  });

  it('diverts anything still airborne at 24:00', () => {
    // Runway closed: the aircraft has fuel to spare but the Day ends
    const s = createSimulation({ layout: withRunway('lit'), schedule: [{ id: 'H', type: 'A320', arrivalMinute: 21 * 60 + 50, fuelMinutes: 500 }], seed: 1, runwayBlockedUntil: 24 * 60 });
    const end = runUntil(s, 24 * 60);
    expect(flight(end, 'H').phase).toBe('diverted');
    expect(end.diversions).toBe(1);
  });
});

describe('Overnight carry-over', () => {
  it('turns aircraft left on Stands into the next Day’s overnight aircraft', () => {
    const end = run('asphalt', [{ id: 'S', type: 'A320', arrivalMinute: 19 * 60 + 30 }, { id: 'D', type: 'C208', arrivalMinute: 360 }]);
    const next = carryOver(end);
    expect(next).toEqual([{ id: 'S', type: 'A320', arrivalMinute: 0, overnight: true, arrivalFeePaid: true }]);
    const tomorrow = createSimulation({ layout: withRunway('asphalt'), schedule: next, seed: 2 });
    expect(flight(tomorrow, 'S').phase).toBe('onStand');
    const later = runUntil(tomorrow, 24 * 60);
    expect(flight(later, 'S').phase).toBe('departed');
    expect(later.money).toBe(600); // Departure Fee only; the Arrival Fee was paid yesterday
  });

  it('collects the Arrival Fee next morning if unloading had not finished', () => {
    const end = run('asphalt', [{ id: 'S', type: 'A320', arrivalMinute: 19 * 60 + 55 }], 20 * 60 + 15);
    expect(flight(end, 'S').unloaded).toBe(false);
    const next = carryOver(end);
    expect(next[0]!.arrivalFeePaid).toBe(false);
    const later = runUntil(createSimulation({ layout: withRunway('asphalt'), schedule: next, seed: 2 }), 24 * 60);
    expect(later.money).toBe(1200);
  });
});
