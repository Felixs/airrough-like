import { describe, expect, it } from 'vitest';
import { startingAirport } from './layout';
import {
  crashFine, createSimulation, landingOutcome, riskMeter, stepSimulation, takeoffOutcome, taxiIncidentChance,
  type ScheduledFlight, type SimEvent, type Simulation, type SimulationSetup,
} from './simulation';

const layout = startingAirport();
const runUntil = (sim: Simulation, minute: number) => {
  let s = sim;
  while (s.clock.minute < minute) s = stepSimulation(s);
  return s;
};
const flight = (s: Simulation, id: string) => s.flights.find((f) => f.id === id)!;
const sim = (schedule: ScheduledFlight[], extra: Partial<SimulationSetup> = {}) => createSimulation({ layout, schedule, seed: 1, ...extra });
/** First seed in 1..max whose run until `minute` logs an event of `kind`. */
const findSeed = (setup: Omit<SimulationSetup, 'seed'>, minute: number, kind: SimEvent['kind'], max = 3000) => {
  for (let seed = 1; seed <= max; seed++) {
    const end = runUntil(createSimulation({ ...setup, seed }), minute);
    if (end.events.some((e) => e.kind === kind)) return end;
  }
  throw new Error(`no seed with ${kind}`);
};

describe('Risk Meter', () => {
  it('starts at ATC 1.25% and Pilot 0.75% on Asphalt', () => {
    const r = riskMeter(sim([]));
    expect(r.atc).toBeCloseTo(0.0125);
    expect(r.pilot).toBeCloseTo(0.0075);
    expect(r.total).toBeCloseTo(1 - 0.9875 * 0.9925);
  });

  it('drops 15% per Controller Training level and rises 40% per aircraft over Radar capacity', () => {
    expect(riskMeter(sim([], { controllerTrainingLevel: 3 })).atc).toBeCloseTo(0.0125 * 0.7);
    const six = ['1', '2', '3', '4', '5', '6'].map((id): ScheduledFlight => ({ id, type: 'B77W', arrivalMinute: 360 }));
    expect(riskMeter(runUntil(sim(six), 361)).atc).toBeCloseTo(0.0125 * 1.8); // 6 airborne, capacity 4
  });
});

describe('Error outcomes', () => {
  it('maps landing errors to 80% Go-Around, 19% Incident, 1% Crash', () => {
    expect(landingOutcome(0)).toBe('goAround');
    expect(landingOutcome(0.799)).toBe('goAround');
    expect(landingOutcome(0.8)).toBe('incident');
    expect(landingOutcome(0.989)).toBe('incident');
    expect(landingOutcome(0.99)).toBe('crash');
  });

  it('maps takeoff errors to 85% rejected, 14% Incident, 1% Crash', () => {
    expect(takeoffOutcome(0.849)).toBe('rejectedTakeoff');
    expect(takeoffOutcome(0.85)).toBe('incident');
    expect(takeoffOutcome(0.99)).toBe('crash');
  });

  it('a Go-Around sends the aircraft back to Holding without a Movement', () => {
    const end = findSeed({ layout, schedule: [{ id: 'A', type: 'A320', arrivalMinute: 360 }], riskMultiplier: 100 }, 365, 'goAround');
    // back in Holding, and with the Runway free it may already be on its next approach
    expect(['holding', 'landing']).toContain(flight(end, 'A').phase);
    expect(end.landings).toBe(2); // the Go-Around and the next approach
    expect(end.movements).toBe(0);
  });

  it('a landing Crash costs a Crash Fine and blocks the Runway for 60 minutes', () => {
    const schedule: ScheduledFlight[] = [{ id: 'A', type: 'A320', arrivalMinute: 360 }];
    const end = findSeed({ layout, schedule, riskMultiplier: 100 }, 365, 'crash');
    const crash = end.events.find((e) => e.kind === 'crash')!;
    expect(flight(end, 'A').phase).toBe('crashed');
    expect(end.money).toBe(-10_000);
    expect(end.runwayBlockedUntil[0]).toBe(crash.minute + 60);
  });

  it('a Fire & Rescue Station clears a Crash faster', () => {
    const schedule: ScheduledFlight[] = [{ id: 'A', type: 'A320', arrivalMinute: 360 }];
    const end = findSeed({ layout, schedule, riskMultiplier: 100, fireRescueLevel: 2 }, 365, 'crash');
    const crash = end.events.find((e) => e.kind === 'crash')!;
    expect(end.runwayBlockedUntil[0]).toBe(crash.minute + 60 * 0.55);
  });

  it('an Incident blocks the Runway for 20 minutes but the aircraft still lands', () => {
    const end = findSeed({ layout, schedule: [{ id: 'A', type: 'A320', arrivalMinute: 360 }], riskMultiplier: 100 }, 365, 'incident');
    const incident = end.events.find((e) => e.kind === 'incident')!;
    expect(end.runwayBlockedUntil[0]).toBe(incident.minute + 20);
    expect(end.movements).toBe(1);
    expect(end.money).toBeLessThan(0);
  });

  it('a rejected takeoff brakes to the next exit past its roll, then taxis back to a hold point', () => {
    const overnight: ScheduledFlight[] = [{ id: 'N', type: 'A320', arrivalMinute: 0, overnight: true }];
    const found = findSeed({ layout, schedule: overnight, riskMultiplier: 100 }, 6 * 60 + 5, 'rejectedTakeoff');
    let s = createSimulation({ layout, schedule: overnight, riskMultiplier: 100, seed: found.seed });
    while (!s.events.some((e) => e.kind === 'rejectedTakeoff')) s = stepSimulation(s);
    const n = flight(s, 'N');
    const event = s.events.find((e) => e.kind === 'rejectedTakeoff')!;
    expect(event.story).toBeTruthy();
    expect(n.phase).toBe('taxiOut');
    const access = s.network.runways[n.runway]!;
    const hold = access.connectors[n.reverse ? access.connectors.length - 1 : 0]!;
    const start = n.route[0]!;
    // a Medium aircraft needs most of the Medium Runway to stop: it leaves at the far end, not where it lined up
    expect(start.x === hold.x && start.y === hold.y).toBe(false);
    expect(access.connectors.some((c) => c.x === start.x && c.y === start.y)).toBe(true);
    const back = n.route[n.route.length - 1]!;
    expect(back).toEqual(n.holdTile);
    expect(n.altitude).toBe(0);
  });
});

describe('Crash Fines', () => {
  it('scale with Size Class and rise 50% per earlier Crash this Week, capped at ×3', () => {
    expect(crashFine('small', 0)).toBe(5_000);
    expect(crashFine('medium', 0)).toBe(10_000);
    expect(crashFine('large', 0)).toBe(20_000);
    expect(crashFine('medium', 2)).toBe(20_000);
    expect(crashFine('large', 9)).toBe(60_000);
  });
});

describe('Airport Closed and Diversions', () => {
  it('diverts a Holding aircraft at minimum fuel while no Runway is usable, without fees or Movements', () => {
    const end = runUntil(sim([{ id: 'A', type: 'A320', arrivalMinute: 360 }], { runwayBlockedUntil: 600 }), 24 * 60);
    expect(flight(end, 'A').phase).toBe('diverted');
    expect(flight(end, 'A').phaseStart).toBe(400); // 45 min Fuel Reserve, diverted at 5 min left
    expect(end.diversions).toBe(1);
    expect(end.crashes).toBe(0);
    expect(end.money).toBe(0);
    expect(end.movements).toBe(0);
  });

  it('diverts an aircraft no usable Runway fits', () => {
    const end = runUntil(sim([{ id: 'L', type: 'B77W', arrivalMinute: 360 }]), 24 * 60); // Medium Runway only
    expect(flight(end, 'L').phase).toBe('diverted');
  });
});

describe('Taxiway Incidents', () => {
  it('scale with taxiing traffic and drop with Ground Radar', () => {
    expect(taxiIncidentChance(1, 1)).toBe(0);
    expect(taxiIncidentChance(3, 1)).toBeGreaterThan(taxiIncidentChance(2, 1));
    expect(taxiIncidentChance(3, 5)).toBeLessThan(taxiIncidentChance(3, 1));
  });
});
