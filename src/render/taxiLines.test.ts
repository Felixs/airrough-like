import { describe, expect, it } from 'vitest';
import { startingAirport } from '../sim/layout';
import { centreTiles } from './taxiLines';

const STEPS = [[0, -1], [0, 1], [1, 0], [-1, 0]] as const;

describe('centre-line tiles', () => {
  const tiles = centreTiles(startingAirport());
  const arms = (k: string) => {
    const [x, y] = k.split(',').map(Number) as [number, number];
    return STEPS.filter(([dx, dy]) => tiles.has(`${x + dx},${y + dy}`)).length;
  };

  it('leave no one-tile stub past a corner or junction', () => {
    const stubs = [...tiles].filter((k) => {
      if (arms(k) !== 1) return false;
      const [x, y] = k.split(',').map(Number) as [number, number];
      const [dx, dy] = STEPS.find(([dx, dy]) => tiles.has(`${x + dx},${y + dy}`))!;
      return arms(`${x + dx},${y + dy}`) >= 3;
    });
    expect(stubs).toEqual([]);
  });

  it('turn the Starting Airport’s outer corners with a single curve (two arms)', () => {
    // where each Runway connector meets the parallel Taxiway (x 7, row 19; x 40, row 19) and where the apron lane ends
    expect(arms('7,19')).toBe(2);
    expect(arms('40,19')).toBe(2);
  });
});
