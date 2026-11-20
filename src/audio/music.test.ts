import { describe, expect, it } from 'vitest';
import { SONGS } from './music';

describe('Music', () => {
  it('has three loops of about a minute each', () => {
    expect(SONGS).toHaveLength(3);
    for (const s of SONGS) {
      const seconds = (s.bars * 4 * 60) / s.bpm;
      expect(seconds).toBeGreaterThan(45);
      expect(seconds).toBeLessThan(65);
      expect(new Set(SONGS.map((x) => x.id)).size).toBe(3);
    }
  });
});
