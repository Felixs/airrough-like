import { describe, expect, it } from 'vitest';
import {
  addPending, applyChange, checkChange, confirmBuild, lengthened, newBuilding, newRunway, newStand, openBuild, pendingTotal,
  taxiwayFromDrag, type BuildSession,
} from './build';
import type { Structure } from './layout';
import { UNLOCKABLES } from './meta';
import { startRun, upkeep, type RunState } from './run';

const rich = (): RunState => {
  const run = startRun(1);
  return { ...run, money: 1_000_000, modifiers: { ...run.modifiers, unlocks: UNLOCKABLES.map((u) => u.id) } };
};
const find = (session: BuildSession, pred: (s: Structure) => boolean) => session.layout.structures.find(pred)!;
const failing = (c: ReturnType<typeof checkChange>) => c.items.filter((i) => !i.ok).map((i) => i.label);

describe('New Runways', () => {
  it('are 4 tiles wide and 24 / 36 / 48 long, horizontal or vertical', () => {
    const s = openBuild(rich());
    expect(newRunway(s, { x: 43, y: 2 }, 'short', true)).toMatchObject({ kind: 'runway', x: 43, y: 2, w: 4, h: 24, length: 'short', surface: 'asphalt' });
    expect(newRunway(s, { x: 6, y: 30 }, 'long', false)).toMatchObject({ w: 48, h: 4 });
  });

  it('cost 30k / 80k / 160k, +25% per Runway already built', () => {
    const s = openBuild(rich());
    const c = checkChange(s, { kind: 'add', structure: newRunway(s, { x: 43, y: 2 }, 'short', true) });
    expect(c.ok).toBe(true);
    expect(c.cost).toBe(37_500);
    expect(c.upkeep).toBe(300);
  });

  it('can be lengthened for the price difference once there is room', () => {
    let s = openBuild(rich());
    const runway = s.layout.runways[0]!;
    const longer = { ...runway, w: 48, length: 'long' as const };
    expect(failing(checkChange(s, { kind: 'replace', from: runway, to: longer }))).toContain('Inside owned land');
    s = applyChange(s, { kind: 'buyPlot', plot: { px: 3, py: 1 } });
    const c = checkChange(s, { kind: 'replace', from: runway, to: longer });
    expect(c.ok).toBe(true);
    expect(c.cost).toBe(80_000);
  });

  it('can be lengthened on either side: the clicked end grows, the other stays put', () => {
    let s = openBuild(rich());
    const runway = s.layout.runways[0]!; // x 6–41
    expect(lengthened(runway, 'end')).toMatchObject({ x: 6, w: 48, length: 'long' });
    const west = lengthened(runway, 'start')!;
    expect(west).toMatchObject({ x: -6, w: 48, length: 'long' }); // still ends at x 41
    expect(failing(checkChange(s, { kind: 'replace', from: runway, to: west }))).toContain('Inside owned land');
    s = applyChange(s, { kind: 'buyPlot', plot: { px: -1, py: 1 } }); // land on the west side
    expect(checkChange(s, { kind: 'replace', from: runway, to: west }).ok).toBe(true);
    const vertical = newRunway(s, { x: 43, y: 2 }, 'short', true);
    expect(lengthened(vertical, 'start')).toMatchObject({ y: 2 + 24 - 36, h: 36 });
  });
});

describe('Runway connectors', () => {
  it('a Taxiway may end against a Runway side', () => {
    let s = openBuild(rich());
    s = addPending(s, newRunway(s, { x: 44, y: 2 }, 'short', true));
    expect(checkChange(s, { kind: 'add', structure: taxiwayFromDrag({ x: 42, y: 10 }, { x: 43, y: 10 }) }).ok).toBe(true);
  });
});

describe('Buildings', () => {
  it('Support Buildings cost 12k / 15k / 20k and enable their Emergency Action', () => {
    const s = openBuild(rich());
    const c = checkChange(s, { kind: 'add', structure: newBuilding(s, { x: 2, y: 14 }, 'rampAgentStation') });
    expect(c).toMatchObject({ ok: true, cost: 12_000, upkeep: 200 });
    expect(checkChange(s, { kind: 'add', structure: newBuilding(s, { x: 2, y: 14 }, 'airlineOffice') }).cost).toBe(20_000);
  });

  it('Terminal and Cargo Hub wings must be attached to their building', () => {
    const r = rich();
    const s = openBuild({ ...r, modifiers: { ...r.modifiers, unlocks: r.modifiers.unlocks.filter((u) => u !== 'secondTerminal') } });
    const wing: Structure = { kind: 'terminal', x: 22, y: 2, w: 3, h: 4 };
    expect(checkChange(s, { kind: 'add', structure: wing })).toMatchObject({ ok: true, cost: 18_000 });
    expect(failing(checkChange(s, { kind: 'add', structure: { ...wing, x: 2, y: 14 } }))).toContain('Attached to the Terminal');
  });
});

describe('Move', () => {
  it('is free and validated like a new placement', () => {
    const s = openBuild(rich());
    const tower = find(s, (x) => x.kind === 'atcTower');
    expect(checkChange(s, { kind: 'move', from: tower, to: { ...tower, x: 2, y: 10 } })).toMatchObject({ ok: true, cost: 0 });
    expect(failing(checkChange(s, { kind: 'move', from: tower, to: { ...tower, x: 8, y: 2 } }))).toContain('Clear of other structures');
    const moved = confirmBuild(applyChange(s, { kind: 'move', from: tower, to: { ...tower, x: 2, y: 10 } }));
    expect(moved.layout.structures.find((x) => x.kind === 'atcTower')).toMatchObject({ x: 2, y: 10 });
  });

  it('works for anything; a Terminal takes its Contact Stands along', () => {
    const s = openBuild(rich());
    const terminal = find(s, (x) => x.kind === 'terminal');
    // one tile left: the Stands still open onto the apron taxilane
    const moved = applyChange(s, { kind: 'move', from: terminal, to: { ...terminal, x: 6 } });
    expect(moved.layout.stands.filter((st) => st.serves === 'terminal').map((st) => st.x)).toEqual([7, 10, 13, 16]);
    const runway = s.layout.runways[0]!;
    expect(checkChange(s, { kind: 'move', from: runway, to: { ...runway, y: 30 } }).items.filter((i) => !i.ok).map((i) => i.label)).toEqual(['Inside owned land']);
    expect(failing(checkChange(s, { kind: 'move', from: terminal, to: { ...terminal, y: -10 } }))).toContain('Its Stands keep Taxiway access');
  });
});

describe('Demolish', () => {
  it('refunds 100% (for now) and removes the Upkeep', () => {
    const run = rich();
    const s = openBuild(run);
    const link = find(s, (x) => x.kind === 'taxiway' && x.x === 12 && x.y === 12);
    expect(checkChange(s, { kind: 'remove', structure: link })).toMatchObject({ ok: true, cost: -7_200, upkeep: -24 });
    const stand4 = find(s, (x) => x.kind === 'stand' && x.id === '4');
    const after = confirmBuild(applyChange(s, { kind: 'remove', structure: stand4 }));
    expect(after.money).toBe(run.money + 16_000);
    expect(upkeep(after)).toBe(upkeep(run) - 100);
  });

  it('refuses what is still needed or in use', () => {
    const s = openBuild(rich());
    expect(failing(checkChange(s, { kind: 'remove', structure: s.layout.runways[0]! }))).toContain('Not the last Runway');
    expect(failing(checkChange(s, { kind: 'remove', structure: find(s, (x) => x.kind === 'terminal') }))).toContain('No Contact Stands attached');
    expect(failing(checkChange(s, { kind: 'remove', structure: find(s, (x) => x.kind === 'atcTower') }))).toContain('Not the ATC Tower');
    const parked: RunState = { ...rich(), overnight: ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'A320', arrivalMinute: 0, overnight: true })) };
    const ps = openBuild(parked);
    expect(failing(checkChange(ps, { kind: 'remove', structure: find(ps, (x) => x.kind === 'stand' && x.id === '4') }))).toContain('Not in use by an aircraft');
  });
});

describe('Land Plots', () => {
  it('cost 24k × plots bought so far + 1 and must border owned land', () => {
    let s = openBuild(rich());
    expect(checkChange(s, { kind: 'buyPlot', plot: { px: 3, py: 0 } })).toMatchObject({ ok: true, cost: 24_000 });
    s = applyChange(s, { kind: 'buyPlot', plot: { px: 3, py: 0 } });
    expect(checkChange(s, { kind: 'buyPlot', plot: { px: 3, py: 1 } }).cost).toBe(48_000);
    expect(failing(checkChange(s, { kind: 'buyPlot', plot: { px: 4, py: 2 } }))).toContain('Borders owned land');
    expect(failing(checkChange(s, { kind: 'buyPlot', plot: { px: 0, py: 0 } }))).toContain('Not owned yet');
  });

  it('extend where the Player can build', () => {
    const s0 = openBuild(rich());
    const far = taxiwayFromDrag({ x: 43, y: 17 }, { x: 55, y: 17 });
    expect(() => addPending(s0, far)).toThrow();
    const s = applyChange(s0, { kind: 'buyPlot', plot: { px: 3, py: 1 } });
    const built = confirmBuild(addPending(s, newStand(s, { x: 20, y: 13 }, 'medium', 'remote', 'terminal')));
    expect(built.ownedPlots).toContainEqual({ px: 3, py: 1 });
    expect(pendingTotal(s).cost).toBe(24_000);
  });
});
