import { describe, expect, it } from 'vitest';
import { activeDesignator, headwind, landingHeading, wantsReverse, windTimeline } from './wind';

describe('Wind', () => {
  it('is seeded per Day, drifts, and turns round at a Wind Shift', () => {
    const a = windTimeline({ seed: 4 });
    expect(windTimeline({ seed: 4 })).toEqual(a);
    expect(a).toHaveLength(48);
    const shifted = windTimeline({ seed: 4, shifts: [12 * 60] });
    const before = shifted[23]!.direction;
    const after = shifted[24]!.direction;
    expect(Math.abs((((after - before) % 360) + 360) % 360 - 180)).toBeLessThan(40);
  });

  it('lands into the wind and only switches when the tailwind passes 5 kt', () => {
    const westerly = { direction: 270, knots: 10 };
    expect(headwind(westerly, 270)).toBeCloseTo(10);
    expect(wantsReverse(westerly, false, false)).toBe(true); // 10 kt tailwind on 09 → use 27
    expect(wantsReverse({ direction: 0, knots: 10 }, false, true)).toBe(true); // pure crosswind: keep 27
    expect(wantsReverse({ direction: 120, knots: 4 }, false, true)).toBe(true); // light tailwind: keep
    expect(landingHeading(true, false)).toBe(180);
    expect(activeDesignator(false, true)).toBe('27');
  });
});
