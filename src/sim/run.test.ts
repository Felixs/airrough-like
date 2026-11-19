import { describe, expect, it } from 'vitest';
import { startingAirport } from './layout';
import { airMiles, dayPlan, endDay, playDay, runScore, startLiveDay, startRun, upkeep, type RunState } from './run';
import { stepSimulation } from './simulation';

describe('Upkeep', () => {
  it('is paid for Runways, Surfaces, Stands, Holding Bays, Tower Modules and Fire & Rescue', () => {
    const run = startRun(1);
    // Medium Asphalt Runway 600 + 6 Medium Stands × 100 + 1 Medium Holding Bay 60; Tower Modules at level 1 are free
    expect(upkeep(run)).toBe(1_260);
    const upgraded: RunState = { ...run, towerModules: { ...run.towerModules, radar: 3 }, fireRescueLevel: 2 };
    expect(upkeep(upgraded)).toBe(1_260 + 2 * 150 + 2 * 150);
  });
});

describe('End of Day', () => {
  const finish = (run: RunState, movements: number, moneyAfterDay: number, crashes = 0) => {
    const live = startLiveDay(run);
    return endDay(run, { ...live, clock: { ...live.clock, minute: 24 * 60 }, movements, money: moneyAfterDay, fees: moneyAfterDay - run.money, crashes });
  };

  it('pays Upkeep and moves to the next Day when the Daily Quota is met', () => {
    const run = startRun(1);
    const next = finish(run, dayPlan(run).quota, run.money + 20_000);
    expect(next.status).toBe('planning');
    expect(next.money).toBe(run.money + 20_000 - 1_260);
    expect(next.weekday).toBe(1);
    expect(next.stats.daysSurvived).toBe(1);
  });

  it('loses the Run on one missed Daily Quota', () => {
    const run = startRun(1);
    const next = finish(run, dayPlan(run).quota - 1, run.money);
    expect(next.status).toBe('lost');
    expect(next.stats.daysSurvived).toBe(0);
  });

  it('allows Debt but blocks building while in Debt', () => {
    const run = startRun(1);
    const next = finish(run, dayPlan(run).quota, -5_000);
    expect(next.status).toBe('planning');
    expect(next.money).toBe(-6_260);
    expect(next.inDebt).toBe(true);
  });

  it('advances Monday to Sunday, then a new Week with Crash Fines reset', () => {
    let run: RunState = { ...startRun(1), weekday: 6, crashesThisWeek: 2 };
    run = finish(run, dayPlan(run).quota, run.money, 1);
    expect(run.week).toBe(2);
    expect(run.weekday).toBe(0);
    expect(run.crashesThisWeek).toBe(0);
    const tuesday = finish({ ...run }, dayPlan(run).quota, run.money, 1);
    expect(tuesday.crashesThisWeek).toBe(1);
  });
});

describe('Score', () => {
  it('is Days × 1000 + Movements × 50 + fees; Air Miles are Score / 100', () => {
    const run: RunState = { ...startRun(1), stats: { daysSurvived: 3, movements: 150, fees: 54_321, spending: 999, crashes: 0, diversions: 0 } };
    expect(runScore(run)).toBe(3_000 + 7_500 + 54_321);
    expect(airMiles(run)).toBe(648);
  });
});

describe('A whole Run', () => {
  it('without building, is lost by the first Boss Day or in Week 2, reproducibly', () => {
    const play = (seed: number) => {
      let run = startRun(seed);
      while (run.status !== 'lost' && run.week <= 4) run = playDay(run);
      return run;
    };
    const a = play(7);
    expect(a.status).toBe('lost');
    expect(a.stats.daysSurvived).toBeGreaterThanOrEqual(5);
    expect(a.stats.daysSurvived).toBeLessThan(14);
    expect(play(7)).toEqual(a);
  });

  it('is a pure, serializable object', () => {
    const run = playDay(startRun(3));
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
    expect(run.layout).toEqual(startingAirport());
  });

  it('carries aircraft left on the ground into the next Day', () => {
    const run = startRun(5);
    let sim = startLiveDay(run);
    while (sim.clock.minute < 24 * 60) sim = stepSimulation(sim);
    const next = endDay(run, sim);
    const left = sim.flights.filter((f: { phase: string }) => ['onStand', 'inBay', 'taxiIn', 'taxiOut', 'holdShort'].includes(f.phase)).length;
    expect(next.overnight.length).toBe(left);
    expect(startLiveDay(next).flights.filter((f: { overnight?: boolean }) => f.overnight).length).toBe(left);
  });
});
