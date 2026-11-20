/**
 * Local saves: the Run (saved at the start of each Plan Mode) and, separately, meta-progression.
 * Saves are versioned JSON; anything incompatible or broken is discarded, and storage errors never throw.
 */
import { createLayout } from './layout';
import type { RunState } from './run';
import { emptyMeta, type MetaState } from './meta';

export const SAVE_VERSION = 4; // 4: square Land Plots and the new starting airport
/** Meta-progression has its own version so Run format changes don't wipe Air Miles. */
export const META_VERSION = 2;
export const KEYS = { run: 'aab.run', meta: 'aab.meta', options: 'aab.options' } as const;

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
export function writeSave(store: KeyValueStore, key: string, data: unknown, version = SAVE_VERSION): boolean {
  try {
    store.set(key, JSON.stringify({ version, data }));
    return true;
  } catch {
    return false;
  }
}

/** Reads a versioned JSON value; discards (and removes) anything incompatible. */
export function readSave(store: KeyValueStore, key: string, version = SAVE_VERSION): { kind: 'none' } | { kind: 'discarded'; reason: string } | { kind: 'ok'; data: unknown } {
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
    if (parsed.version !== version) return discard(`The saved game is from another version (${String(parsed.version)}) and was discarded.`);
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

/** Meta-progression is saved separately and always. */
export function saveMeta(store: KeyValueStore, meta: MetaState): boolean {
  return writeSave(store, KEYS.meta, meta, META_VERSION);
}

export function loadMeta(store: KeyValueStore): MetaState {
  const r = readSave(store, KEYS.meta, META_VERSION);
  if (r.kind !== 'ok' || !r.data || typeof r.data !== 'object') return emptyMeta();
  return { ...emptyMeta(), ...(r.data as Partial<MetaState>) };
}

/** Player options, kept between sessions. */
export interface Options {
  /** Speed a Live Day starts at. */
  readonly defaultSpeed: 1 | 2 | 4 | 8;
  /** Drop to 1× while aircraft land or take off. */
  readonly autoSlow: boolean;
  /** Pause with an info pop-up on Incidents, Crashes and Diversions. */
  readonly eventPopups: boolean;
  /** Steady instead of flashing aircraft lights; unset follows the system's reduced-motion setting. */
  readonly reduceMotion?: boolean;
}

/** Whether to reduce motion: the Player's choice, else the system setting. */
export function reduceMotion(options: Options): boolean {
  if (options.reduceMotion !== undefined) return options.reduceMotion;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const DEFAULT_OPTIONS: Options = { defaultSpeed: 1, autoSlow: true, eventPopups: true };

export function loadOptions(store: KeyValueStore): Options {
  const r = readSave(store, KEYS.options, 1);
  return r.kind === 'ok' && r.data && typeof r.data === 'object' ? { ...DEFAULT_OPTIONS, ...(r.data as Partial<Options>) } : DEFAULT_OPTIONS;
}

export function saveOptions(store: KeyValueStore, options: Options): boolean {
  return writeSave(store, KEYS.options, options, 1);
}

/** Wipes Air Miles, Unlockables, Boosts and the saved Run. */
export function resetProgress(store: KeyValueStore): void {
  for (const key of [KEYS.meta, KEYS.run]) {
    try {
      store.remove(key);
    } catch {
      // ignore: storage is unavailable
    }
  }
}
