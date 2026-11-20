/**
 * Balance lab: tuning overrides. Every tuning table of the game is a plain exported object; an experiment changes
 * some of its numbers for the length of one Run and puts them back afterwards. Paths name a table and the keys inside
 * it, e.g. "BUILD_COSTS.stand.medium" or "SCHEDULE_RULES.bossQuotaShare".
 */
import { AIRCRAFT_TYPES } from '../aircraft';
import { BUILD_COSTS } from '../build';
import { PRICES } from '../plan';
import { SCORE, UPKEEP } from '../run';
import { SCHEDULE_RULES } from '../schedule';
import { ATC, SAFETY, TIMINGS } from '../simulation';

export const TABLES: Record<string, object> = { AIRCRAFT_TYPES, BUILD_COSTS, PRICES, UPKEEP, SCORE, SCHEDULE_RULES, ATC, SAFETY, TIMINGS };

/** Path → new value. A number value on a path that holds a number replaces it. */
export type Overrides = Readonly<Record<string, number>>;

function locate(path: string): { parent: Record<string, unknown>; key: string } {
  const [table, ...keys] = path.split('.');
  let parent = TABLES[table ?? ''] as Record<string, unknown> | undefined;
  if (!parent || !keys.length) throw new Error(`Unknown tuning path: ${path}`);
  for (const k of keys.slice(0, -1)) {
    const next = parent[k];
    if (!next || typeof next !== 'object') throw new Error(`Unknown tuning path: ${path}`);
    parent = next as Record<string, unknown>;
  }
  const key = keys[keys.length - 1]!;
  if (typeof parent[key] !== 'number') throw new Error(`Tuning path is not a number: ${path}`);
  return { parent, key };
}

/** The current value at a path. */
export function tuningValue(path: string): number {
  const { parent, key } = locate(path);
  return parent[key] as number;
}

/** Runs `fn` with the overrides in place, then restores every changed value (also when `fn` throws). */
export function withTuning<T>(overrides: Overrides, fn: () => T): T {
  const saved: Array<{ parent: Record<string, unknown>; key: string; value: unknown }> = [];
  try {
    for (const [path, value] of Object.entries(overrides)) {
      const { parent, key } = locate(path);
      saved.push({ parent, key, value: parent[key] });
      parent[key] = value;
    }
    return fn();
  } finally {
    for (const s of saved.reverse()) s.parent[s.key] = s.value;
  }
}
