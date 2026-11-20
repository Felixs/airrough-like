import { describe, expect, it } from 'vitest';
import { startingAirport } from './layout';
import { airMiles, dayPlan, endDay, playDay, runScore, startLiveDay, startRun, upkeep, type RunState } from './run';
import { acknowledgeAlert, stepSimulation } from './simulation';

describe('Upkeep', () => {
  it('is paid for Runways, Surfaces, Stands, Holding Bays, Tower Modules and Fire & Rescue', () => {
    const run = startRun(1);
    // Medium Asphalt Runway 600 + 6 Medium Stands × 100 + 1 Medium Holding Bay 60 + 255 Taxiway tiles × 2;
    // Tower Modules at level 1 are free
    expect(upkeep(run)).toBe(1_770);
    const upgraded: RunState = { ...run, towerModules: { ...run.towerModules, radar: 3 }, fireRescueLevel: 2 };
    expect(upkeep(upgraded)).toBe(1_770 + 2 * 150 + 2 * 150);
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
    expect(next.money).toBe(run.money + 20_000 - 1_770);
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
    expect(next.money).toBe(-6_770);
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
  it('is Days × 1000 + Movements × 50 + fees; Air Miles are Score / 1000', () => {
    const run: RunState = { ...startRun(1), stats: { daysSurvived: 3, movements: 150, fees: 54_321, spending: 999, crashes: 0, diversions: 0, largeLandings: 0 } };
    expect(runScore(run)).toBe(3_000 + 7_500 + 54_321);
    expect(airMiles(run)).toBe(64);
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
  }, 20_000); // plays a whole Run twice

  it('is a pure, serializable object', () => {
    const run = playDay(startRun(3));
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
    expect(run.layout).toEqual(startingAirport());
  });

  it('carries aircraft left on the ground into the next Day', () => {
    const run = startRun(5);
    let sim = startLiveDay(run);
    while (sim.clock.minute < 24 * 60) sim = sim.pendingAlert ? acknowledgeAlert(sim) : stepSimulation(sim);
    const next = endDay(run, sim);
    const left = sim.flights.filter((f: { phase: string }) => ['onStand', 'inBay', 'taxiIn', 'taxiOut', 'holdShort'].includes(f.phase)).length;
    expect(next.overnight.length).toBe(left);
    expect(startLiveDay(next).flights.filter((f: { overnight?: boolean }) => f.overnight).length).toBe(left);
  });
});

describe('Day report', () => {
  it('sums up the Day: net money, landings by Purpose, Diversions by reason, busiest hour, Crashes and Incidents', () => {
    const run = startRun(5);
    const next = playDay(run);
    const r = next.history[0]!;
    expect(r.net).toBe(r.fees - r.upkeep - r.penalties);
    expect(r.landed.passenger + r.landed.cargo).toBeGreaterThan(0);
    const reasons = r.diversionsByReason;
    expect(reasons.curfew + reasons.dark + reasons.noRunway + reasons.manual).toBe(r.diversions);
    expect(r.busiestHour).toBeGreaterThanOrEqual(6);
    expect(r.highlights.filter((h) => h.kind === 'crash')).toHaveLength(r.crashes);
    for (const h of r.highlights) expect(h.callsign.length).toBeGreaterThan(0);
  });
});

describe('Seed and bug-report info', () => {
  it('describes where a Run is, so a bug can be replayed', async () => {
    const { runInfo, parseSeed } = await import('./run');
    const run = { ...startRun(123456), week: 2, weekday: 1, dayIndex: 8 };
    expect(runInfo(run, 'abc1234')).toBe('Seed 123456 · Week 2 · Tue · Day 9 · build abc1234');
    expect(runInfo({ ...run, endless: true }, 'abc1234')).toContain('Endless');
    expect(parseSeed(' 42 ')).toBe(42);
    expect(parseSeed('Seed 42')).toBe(42);
    expect(parseSeed('')).toBe(null);
    expect(parseSeed('abc')).toBe(null);
    expect(parseSeed('0')).toBe(null);
  });
});
