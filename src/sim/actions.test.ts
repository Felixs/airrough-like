import { describe, expect, it } from 'vitest';
import { createLayout, startingAirport, type Structure, type SupportRole } from './layout';
import {
  acknowledgeAlert, actionAvailability, createSimulation, resolveEmergency, resolveFuel, secondRollChance, stepSimulation, useAction,
  type ScheduledFlight, type Simulation, type SimulationSetup,
} from './simulation';

const base = startingAirport();
/** Starting Airport plus Support Buildings on free grass south of the Runway. */
const withSupport = (...roles: SupportRole[]) =>
  createLayout(base.width, base.height, [
    ...base.structures,
    ...roles.map((role, i): Structure => ({ kind: 'supportBuilding', role, x: 8 + i * 4, y: 26, w: 3, h: 2 })),
  ]);
const all = withSupport('rampAgentStation', 'adminOffice', 'airlineOffice');
const runUntil = (sim: Simulation, minute: number) => {
  let s = sim;
  while (s.clock.minute < minute && !s.pendingAlert) s = stepSimulation(s);
  return s;
};
const flight = (s: Simulation, id: string) => s.flights.find((f) => f.id === id)!;
const sim = (schedule: ScheduledFlight[], extra: Partial<SimulationSetup> = {}) => createSimulation({ layout: all, schedule, seed: 1, ...extra });

describe('Emergency Action availability', () => {
  it('need their Support Building', () => {
    const a = actionAvailability(createSimulation({ layout: base, schedule: [], seed: 1 }));
    expect(a.rushTurnaround).toMatchObject({ ready: false, missing: 'rampAgentStation' });
    expect(a.manualDivert).toMatchObject({ ready: false, missing: 'adminOffice' });
    expect(a.priorityLanding).toMatchObject({ ready: false, missing: 'airlineOffice' });
    expect(actionAvailability(sim([])).manualDivert.ready).toBe(true);
  });

  it('go on cooldown after use: Priority Landing 90 min, Manual Divert 60 min, Rush Turnaround 90 min', () => {
    const s = runUntil(sim([{ id: 'H', type: 'B77W', arrivalMinute: 360 }, { id: 'H2', type: 'B77W', arrivalMinute: 360 }, { id: 'A', type: 'A320', arrivalMinute: 360 }]), 400);
    expect(useAction(s, 'priorityLanding', 'H').cooldownUntil.priorityLanding).toBe(490);
    expect(useAction(s, 'manualDivert', 'H').cooldownUntil.manualDivert).toBe(460);
    const used = useAction(s, 'manualDivert', 'H');
    expect(actionAvailability(used).manualDivert).toMatchObject({ ready: false, cooldownLeft: 60 });
    expect(() => useAction(used, 'manualDivert', 'H2')).toThrow();
  });
});

describe('Emergency Actions', () => {
  it('Priority Landing moves a Holding aircraft to the front of the landing queue', () => {
    const s = runUntil(sim([{ id: 'A', type: 'A320', arrivalMinute: 400 }, { id: 'B', type: 'A320', arrivalMinute: 400 }, { id: 'C', type: 'A320', arrivalMinute: 400 }]), 400.25);
    const boosted = useAction(s, 'priorityLanding', 'C');
    const later = runUntil(boosted, 405);
    expect(flight(later, 'C').phase).not.toBe('holding');
    expect(flight(later, 'B').phase).toBe('holding');
  });

  it('Manual Divert sends a Holding aircraft away without fees', () => {
    const s = runUntil(sim([{ id: 'H', type: 'B77W', arrivalMinute: 360 }]), 370);
    const after = useAction(s, 'manualDivert', 'H');
    expect(flight(after, 'H').phase).toBe('diverted');
    expect(after.money).toBe(0);
  });

  it('Rush Turnaround halves the Turnaround at the Stand the most urgent Holding aircraft waits for', () => {
    // Four A320s fill the Terminal Stands; the Bay is taken too; a fifth waits in Holding
    const schedule = ['1', '2', '3', '4', 'X'].map((id): ScheduledFlight => ({ id, type: 'A320', arrivalMinute: 360, fuelMinutes: 200 }))
      .concat({ id: 'W', type: 'A320', arrivalMinute: 381, fuelMinutes: 30 });
    const s = runUntil(sim(schedule), 390);
    expect(flight(s, 'W').phase).toBe('holding');
    const first = s.flights.filter((f) => f.phase === 'onStand').sort((a, b) => a.phaseStart - b.phaseStart)[0]!;
    const rushed = runUntil(useAction(s, 'rushTurnaround'), first.phaseStart + 21);
    expect(flight(rushed, first.id).phase).not.toBe('onStand'); // 40 min Turnaround cut to 20
    expect(rushed.money).toBeGreaterThanOrEqual(600); // its Arrival Fee came early too
  });
});

describe('Low fuel', () => {
  const lowFuel: ScheduledFlight[] = [{ id: 'H', type: 'B77W', arrivalMinute: 360, fuelMinutes: 12 }];
  // the Runway is blocked, so H keeps holding until it runs low
  const holding = () => runUntil(sim(lowFuel, { runwayBlockedUntil: 420, askOnLowFuel: true }), 400);

  it('pauses a played Day for a decision, whatever the Radar', () => {
    const s = holding();
    expect(s.pendingAlert).toMatchObject({ kind: 'fuel', flightId: 'H' });
    expect(stepSimulation(s)).toBe(s); // paused
  });

  it('Divert sends the aircraft away at once, without a fine', () => {
    const after = resolveFuel(holding(), 'divert');
    expect(after.pendingAlert).toBe(null);
    expect(flight(after, 'H').phase).toBe('diverted');
    expect(after.events.at(-1)).toMatchObject({ kind: 'diversion', reason: 'lowFuel', cost: 0 });
  });

  it('a Mayday lands next while every Runway waits for it', () => {
    const schedule: ScheduledFlight[] = [
      { id: 'H', type: 'C208', arrivalMinute: 360, fuelMinutes: 11 },
      { id: 'Q', type: 'C208', arrivalMinute: 359, fuelMinutes: 200 }, // in Holding first, normally lands first
    ];
    let s = runUntil(sim(schedule, { runwayBlockedUntil: 365, askOnLowFuel: true }), 364);
    expect(s.pendingAlert).toMatchObject({ kind: 'fuel', flightId: 'H' });
    s = resolveFuel(s, 'mayday');
    expect(s.mayday).toEqual(['H']);
    s = runUntil(s, 366);
    expect(flight(s, 'H').phase).toBe('landing');
    expect(flight(s, 'Q').phase).toBe('holding'); // nobody else moves while H is landing
  });

  it('turns a Go-Around on a Mayday into a Crash: there is no fuel to try again', () => {
    const schedule: ScheduledFlight[] = [{ id: 'H', type: 'C208', arrivalMinute: 360, fuelMinutes: 11 }];
    let crashed = 0;
    for (let seed = 1; seed <= 400 && !crashed; seed++) {
      let s = runUntil(createSimulation({ layout: all, schedule, seed, runwayBlockedUntil: 365, riskMultiplier: 100, askOnLowFuel: true }), 364);
      if (s.pendingAlert?.kind !== 'fuel') continue;
      s = runUntil(resolveFuel(s, 'mayday'), 380);
      if (s.pendingAlert?.kind === 'emergency') s = runUntil(resolveEmergency(s), 390);
      if (flight(s, 'H').phase === 'crashed') crashed++;
      expect(s.events.some((e) => e.kind === 'goAround' && e.flightId === 'H')).toBe(false);
    }
    expect(crashed).toBe(1);
  });
});

describe('Emergency Alert', () => {
  it('second roll succeeds 50% + 10% per Controller Training level above 1', () => {
    expect(secondRollChance(1)).toBeCloseTo(0.5);
    expect(secondRollChance(4)).toBeCloseTo(0.8);
  });

  it('pauses before an ATC-Error Crash from Radar 3, and a second roll can save the aircraft', () => {
    const schedule: ScheduledFlight[] = [{ id: 'A', type: 'A320', arrivalMinute: 360 }];
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 4000 && outcomes.size < 2; seed++) {
      const s = runUntil(createSimulation({ layout: all, schedule, seed, radarLevel: 3, riskMultiplier: 100 }), 365);
      if (s.pendingAlert?.kind !== 'emergency') continue;
      const resolved = runUntil(resolveEmergency(s), 370);
      outcomes.add(flight(resolved, 'A').phase === 'crashed' ? 'crash' : 'saved');
    }
    expect([...outcomes].sort()).toEqual(['crash', 'saved']);
  });
});

describe('Event pauses', () => {
  it('pause the Day on a Diversion (and Incidents and Crashes) when enabled, until acknowledged', () => {
    // an arrival after dusk with no Lit Runway diverts
    const schedule: ScheduledFlight[] = [{ id: 'A', type: 'A320', arrivalMinute: 20 * 60 + 5 }];
    const paused = runUntil(createSimulation({ layout: base, schedule, seed: 1, pauseOnEvents: true }), 20 * 60 + 10);
    expect(paused.pendingAlert).toMatchObject({ kind: 'event', flightId: 'A' });
    expect(paused.pendingAlert!.events!.map((e) => e.kind)).toEqual(['diversion']);
    expect(stepSimulation(paused)).toBe(paused);
    expect(acknowledgeAlert(paused).pendingAlert).toBe(null);
    expect(runUntil(createSimulation({ layout: base, schedule, seed: 1 }), 20 * 60 + 10).pendingAlert).toBe(null);
  });
});
