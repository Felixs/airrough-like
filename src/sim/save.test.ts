import { describe, expect, it } from 'vitest';
import { buyUpgrade } from './plan';
import { playDay, startRun } from './run';
import { SAVE_VERSION, clearRun, loadRun, memoryStore, saveRun, type KeyValueStore } from './save';

describe('Saving a Run', () => {
  it('round-trips a Run, rebuilding the layout so its lists share the structures', () => {
    const store = memoryStore();
    const run = playDay(startRun(4));
    saveRun(store, run);
    const loaded = loadRun(store);
    expect(loaded.kind).toBe('run');
    if (loaded.kind !== 'run') return;
    expect(loaded.run).toEqual(run);
    expect(loaded.run.layout.structures).toContain(loaded.run.layout.runways[0]);
    // upgrades that find structures by identity still work after loading
    expect(buyUpgrade({ ...loaded.run, money: 100_000 }, 'surface').layout.runways[0]!.surface).toBe('lit');
  });

  it('reports no save when there is none, and clears', () => {
    const store = memoryStore();
    expect(loadRun(store).kind).toBe('none');
    saveRun(store, startRun(1));
    clearRun(store);
    expect(loadRun(store).kind).toBe('none');
  });

  it('discards an incompatible or broken save with a message', () => {
    const store = memoryStore();
    store.set('aab.run', JSON.stringify({ version: SAVE_VERSION + 1, data: {} }));
    const old = loadRun(store);
    expect(old.kind).toBe('discarded');
    expect(store.get('aab.run')).toBe(null);
    store.set('aab.run', '{not json');
    const broken = loadRun(store);
    expect(broken).toMatchObject({ kind: 'discarded' });
    if (broken.kind === 'discarded') expect(broken.reason.length).toBeGreaterThan(0);
  });

  it('does not break the game when storage fails', () => {
    const failing: KeyValueStore = {
      get: () => { throw new Error('denied'); },
      set: () => { throw new Error('quota'); },
      remove: () => { throw new Error('denied'); },
    };
    expect(saveRun(failing, startRun(1))).toBe(false);
    expect(loadRun(failing).kind).toBe('none');
    expect(() => clearRun(failing)).not.toThrow();
  });
});

describe('Saving meta-progression', () => {
  it('round-trips and falls back to a fresh start', async () => {
    const { emptyMeta } = await import('./meta');
    const { saveMeta, loadMeta } = await import('./save');
    const store = memoryStore();
    expect(loadMeta(store)).toEqual(emptyMeta());
    const meta = { ...emptyMeta(), airMiles: 1234, unlocks: ['remoteStands' as const] };
    saveMeta(store, meta);
    expect(loadMeta(store)).toEqual(meta);
  });

  it('refunds the Air Miles of the retired Lower Crash Fines Boost', async () => {
    const { emptyMeta } = await import('./meta');
    const { saveMeta, loadMeta } = await import('./save');
    const store = memoryStore();
    saveMeta(store, { ...emptyMeta(), airMiles: 100, boosts: { lowerCrashFines: 2, higherFees: 1 } as never });
    const meta = loadMeta(store);
    expect(meta.airMiles).toBe(100 + 500 + 1_000);
    expect(meta.boosts).toEqual({ higherFees: 1 });
  });
});

describe('Options', () => {
  it('round-trip with defaults, and Reset progress wipes meta and the Run but not options', async () => {
    const { DEFAULT_OPTIONS, loadOptions, saveOptions, resetProgress, saveMeta, loadMeta } = await import('./save');
    const { emptyMeta } = await import('./meta');
    const store = memoryStore();
    expect(loadOptions(store)).toEqual(DEFAULT_OPTIONS);
    saveOptions(store, { ...DEFAULT_OPTIONS, autoSlow: false });
    saveMeta(store, { ...emptyMeta(), airMiles: 50 });
    saveRun(store, startRun(1));
    resetProgress(store);
    expect(loadOptions(store).autoSlow).toBe(false);
    expect(loadMeta(store)).toEqual(emptyMeta());
    expect(loadRun(store).kind).toBe('none');
  });
});

describe('Reduce motion', () => {
  it('is the Player’s choice when set, else follows the system (off where there is none)', async () => {
    const { reduceMotion, DEFAULT_OPTIONS } = await import('./save');
    expect(reduceMotion({ ...DEFAULT_OPTIONS, reduceMotion: true })).toBe(true);
    expect(reduceMotion({ ...DEFAULT_OPTIONS, reduceMotion: false })).toBe(false);
    expect(reduceMotion(DEFAULT_OPTIONS)).toBe(false); // no matchMedia outside a browser
  });
});

describe('Retired Unlockables', () => {
  it('refund the Second Terminal (a whole Terminal is always buildable now)', async () => {
    const { emptyMeta } = await import('./meta');
    const { saveMeta, loadMeta } = await import('./save');
    const store = memoryStore();
    saveMeta(store, { ...emptyMeta(), airMiles: 10, unlocks: ['secondTerminal', 'remoteStands'] as never });
    const meta = loadMeta(store);
    expect(meta.airMiles).toBe(1_510);
    expect(meta.unlocks).toEqual(['remoteStands']);
  });
});
