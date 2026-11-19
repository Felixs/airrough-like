import { describe, expect, it } from 'vitest';
import { startingAirport } from './layout';
import { alerts, flightStrips, movementsPerHour, quotaProgress, runwayStatus, standsStatus } from './liveView';
import { createSimulation, stepSimulation, type ScheduledFlight, type Simulation } from './simulation';

const layout = startingAirport();
const runUntil = (sim: Simulation, minute: number) => {
  let s = sim;
  while (s.clock.minute < minute) s = stepSimulation(s);
  return s;
};
const sim = (schedule: ScheduledFlight[], extra: object = {}) => createSimulation({ layout, schedule, seed: 1, ...extra });

describe('Flight strips', () => {
  it('sort aircraft into Inbound, Holding and Ground', () => {
    const s = runUntil(sim([
      { id: 'IN', type: 'A320', arrivalMinute: 500 },
      { id: 'H1', type: 'B77W', arrivalMinute: 360 },
      { id: 'G1', type: 'Q400', arrivalMinute: 361 },
    ]), 380);
    const strips = flightStrips(s);
    expect(strips.inbound.map((f) => f.id)).toEqual(['IN']);
    expect(strips.inbound[0]!.eta).toBe(500);
    expect(strips.holding.map((f) => f.id)).toEqual(['H1']);
    expect(strips.ground.map((f) => f.id)).toEqual(['G1']);
  });

  it('show Fuel Reserve on Holding strips and flag low fuel', () => {
    const s = runUntil(sim([{ id: 'H1', type: 'B77W', arrivalMinute: 360, fuelMinutes: 15 }]), 367);
    const [h] = flightStrips(s).holding;
    expect(h!.fuelMinutes).toBe(8);
    expect(h!.lowFuel).toBe(true);
  });
});

describe('Quota progress', () => {
  it('shows Movements / Quota, how many are still needed, and a pace marker over operating hours', () => {
    const s = runUntil(sim([]), 15 * 60);
    const q = quotaProgress(s, 90);
    expect(q).toMatchObject({ movements: 0, quota: 90, stillNeeded: 90, met: false });
    expect(q.pace).toBe(45); // halfway between 06:00 and 24:00
  });
});

describe('Alerts', () => {
  it('list low fuel, Go-Arounds, Incidents and Crashes newest first', () => {
    const s = runUntil(sim([{ id: 'L', type: 'B77W', arrivalMinute: 360, fuelMinutes: 12 }], { runwayBlockedUntil: 0 }), 380);
    const list = alerts(s);
    expect(list[0]!.kind).toBe('diversion');
    expect(list.map((a) => a.kind)).toContain('lowFuel');
    expect(list.every((a) => a.text.length > 0)).toBe(true);
  });
});

describe('Stands panel', () => {
  it('shows each Stand and Holding Bay as free or busy with its aircraft', () => {
    const s = runUntil(sim([{ id: 'A', type: 'A320', arrivalMinute: 360 }]), 380);
    const stands = standsStatus(s);
    expect(stands.map((x) => x.id)).toEqual(['1', '2', '3', '4', 'C1', 'C2', 'B1']);
    const busy = stands.filter((x) => x.flightId);
    expect(busy).toHaveLength(1);
    expect(busy[0]).toMatchObject({ id: '1', flightId: 'A', aircraft: 'A320', state: 'busy' });
    expect(stands.find((x) => x.id === 'B1')).toMatchObject({ kind: 'holdingBay', state: 'free' });
  });
});

describe('Runway chip', () => {
  it('says open, blocked until a time, or closed for the night', () => {
    expect(runwayStatus(runUntil(sim([]), 400)).state).toBe('open');
    const blocked = runwayStatus(runUntil(sim([], { runwayBlockedUntil: 500 }), 400));
    expect(blocked).toMatchObject({ state: 'blocked', until: 500 });
    expect(runwayStatus(runUntil(sim([]), 20 * 60 + 1)).state).toBe('dark');
    expect(runwayStatus(sim([])).state).toBe('curfew');
  });
});

describe('Movements per hour', () => {
  it('counts done Movements per hour against the forecast', () => {
    const schedule: ScheduledFlight[] = [{ id: 'A', type: 'C208', arrivalMinute: 6 * 60 + 5 }];
    const s = runUntil(sim(schedule), 24 * 60);
    const hours = movementsPerHour(s, schedule);
    expect(hours).toHaveLength(19); // 05:00–24:00
    expect(hours[1]).toMatchObject({ hour: 6 });
    expect(hours.reduce((n: number, h: { done: number }) => n + h.done, 0)).toBe(2);
    expect(hours.reduce((n: number, h: { forecast: number }) => n + h.forecast, 0)).toBe(2);
    expect(hours[1]!.done).toBeGreaterThanOrEqual(1);
  });
});

describe('No overflights', () => {
  it('Holding aircraft are not drawn on the map', () => {
    const s = runUntil(sim([{ id: 'H1', type: 'B77W', arrivalMinute: 360 }]), 370);
    expect(s.flights[0]!.position).toBe(null);
  });
});
