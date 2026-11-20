import { describe, expect, it } from 'vitest';
import { advance, createDay, formatClock, isDayOver, parseSpeed } from './clock';

describe('Day clock', () => {
  it('starts a Day at 05:00', () => {
    const day = createDay();
    expect(formatClock(day)).toBe('05:00');
  });

  it('moves in fixed 15-second steps, 30 steps per real second at 1×', () => {
    const day = advance(createDay(), 100, 1);
    expect(day.minute).toBe(300.75); // 3 steps × 15 s
  });

  it('runs 4× as many steps at 4× speed', () => {
    expect(advance(createDay(), 100, 4).minute).toBe(303); // 12 steps
  });

  it('does not move while paused', () => {
    expect(advance(createDay(), 5000, 0).minute).toBe(300);
  });

  it('carries leftover real time across short frames', () => {
    const afterOne = advance(createDay(), 20, 1);
    expect(afterOne.minute).toBe(300); // 20 ms is less than one step
    expect(advance(afterOne, 20, 1).minute).toBe(300.25); // 40 ms in total: one step
  });

  it('ends exactly at 24:00 and does not run past it', () => {
    const fresh = createDay();
    expect(isDayOver(fresh)).toBe(false);
    const over = advance(fresh, 10 * 60 * 1000, 4); // far more than a Day
    expect(over.minute).toBe(1440);
    expect(formatClock(over)).toBe('24:00');
    expect(isDayOver(over)).toBe(true);
    expect(advance(over, 1000, 4).minute).toBe(1440);
  });
});

describe('parseSpeed', () => {
  it('accepts only pause, 1×, 2× and 4×', () => {
    expect(parseSpeed('0')).toBe(0);
    expect(parseSpeed('4')).toBe(4);
    expect(parseSpeed('3')).toBe(undefined);
    expect(parseSpeed('')).toBe(undefined);
    expect(parseSpeed(undefined)).toBe(undefined);
  });
});

describe('daylight', () => {
  it('is dark early, brightens at sunrise, full by day, dims in the evening and is dark at night', async () => {
    const { daylight, NIGHT_DARKNESS } = await import('./clock');
    expect(daylight(5 * 60).darkness).toBe(NIGHT_DARKNESS);
    const sunrise = daylight(6.5 * 60);
    expect(sunrise.darkness).toBe(0.25);
    expect(sunrise.warmth).toBeGreaterThan(0.5);
    expect(daylight(12 * 60).darkness).toBe(0);
    expect(daylight(19.5 * 60).darkness).toBeGreaterThan(0);
    expect(daylight(19.5 * 60).darkness).toBeLessThan(0.3);
    expect(daylight(23 * 60)).toEqual({ darkness: NIGHT_DARKNESS, warmth: 0 });
  });
});

describe('Live speed', () => {
  it('runs one game minute per real minute', async () => {
    const { REAL_TIME, advance, createDay, parseSpeed } = await import('./clock');
    expect(parseSpeed('live')).toBe(REAL_TIME);
    expect(advance(createDay(), 60_000, REAL_TIME).minute).toBeCloseTo(createDay().minute + 1);
    expect(advance(createDay(), 59_000, REAL_TIME).minute).toBe(createDay().minute + 0.75); // whole 15-second steps
  });
});
