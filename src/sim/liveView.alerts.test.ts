import { describe, expect, it } from 'vitest';
import { alerts } from './liveView';
import { startingAirport } from './layout';
import { createSimulation, stepSimulation, type Simulation } from './simulation';

describe('Alerts point at their aircraft', () => {
  it('an alert about a flight carries its id; a Runway change carries none', () => {
    let s: Simulation = createSimulation({ layout: startingAirport(), schedule: [{ id: 'A', type: 'A320', arrivalMinute: 360 }], seed: 1, runwayBlockedUntil: 600 });
    while (!s.events.some((e) => e.kind === 'diversion') && s.clock.minute < 600) s = stepSimulation(s);
    const a = alerts(s).find((x) => x.kind === 'diversion')!;
    expect(a.flightId).toBe('A');
    const fake = { ...s, events: [...s.events, { minute: 500, kind: 'runwayChange' as const, flightId: 'RWY 27', cost: 0 }] };
    expect(alerts(fake)[0]!.flightId).toBeNull();
  });
});
