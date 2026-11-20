import { describe, expect, it } from 'vitest';
import { advanceAlong, TIMINGS } from './simulation';

const straight = Array.from({ length: 10 }, (_, x) => ({ x, y: 0 }));
// east 4 tiles, then turns south at x 4
const corner = [...Array.from({ length: 5 }, (_, x) => ({ x, y: 0 })), ...Array.from({ length: 4 }, (_, y) => ({ x: 4, y: y + 1 }))];

describe('Taxi speed', () => {
  it('goes one tile per tile of budget on a straight line', () => {
    expect(advanceAlong(straight, 0, 3, 2)).toBeCloseTo(3);
    expect(advanceAlong(straight, 8, 5, 2)).toBe(9);
  });

  it('slows through a turn, the more the larger the aircraft', () => {
    // tiles 0–3 straight, tile 4 is the corner
    expect(advanceAlong(corner, 3, 2, 1)).toBeCloseTo(5);
    expect(advanceAlong(corner, 3, 2, 2)).toBeCloseTo(4.5);
    const small = advanceAlong(corner, 3, 2, TIMINGS.turnTileCost.small);
    const large = advanceAlong(corner, 3, 2, TIMINGS.turnTileCost.large);
    expect(small).toBeGreaterThan(large);
  });

  it('Large aircraft taxi 15% slower on straight Taxiway', () => {
    expect(TIMINGS.taxiSpeedFactor.large).toBe(0.85);
    expect(TIMINGS.taxiSpeedFactor.small).toBe(1);
  });
});
