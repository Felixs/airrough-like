import { describe, expect, it } from 'vitest';
import { openBuild } from '../build';
import { startRun } from '../run';
import { SAFETY } from '../simulation';
import { buildPier, lengthenRunway, placeStand } from './placer';
import { playRun } from './play';
import { idle, playerById } from './players';
import { summarize, wilson } from './report';
import { tuningValue, withTuning } from './tuning';

describe('Balance lab', () => {
  it('tuning overrides apply inside and are restored afterwards, also after an error', () => {
    const before = SAFETY.taxiIncidentPerAircraft;
    expect(withTuning({ 'SAFETY.taxiIncidentPerAircraft': 0.001 }, () => tuningValue('SAFETY.taxiIncidentPerAircraft'))).toBe(0.001);
    expect(SAFETY.taxiIncidentPerAircraft).toBe(before);
    expect(() => withTuning({ 'SAFETY.taxiIncidentPerAircraft': 0.001 }, () => { throw new Error('x'); })).toThrow();
    expect(SAFETY.taxiIncidentPerAircraft).toBe(before);
    expect(() => withTuning({ 'NOPE.x': 1 }, () => 0)).toThrow(/Unknown tuning path/);
  });

  it('the placer can add a Stand, a new pier and a longer Runway to the Starting Airport', () => {
    const s = openBuild({ ...startRun(1), money: 1_000_000 });
    expect(placeStand(s, 'medium', 'terminal', false)).not.toBeNull();
    const pier = buildPier(s, 'terminal');
    expect(pier?.pending.some((p) => p.label.startsWith('Terminal'))).toBe(true);
    expect(placeStand(pier!, 'large', 'terminal', false)).not.toBeNull();
    expect(lengthenRunway(s)?.pending.some((p) => p.label.includes('Lengthen'))).toBe(true);
  });

  it('an idle player loses the Run in the first two Weeks (balance gate)', () => {
    for (const seed of [1, 2, 3]) {
      const r = playRun(idle, seed);
      expect(r.won).toBe(false);
      expect(r.daysSurvived).toBeGreaterThanOrEqual(2);
      expect(r.lostOn).toBeLessThan(14);
    }
  }, 60_000);

  it('summarizes Runs into win rates with a confidence interval', () => {
    const [lo, hi] = wilson(5, 10);
    expect(lo).toBeLessThan(0.5);
    expect(hi).toBeGreaterThan(0.5);
    const rows = summarize([playRun(idle, 1)]);
    expect(rows[0]).toMatchObject({ player: 'idle', runs: 1, wins: 0, winRate: 0 });
    expect(playerById('planner-no-lit').id).toBe('planner-no-lit');
  }, 60_000);
});
