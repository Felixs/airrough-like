import { describe, expect, it } from 'vitest';
import { continueEndless, dayPlan, dayTwists, endDay, startLiveDay, startRun, type RunState } from './run';
import { simulationEffects, trafficEffects, twistsFor } from './twists';

const finish = (run: RunState, movements: number) => {
  const live = startLiveDay(run);
  return endDay(run, { ...live, clock: { ...live.clock, minute: 24 * 60 }, movements });
};

describe('Winning a Run', () => {
  it('surviving the Week 4 Boss Day wins the Run', () => {
    const run: RunState = { ...startRun(1), week: 4, weekday: 6, dayIndex: 27 };
    const won = finish(run, dayPlan(run).quota);
    expect(won.status).toBe('won');
    expect(won.stats.daysSurvived).toBe(1);
  });

  it('missing the Week 4 Boss Day Quota still loses', () => {
    const run: RunState = { ...startRun(1), week: 4, weekday: 6, dayIndex: 27 };
    expect(finish(run, 0).status).toBe('lost');
  });

  it('can continue into Endless Mode until a Quota is missed', () => {
    const run: RunState = { ...startRun(1), week: 4, weekday: 6, dayIndex: 27 };
    const endless = continueEndless(finish(run, dayPlan(run).quota));
    expect(endless).toMatchObject({ status: 'planning', endless: true, week: 5, weekday: 0 });
    const next = finish(endless, dayPlan(endless).quota);
    expect(next.status).toBe('planning');
    const sunday: RunState = { ...endless, weekday: 6 };
    expect(finish(sunday, dayPlan(sunday).quota).status).toBe('planning'); // no second win
    expect(finish(endless, 0).status).toBe('lost');
  });
});

describe('Endless Boss Days', () => {
  it('stack two Severity-4 Boss Twists from Week 5 and three from Week 7', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const w5 = twistsFor(seed, 5, 6);
      expect(w5).toHaveLength(2);
      expect(w5.every((t) => t.severity === 4 && t.boss)).toBe(true);
      expect(new Set(w5.map((t) => t.family)).size).toBe(2);
      expect(twistsFor(seed, 7, 6)).toHaveLength(3);
      expect(twistsFor(seed, 4, 6)).toHaveLength(1);
    }
  });

  it('combine their effects', () => {
    const surge = { family: 'surge' as const, severity: 4 };
    const storm = { family: 'weather' as const, severity: 4 };
    const outage = { family: 'infrastructure' as const, severity: 4 };
    expect(trafficEffects([surge, storm]).demandFactor).toBeCloseTo(1.5);
    const e = simulationEffects([storm, outage], 1, 1);
    expect(e.noLights).toBe(true);
    expect(e.riskMultiplier).toBeGreaterThan(1);
    expect(e.windows.length).toBeGreaterThan(0);
  });

  it('show on the Run', () => {
    const run: RunState = { ...startRun(2), week: 7, weekday: 6, endless: true };
    expect(dayTwists(run)).toHaveLength(3);
  });
});
