import { describe, expect, it } from 'vitest';
import { startingAirport } from './layout';
import { createSimulation, stepSimulation, type Simulation } from './simulation';

const runUntil = (sim: Simulation, minute: number) => {
  let s = sim;
  while (s.clock.minute < minute) s = stepSimulation(s);
  return s;
};

describe('One flight end to end', () => {
  const start = () => createSimulation({ layout: startingAirport(), schedule: [{ id: 'DLH1', type: 'A320', arrivalMinute: 6 * 60 }], seed: 1 });

  it('goes through every phase in order and departs', () => {
    let sim = start();
    const phases: string[] = [];
    while (sim.flights[0]!.phase !== 'departed' && sim.clock.minute < 24 * 60) {
      sim = stepSimulation(sim);
      const p = sim.flights[0]!.phase;
      if (phases[phases.length - 1] !== p) phases.push(p);
    }
    expect(phases).toEqual(['scheduled', 'landing', 'taxiIn', 'onStand', 'taxiOut', 'holdShort', 'takeoff', 'departed']);
  });

  it('pays the Arrival Fee 16 minutes into the 40-minute Turnaround and counts the landing', () => {
    let sim = start();
    while (sim.flights[0]!.phase !== 'onStand') sim = stepSimulation(sim);
    const onStandAt = sim.flights[0]!.phaseStart;
    expect(sim.movements).toBe(1);
    expect(sim.money).toBe(0);
    expect(runUntil(sim, onStandAt + 15.75).money).toBe(0);
    expect(runUntil(sim, onStandAt + 16.25).money).toBe(600); // A320 fee
    // leaves the Stand after 40 minutes
    expect(runUntil(sim, onStandAt + 39.75).flights[0]!.phase).toBe('onStand');
    expect(runUntil(sim, onStandAt + 40.25).flights[0]!.phase).toBe('taxiOut');
  });

  it('pays the Departure Fee on takeoff and ends the Day with 2 Movements', () => {
    const end = runUntil(start(), 24 * 60);
    expect(end.flights[0]!.phase).toBe('departed');
    expect(end.money).toBe(1200);
    expect(end.movements).toBe(2);
  });

  it('replays identically with the same seed', () => {
    const a = runUntil(start(), 9 * 60);
    const b = runUntil(start(), 9 * 60);
    expect(a.flights).toEqual(b.flights);
    expect(a.money).toBe(b.money);
  });

  it('is visible on the airfield only between landing and takeoff', () => {
    let sim = start();
    expect(sim.flights[0]!.position).toBe(null);
    while (sim.flights[0]!.phase !== 'taxiIn') sim = stepSimulation(sim);
    expect(sim.flights[0]!.position).not.toBe(null);
    expect(runUntil(sim, 24 * 60).flights[0]!.position).toBe(null);
  });
});
