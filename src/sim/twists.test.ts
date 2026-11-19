import { describe, expect, it } from 'vitest';
import { createLayout, startingAirport, type RunwaySurface, type Structure } from './layout';
import { planDay } from './schedule';
import { createSimulation, stepSimulation, type ScheduledFlight, type Simulation, type SimulationSetup } from './simulation';
import { BOSS_TWISTS, simulationEffects, trafficEffects, twistFor } from './twists';

const runUntil = (sim: Simulation, minute: number) => {
  let s = sim;
  while (s.clock.minute < minute) s = stepSimulation(s);
  return s;
};
const withSurface = (surface: RunwaySurface) => {
  const base = startingAirport();
  return createLayout(base.width, base.height, base.structures.map((s): Structure => (s.kind === 'runway' ? { ...s, surface } : s)));
};
const sim = (schedule: ScheduledFlight[], extra: Partial<SimulationSetup> = {}, surface: RunwaySurface = 'asphalt') =>
  createSimulation({ layout: withSurface(surface), schedule, seed: 1, ...extra });

describe('Which Days get a Twist', () => {
  it('every Boss Day has a Boss Twist at the Week’s Severity', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const week of [1, 2, 3, 4, 6]) {
        const t = twistFor(seed, week, 6)!;
        expect(t.boss).toBe(true);
        expect(t.severity).toBe(Math.min(4, week));
      }
    }
  });

  it('Boss Twists come from all three Families across Runs', () => {
    const families = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) families.add(twistFor(seed, 2, 6)!.family);
    expect([...families].sort()).toEqual(['infrastructure', 'surge', 'weather']);
  });

  it('weekdays have about a 20% chance of a Severity-1 Twist', () => {
    let twists = 0;
    let days = 0;
    for (let seed = 1; seed <= 100; seed++) {
      for (let weekday = 0; weekday < 6; weekday++) {
        days++;
        const t = twistFor(seed, 2, weekday);
        if (t) {
          twists++;
          expect(t.severity).toBe(1);
          expect(t.boss).toBe(false);
        }
      }
    }
    expect(twists / days).toBeGreaterThan(0.14);
    expect(twists / days).toBeLessThan(0.26);
  });

  it('names follow the Families', () => {
    expect(BOSS_TWISTS.weather.map((t) => t.name)).toEqual(['Windy', 'Heavy Rain & Crosswind', 'Storm', 'Thunderstorm']);
    expect(BOSS_TWISTS.infrastructure.map((t) => t.name)).toEqual(['Taxiway works', 'Runway inspection', 'Runway closure', 'Power outage']);
    expect(BOSS_TWISTS.surge.map((t) => t.name)).toEqual(['Extra flights', 'More Medium', 'Heavy Day', 'Surprise rush hour']);
  });
});

describe('Traffic Surge', () => {
  it('adds 15% / 25% / 40% / 50% Demand and shifts the mix', () => {
    expect(trafficEffects({ family: 'surge', severity: 1 }).demandFactor).toBeCloseTo(1.15);
    expect(trafficEffects({ family: 'surge', severity: 4 }).demandFactor).toBeCloseTo(1.5);
    const plain = planDay({ layout: startingAirport(), week: 3, weekday: 6, seed: 1 });
    const heavy = planDay({ layout: startingAirport(), week: 3, weekday: 6, seed: 1, twist: { family: 'surge', severity: 3 } });
    expect(heavy.demand).toBe(Math.round(plain.demand * 1.4));
    expect(heavy.quota).toBeGreaterThan(plain.quota);
    expect(trafficEffects({ family: 'surge', severity: 3 }).largeShift).toBeGreaterThan(0);
  });

  it('a Surprise rush hour makes sharper peaks', () => {
    const peakShare = (twist?: { family: 'surge'; severity: number }) => {
      let inPeak = 0;
      let all = 0;
      for (let seed = 1; seed <= 10; seed++) {
        for (const f of planDay({ layout: startingAirport(), week: 2, weekday: 1, seed, ...(twist ? { twist } : {}) }).schedule) {
          all++;
          if (Math.abs(f.arrivalMinute - 8.5 * 60) < 30 || Math.abs(f.arrivalMinute - 17.75 * 60) < 30) inPeak++;
        }
      }
      return inPeak / all;
    };
    expect(peakShare({ family: 'surge', severity: 4 })).toBeGreaterThan(peakShare() + 0.1);
  });
});

describe('Weather', () => {
  it('raises error chances, softened by the Weather Station', () => {
    const windy = simulationEffects({ family: 'weather', severity: 1 }, 1, 1);
    expect(windy.riskMultiplier).toBeGreaterThan(1);
    expect(simulationEffects({ family: 'weather', severity: 1 }, 1, 5).riskMultiplier).toBeLessThan(windy.riskMultiplier);
  });

  it('a Wind Shift closes every Runway for 15 minutes', () => {
    const e = simulationEffects({ family: 'weather', severity: 2 }, 3, 1);
    const shift = e.windows.find((w) => w.kind === 'closed')!;
    expect(shift.to - shift.from).toBe(15);
    expect(shift.runway).toBeUndefined();
  });

  it('a Storm allows landings only on ILS Runways for hours', () => {
    const e = simulationEffects({ family: 'weather', severity: 3 }, 3, 1);
    const storm = e.windows.find((w) => w.kind === 'ilsOnly')!;
    expect(storm.to - storm.from).toBeGreaterThanOrEqual(120);
    const arrive = storm.from + 10;
    const flight: ScheduledFlight[] = [{ id: 'A', type: 'A320', arrivalMinute: arrive, fuelMinutes: 20 }];
    expect(runUntil(sim(flight, { windows: e.windows }), arrive + 20).flights[0]!.phase).toBe('diverted');
    expect(runUntil(sim(flight, { windows: e.windows }, 'ils'), arrive + 20).flights[0]!.phase).not.toBe('diverted');
  });

  it('a Thunderstorm closes the airport for an hour; a better Weather Station shortens it', () => {
    const closure = (level: number) => {
      const w = simulationEffects({ family: 'weather', severity: 4 }, 3, level).windows.find((x) => x.kind === 'closed' && x.to - x.from > 15)!;
      return w.to - w.from;
    };
    expect(closure(1)).toBe(60);
    expect(closure(5)).toBeLessThan(60);
  });
});

describe('Infrastructure', () => {
  it('Taxiway works slow taxiing', () => {
    const e = simulationEffects({ family: 'infrastructure', severity: 1 }, 1, 1);
    expect(e.taxiSpeedFactor).toBeLessThan(1);
    const flight: ScheduledFlight[] = [{ id: 'A', type: 'A320', arrivalMinute: 400 }];
    const progress = (s: Simulation) => s.flights[0]!.routeProgress;
    expect(progress(runUntil(sim(flight, { taxiSpeedFactor: e.taxiSpeedFactor }), 406))).toBeLessThan(progress(runUntil(sim(flight), 406)));
  });

  it('a Runway inspection closes the first Runway for an hour, a Runway closure for four', () => {
    const inspection = simulationEffects({ family: 'infrastructure', severity: 2 }, 1, 1).windows[0]!;
    expect(inspection).toMatchObject({ kind: 'closed', runway: 0 });
    expect(inspection.to - inspection.from).toBe(60);
    const closure = simulationEffects({ family: 'infrastructure', severity: 3 }, 1, 1).windows[0]!;
    expect(closure.to - closure.from).toBe(240);
    const flight: ScheduledFlight[] = [{ id: 'A', type: 'A320', arrivalMinute: inspection.from + 5, fuelMinutes: 200 }];
    const s = runUntil(sim(flight, { windows: [inspection] }), inspection.to - 1);
    expect(s.flights[0]!.phase).toBe('holding');
  });

  it('a Power outage turns off Runway lights, so evening flights divert even on a Lit Runway', () => {
    const e = simulationEffects({ family: 'infrastructure', severity: 4 }, 1, 1);
    expect(e.noLights).toBe(true);
    const evening: ScheduledFlight[] = [{ id: 'E', type: 'A320', arrivalMinute: 21 * 60 }];
    expect(runUntil(sim(evening, { noLights: true }, 'lit'), 24 * 60).flights[0]!.phase).toBe('diverted');
  });
});
