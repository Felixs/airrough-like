/**
 * Local saves: the Run (saved at the start of each Plan Mode) and, separately, meta-progression.
 * Saves are versioned JSON; anything incompatible or broken is discarded, and storage errors never throw.
 */
import { createLayout } from './layout';
import type { RunState } from './run';

export const SAVE_VERSION = 1;
export const KEYS = { run: 'aab.run', meta: 'aab.meta' } as const;

/** The part of localStorage the game uses (so tests can pass a fake). */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
}

/** Wraps window.localStorage (or nothing, when it isn't available). */
export function browserStore(): KeyValueStore {
  const ls = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };
  return {
    get: (k) => ls()?.getItem(k) ?? null,
    set: (k, v) => ls()?.setItem(k, v),
    remove: (k) => ls()?.removeItem(k),
  };
}

export type LoadResult<T> = { kind: 'none' } | { kind: 'discarded'; reason: string } | ({ kind: 'run' } & { run: T });

/** Writes a versioned JSON value; returns false when storage fails. */
export function writeSave(store: KeyValueStore, key: string, data: unknown): boolean {
  try {
    store.set(key, JSON.stringify({ version: SAVE_VERSION, data }));
    return true;
  } catch {
    return false;
  }
}

/** Reads a versioned JSON value; discards (and removes) anything incompatible. */
export function readSave(store: KeyValueStore, key: string): { kind: 'none' } | { kind: 'discarded'; reason: string } | { kind: 'ok'; data: unknown } {
  let text: string | null;
  try {
    text = store.get(key);
  } catch {
    return { kind: 'none' };
  }
  if (text === null) return { kind: 'none' };
  const discard = (reason: string) => {
    try {
      store.remove(key);
    } catch {
      // ignore: storage is unavailable
    }
    return { kind: 'discarded' as const, reason };
  };
  try {
    const parsed = JSON.parse(text) as { version?: unknown; data?: unknown; run?: unknown };
    if (parsed.version !== SAVE_VERSION) return discard(`The saved game is from another version (${String(parsed.version)}) and was discarded.`);
    return { kind: 'ok', data: parsed.data };
  } catch {
    return discard('The saved game was damaged and was discarded.');
  }
}

export function saveRun(store: KeyValueStore, run: RunState): boolean {
  return writeSave(store, KEYS.run, run);
}

export function loadRun(store: KeyValueStore): LoadResult<RunState> {
  const r = readSave(store, KEYS.run);
  if (r.kind !== 'ok') return r;
  const raw = r.data as RunState | undefined;
  if (!raw || !raw.layout || !Array.isArray(raw.layout.structures)) {
    clearRun(store);
    return { kind: 'discarded', reason: 'The saved game was damaged and was discarded.' };
  }
  // Rebuild the layout so its Runway/Stand lists point at the same structure objects again.
  const layout = createLayout(raw.layout.width, raw.layout.height, raw.layout.structures);
  return { kind: 'run', run: { ...raw, layout } };
}

export function clearRun(store: KeyValueStore): void {
  try {
    store.remove(KEYS.run);
  } catch {
    // ignore: storage is unavailable
  }
}
