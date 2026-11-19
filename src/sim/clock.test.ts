import { describe, expect, it } from 'vitest';
import { advance, createDay, formatClock, isDayOver } from './clock';

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
