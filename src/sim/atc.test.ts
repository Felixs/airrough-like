import { describe, expect, it } from 'vitest';
import { startingAirport } from './layout';
import { createSimulation, radarLoad, stepSimulation, type ScheduledFlight, type Simulation } from './simulation';

const runUntil = (sim: Simulation, minute: number) => {
  let s = sim;
  while (s.clock.minute < minute) s = stepSimulation(s);
  return s;
};
const sim = (schedule: ScheduledFlight[], radarLevel?: number) => createSimulation({ layout: startingAirport(), schedule, seed: 1, ...(radarLevel ? { radarLevel } : {}) });
const flight = (s: Simulation, id: string) => s.flights.find((f) => f.id === id)!;
/** Minute the flight entered `phase`, stepping until it does. */
const whenPhase = (start: Simulation, id: string, phase: string) => {
  let s = start;
  while (flight(s, id).phase !== phase && s.clock.minute < 24 * 60) s = stepSimulation(s);
  return flight(s, id).phaseStart;
};

describe('Runway assignment and Holding', () => {
  it('lands arrivals one at a time in the order they reached Holding', () => {
    const s = sim([
      { id: 'A', type: 'A320', arrivalMinute: 360 },
      { id: 'B', type: 'B738', arrivalMinute: 360 },
      { id: 'C', type: 'Q400', arrivalMinute: 359 },
    ]);
    expect(whenPhase(s, 'C', 'landing')).toBe(359);
    expect(whenPhase(s, 'A', 'landing')).toBe(362);
    expect(whenPhase(s, 'B', 'landing')).toBe(365);
    expect(flight(runUntil(s, 361), 'B').phase).toBe('holding');
  });

  it('gives low-fuel aircraft landing priority', () => {
    const s = sim([
      { id: 'A', type: 'A320', arrivalMinute: 360 },
      { id: 'B', type: 'A320', arrivalMinute: 360 },
      { id: 'LOW', type: 'A320', arrivalMinute: 360, fuelMinutes: 8 },
    ]);
    expect(whenPhase(s, 'LOW', 'landing')).toBe(360);
    expect(whenPhase(s, 'A', 'landing')).toBe(363);
  });

  it('counts down the Fuel Reserve by Size Class while Holding', () => {
    const s = runUntil(sim([{ id: 'S', type: 'C208', arrivalMinute: 360 }, { id: 'M', type: 'A320', arrivalMinute: 360 }, { id: 'L', type: 'B77W', arrivalMinute: 360 }]), 370);
    expect(flight(s, 'L').fuelMinutes).toBe(45); // 55 − 10; no Large Stand, so it keeps Holding
  });

  it('Crashes an aircraft whose Fuel Reserve runs out', () => {
    // The Starting Airport has no Large Stand, so the B777 can never land
    const end = runUntil(sim([{ id: 'L', type: 'B77W', arrivalMinute: 360 }]), 420);
    expect(flight(end, 'L').phase).toBe('crashed');
    expect(flight(end, 'L').phaseStart).toBe(415);
    expect(flight(end, 'L').position).toBe(null);
    expect(end.crashes).toBe(1);
  });

  it('only starts a landing when a fitting Stand can be reserved', () => {
    // Four terminal Stands: the fifth A320 waits for the first to leave
    const five = ['1', '2', '3', '4', '5'].map((id): ScheduledFlight => ({ id, type: 'A320', arrivalMinute: 360, fuelMinutes: 120 }));
    const s = sim(five);
    const firstOff = whenPhase(s, '1', 'taxiOut');
    expect(whenPhase(s, '5', 'landing')).toBeGreaterThanOrEqual(firstOff);
    expect(flight(runUntil(s, 24 * 60), '5').phase).toBe('departed');
  });

  it('lets a waiting departure take the Runway after 3 minutes even with arrivals queued', () => {
    const alone = sim([{ id: 'N', type: 'A320', arrivalMinute: 0, overnight: true }]);
    const holdAt = whenPhase(alone, 'N', 'holdShort');
    const arrivals = ['C208F', 'C208F', 'C208', 'C208', 'Q400', 'A320'].map((type, i): ScheduledFlight => ({ id: `ARR${i}`, type: type as ScheduledFlight['type'], arrivalMinute: holdAt - 1 }));
    const busy = sim([{ id: 'N', type: 'A320', arrivalMinute: 0, overnight: true }, ...arrivals]);
    const takeoffAt = whenPhase(busy, 'N', 'takeoff');
    expect(takeoffAt).toBeGreaterThanOrEqual(holdAt + 3);
    expect(takeoffAt).toBeLessThanOrEqual(holdAt + 6);
  });
});

describe('Radar capacity', () => {
  it('is 2 + 2 × Radar level aircraft airborne', () => {
    const six = ['1', '2', '3', '4', '5', '6'].map((id): ScheduledFlight => ({ id, type: 'B77W', arrivalMinute: 360 }));
    expect(radarLoad(runUntil(sim(six), 361))).toEqual({ airborne: 6, capacity: 4, over: 2 });
    expect(radarLoad(runUntil(sim(six, 2), 361))).toEqual({ airborne: 6, capacity: 6, over: 0 });
  });
});
