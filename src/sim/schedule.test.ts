import { describe, expect, it } from 'vitest';
import { AIRCRAFT_TYPES } from './aircraft';
import { createLayout, startingAirport, type Structure } from './layout';
import { planDay } from './schedule';

const airport = startingAirport();
const MON = 0;
const THU = 3;
const SAT = 5;
const SUN = 6;
const sizeOf = (f: { type: keyof typeof AIRCRAFT_TYPES }) => AIRCRAFT_TYPES[f.type].size;

/** A big airport that can handle everything, so caps never bite. */
const bigAirport = () =>
  createLayout(
    airport.width,
    airport.height,
    airport.structures.map((s): Structure => {
      if (s.kind === 'runway') return { ...s, length: 'long' };
      if (s.kind === 'stand') return { ...s, size: 'large' };
      return s;
    }),
  );

describe('Demand and Daily Quota', () => {
  it('follows the difficulty curve and day factors', () => {
    expect(planDay({ layout: airport, week: 1, weekday: MON, seed: 1 }).demand).toBe(30);
    expect(planDay({ layout: airport, week: 2, weekday: MON, seed: 1 }).demand).toBe(50);
    expect(planDay({ layout: airport, week: 1, weekday: THU, seed: 1 }).demand).toBe(35); // 30 × 1.15 = 34.5
    expect(planDay({ layout: airport, week: 1, weekday: SAT, seed: 1 }).demand).toBe(60);
    expect(planDay({ layout: airport, week: 3, weekday: SUN, seed: 1 }).demand).toBe(112);
  });

  it('sets the Quota at 75% of Demand × 2 Movements, 90% on Boss Days', () => {
    expect(planDay({ layout: airport, week: 1, weekday: MON, seed: 1 }).quota).toBe(45);
    expect(planDay({ layout: airport, week: 1, weekday: SUN, seed: 1 }).quota).toBe(87); // 48 × 2 × 0.9 = 86.4
  });
});

describe('Schedule', () => {
  it('in Week 1, swaps aircraft the airport cannot handle for Small ones', () => {
    const allSmall = createLayout(
      airport.width,
      airport.height,
      airport.structures.map((s): Structure => (s.kind === 'stand' ? { ...s, size: 'small' } : s)),
    );
    const day = planDay({ layout: allSmall, week: 1, weekday: MON, seed: 3 });
    expect(day.schedule.every((f) => sizeOf(f) === 'small')).toBe(true);
    expect(day.schedule.length).toBe(30);
  });

  it('from Week 2, aircraft that cannot be handled do not come, with the reason in the Forecast', () => {
    const day = planDay({ layout: airport, week: 3, weekday: MON, seed: 3 });
    expect(day.schedule.some((f) => sizeOf(f) === 'large')).toBe(false);
    expect(day.forecast.turnedAway.noFittingStand + day.forecast.turnedAway.noFittingRunway).toBeGreaterThan(0);
    expect(day.schedule.length + day.forecast.turnedAway.total).toBe(day.demand);
  });

  it('caps arrivals per Size Class and Purpose by fitting Stands', () => {
    // Starting Airport: 2 Medium cargo Stands → at most 16 Medium cargo, 20 Small cargo arrivals
    const day = planDay({ layout: airport, week: 4, weekday: SAT, seed: 5 });
    const cargo = day.schedule.filter((f) => AIRCRAFT_TYPES[f.type].purpose === 'cargo');
    expect(cargo.filter((f) => sizeOf(f) === 'medium').length).toBeLessThanOrEqual(16);
    expect(cargo.filter((f) => sizeOf(f) === 'small').length).toBeLessThanOrEqual(20);
    expect(day.forecast.turnedAway.standCapacity).toBeGreaterThan(0);
  });

  it('brings Large aircraft only from Thursday of Week 2', () => {
    const countLarge = (week: number, weekday: number) =>
      [1, 2, 3, 4, 5, 6, 7, 8].reduce((n, seed) => n + planDay({ layout: bigAirport(), week, weekday, seed }).forecast.arrivalsBySize.large, 0);
    expect(countLarge(1, SUN)).toBe(0);
    expect(countLarge(2, 2)).toBe(0); // Wednesday
    expect(countLarge(2, THU)).toBeGreaterThan(0);
    expect(countLarge(4, MON)).toBeGreaterThan(countLarge(2, THU));
  });

  it('has about 25% Cargo', () => {
    let cargo = 0;
    let all = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const day = planDay({ layout: bigAirport(), week: 2, weekday: MON, seed });
      all += day.schedule.length;
      cargo += day.schedule.filter((f) => AIRCRAFT_TYPES[f.type].purpose === 'cargo').length;
    }
    expect(cargo / all).toBeGreaterThan(0.18);
    expect(cargo / all).toBeLessThan(0.32);
  });

  it('spreads arrivals over 06:00–22:00 with morning and evening peaks, plus ≈12% overnight aircraft', () => {
    const flights = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((seed) => planDay({ layout: bigAirport(), week: 2, weekday: MON, seed }).schedule);
    const arrivals = flights.filter((f) => !f.overnight);
    expect(arrivals.every((f) => f.arrivalMinute >= 6 * 60 && f.arrivalMinute < 22 * 60)).toBe(true);
    const inHours = (a: number, b: number) => arrivals.filter((f) => f.arrivalMinute >= a * 60 && f.arrivalMinute < b * 60).length;
    expect(inHours(7, 10)).toBeGreaterThan(inHours(12, 15));
    expect(inHours(17, 20)).toBeGreaterThan(inHours(12, 15));
    const share = flights.filter((f) => f.overnight).length / flights.length;
    expect(share).toBeGreaterThan(0.07);
    expect(share).toBeLessThan(0.17);
  });

  it('is the same for the same seed and differs for another', () => {
    const a = planDay({ layout: airport, week: 2, weekday: MON, seed: 9 });
    expect(planDay({ layout: airport, week: 2, weekday: MON, seed: 9 })).toEqual(a);
    expect(planDay({ layout: airport, week: 2, weekday: MON, seed: 10 }).schedule).not.toEqual(a.schedule);
  });

  it('summarises arrivals by Size Class in the Forecast', () => {
    const day = planDay({ layout: airport, week: 2, weekday: MON, seed: 2 });
    const f = day.forecast.arrivalsBySize;
    expect(f.small + f.medium + f.large).toBe(day.schedule.length);
    expect(day.forecast.quota).toBe(day.quota);
  });
});

describe('Schedule without overnight aircraft', () => {
  it('turns every flight into a daytime arrival', () => {
    const day = planDay({ layout: airport, week: 1, weekday: 1, seed: 4, includeOvernight: false });
    expect(day.schedule.some((f) => f.overnight)).toBe(false);
    expect(day.schedule.length).toBe(planDay({ layout: airport, week: 1, weekday: 1, seed: 4 }).schedule.length);
  });
});
