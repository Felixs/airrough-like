import { createLayout, type Structure } from './layout';
import { describe, expect, it } from 'vitest';
import { buyUpgrade, runCalendar, suggestions, upgradeOffers } from './plan';
import { playDay, startRun, upkeep, type RunState } from './run';

const offer = (run: RunState, id: string) => upgradeOffers(run).find((o) => o.id === id)!;

describe('Upgrade offers', () => {
  it('price Tower Modules at 12k × current level and Surfaces at Lit 30k / ILS 80k', () => {
    const run = startRun(1);
    expect(offer(run, 'radar')).toMatchObject({ cost: 12_000, nextLevel: 2 });
    expect(offer({ ...run, towerModules: { ...run.towerModules, radar: 3 } }, 'radar').cost).toBe(36_000);
    expect(offer(run, 'surface')).toMatchObject({ cost: 30_000, label: 'Runway Surface: Lit' });
  });

  it('show the Upkeep each upgrade adds', () => {
    const run = startRun(1);
    expect(offer(run, 'radar').upkeepDelta).toBe(150);
    expect(offer(run, 'surface').upkeepDelta).toBe(300);
  });

  it('are disabled with a reason when Money is short, in Debt, or maxed out', () => {
    const run = startRun(1);
    expect(offer({ ...run, money: 5_000 }, 'radar')).toMatchObject({ available: false, reason: 'Not enough Money' });
    expect(offer({ ...run, money: -10, inDebt: true }, 'radar')).toMatchObject({ available: false, reason: 'In Debt: pay it off first' });
    expect(offer({ ...run, towerModules: { ...run.towerModules, radar: 5 } }, 'radar')).toMatchObject({ available: false, reason: 'Max level' });
  });
});

describe('Buying upgrades', () => {
  it('raises the level, pays the cost and counts it as spending', () => {
    const run = { ...startRun(1), money: 50_000 };
    const after = buyUpgrade(run, 'controllerTraining');
    expect(after.towerModules.controllerTraining).toBe(2);
    expect(after.money).toBe(38_000);
    expect(after.stats.spending).toBe(12_000);
    expect(upkeep(after)).toBe(upkeep(run) + 150);
  });

  it('upgrades the Runway Surface in the layout', () => {
    const after = buyUpgrade({ ...startRun(1), money: 40_000 }, 'surface');
    expect(after.layout.runways[0]!.surface).toBe('lit');
    expect(offer(after, 'surface')).toMatchObject({ cost: 80_000, label: 'Runway Surface: ILS' });
  });

  it('adds Fire & Rescue levels once the Station is unlocked and placed', () => {
    const base = { ...startRun(1), money: 40_000 };
    expect(offer(base, 'fireRescue').reason).toBe('🔒 Needs Unlockable: Fire & Rescue Station');
    const unlocked = { ...base, modifiers: { ...base.modifiers, unlocks: ['fireRescueStation' as const] } };
    expect(offer(unlocked, 'fireRescue').reason).toBe('Place a Fire & Rescue Station in Build Mode first');
    const placed = { ...unlocked, layout: createLayout(unlocked.layout.width, unlocked.layout.height, [
      ...unlocked.layout.structures, { kind: 'supportBuilding', role: 'fireRescueStation', x: 2, y: 14, w: 3, h: 2 } satisfies Structure,
    ]) };
    expect(buyUpgrade(placed, 'fireRescue').fireRescueLevel).toBe(1);
  });

  it('refuses when the offer is not available', () => {
    expect(() => buyUpgrade({ ...startRun(1), money: 100 }, 'radar')).toThrow();
  });
});

describe('Run Calendar', () => {
  it('opens the current Week with each Day’s Quota, marks the Boss Day and locks later Weeks', () => {
    const run = playDay(startRun(1)); // now Tuesday of Week 1
    const cal = runCalendar(run);
    expect(cal).toHaveLength(4);
    const [week1, week2] = cal;
    expect(week1!.locked).toBe(false);
    expect(week1!.days.map((d: { state: string }) => d.state)).toEqual(['done', 'today', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(week1!.days[0]!.result).toMatchObject({ quotaMet: true });
    expect(week1!.days[6]).toMatchObject({ boss: true });
    expect(week1!.days[5]).toMatchObject({ rush: true });
    expect(week2!.locked).toBe(true);
    expect(week1!.days[6]!.twist).toMatchObject({ boss: true, severity: 1 });
    expect(week2!.days[6]!.twist).toBe(null); // not shown before its Week
  });
});

describe('Suggestions', () => {
  it('point at what the Forecast and the airport are missing', () => {
    const texts = suggestions(startRun(1)).map((s: { text: string }) => s.text).join(' | ');
    expect(texts).toMatch(/Lit/);
    expect(texts).toMatch(/Radar 3/);
  });
});
