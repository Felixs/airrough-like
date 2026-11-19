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
