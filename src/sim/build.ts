/**
 * Build Mode: a session of pending placements on top of the Run's layout, validated with a checks list,
 * paid for and applied on Confirm. The simulation routes on the new layout from the next Day.
 */
import { createLayout, WORLD, type AirportLayout, type Structure, type TileRect } from './layout';
import type { RunState } from './run';
import type { Tile } from './taxi';

/** Prices *(first guess)*. */
export const BUILD_COSTS = {
  taxiwayPerTile: 600,
  taxiwayUpkeepPerTile: 2,
  /** Taxiways have one width that fits every aircraft. */
  taxiwayWidth: 3,
} as const;

export interface PendingChange {
  readonly kind: 'add';
  readonly structure: Structure;
  readonly label: string;
  readonly cost: number;
  readonly upkeep: number;
}

export interface BuildSession {
  readonly base: RunState;
  readonly pending: readonly PendingChange[];
  /** The base layout with every pending change applied. */
  readonly layout: AirportLayout;
}

export interface Check {
  readonly label: string;
  readonly ok: boolean;
}

export interface PlacementCheck {
  readonly ok: boolean;
  readonly items: readonly Check[];
  readonly cost: number;
  readonly upkeep: number;
  readonly label: string;
}

export function openBuild(run: RunState): BuildSession {
  return { base: run, pending: [], layout: run.layout };
}

/** A straight 3-wide Taxiway along the dominant drag axis, centred on the dragged line. */
export function taxiwayFromDrag(from: Tile, to: Tile): Structure {
  const half = Math.floor(BUILD_COSTS.taxiwayWidth / 2);
  const vertical = Math.abs(to.y - from.y) >= Math.abs(to.x - from.x);
  return vertical
    ? { kind: 'taxiway', x: from.x - half, y: Math.min(from.y, to.y), w: BUILD_COSTS.taxiwayWidth, h: Math.abs(to.y - from.y) + 1 }
    : { kind: 'taxiway', x: Math.min(from.x, to.x), y: from.y - half, w: Math.abs(to.x - from.x) + 1, h: BUILD_COSTS.taxiwayWidth };
}

const overlaps = (a: TileRect, b: TileRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const tilesOf = (r: TileRect): Tile[] => {
  const out: Tile[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
  return out;
};

export function ownsTile(run: RunState, t: Tile): boolean {
  if (t.x < 0 || t.y < 0 || t.x >= WORLD.width || t.y >= WORLD.height) return false;
  const px = Math.floor(t.x / WORLD.plotW);
  const py = Math.floor(t.y / WORLD.plotH);
  return run.ownedPlots.some((p) => p.px === px && p.py === py);
}

function isTaxiwayAt(layout: AirportLayout, t: Tile): boolean {
  return layout.structures.some((s) => s.kind === 'taxiway' && t.x >= s.x && t.x < s.x + s.w && t.y >= s.y && t.y < s.y + s.h);
}

/** Both end caps of a Taxiway strip touch (or overlap) an existing Taxiway. */
function connectsAtBothEnds(layout: AirportLayout, t: TileRect): boolean {
  const vertical = t.h > t.w;
  const ends: Array<[Tile[], Tile[]]> = vertical
    ? [
        [tilesOf({ x: t.x, y: t.y - 1, w: t.w, h: 1 }), tilesOf({ x: t.x, y: t.y, w: t.w, h: 1 })],
        [tilesOf({ x: t.x, y: t.y + t.h, w: t.w, h: 1 }), tilesOf({ x: t.x, y: t.y + t.h - 1, w: t.w, h: 1 })],
      ]
    : [
        [tilesOf({ x: t.x - 1, y: t.y, w: 1, h: t.h }), tilesOf({ x: t.x, y: t.y, w: 1, h: t.h })],
        [tilesOf({ x: t.x + t.w, y: t.y, w: 1, h: t.h }), tilesOf({ x: t.x + t.w - 1, y: t.y, w: 1, h: t.h })],
      ];
  return ends.every(([outside, inside]) => [...outside, ...inside].some((tile) => isTaxiwayAt(layout, tile)));
}

export function placementChecks(session: BuildSession, s: Structure): PlacementCheck {
  const run = session.base;
  const layout = session.layout;
  const items: Check[] = [];
  let cost = 0;
  let upkeepCost = 0;
  let label: string = s.kind;
  if (s.kind === 'taxiway') {
    const tiles = s.w * s.h;
    cost = tiles * BUILD_COSTS.taxiwayPerTile;
    upkeepCost = tiles * BUILD_COSTS.taxiwayUpkeepPerTile;
    label = `Taxiway, ${tiles} tiles`;
    items.push({ label: 'Connects at both ends', ok: connectsAtBothEnds(layout, s) });
    items.push({ label: 'Crosses no Runway', ok: !layout.runways.some((r) => overlaps(r, s)) });
    items.push({
      label: 'Clear of buildings and Stands',
      ok: !layout.structures.some((o) => o.kind !== 'taxiway' && o.kind !== 'runway' && overlaps(o, s)),
    });
  }
  items.push({ label: 'Inside owned land', ok: tilesOf(s).every((t) => ownsTile(run, t)) });
  if (run.inDebt) items.push({ label: 'Not in Debt', ok: false });
  items.push({ label: 'Affordable', ok: run.money >= pendingTotal(session).cost + cost });
  return { ok: items.every((c) => c.ok), items, cost, upkeep: upkeepCost, label };
}

export function addPending(session: BuildSession, s: Structure): BuildSession {
  const check = placementChecks(session, s);
  if (!check.ok) throw new Error(check.items.filter((c) => !c.ok).map((c) => c.label).join(', '));
  const pending = [...session.pending, { kind: 'add' as const, structure: s, label: check.label, cost: check.cost, upkeep: check.upkeep }];
  return withPending(session, pending);
}

export function undoPending(session: BuildSession): BuildSession {
  return withPending(session, session.pending.slice(0, -1));
}

function withPending(session: BuildSession, pending: readonly PendingChange[]): BuildSession {
  const base = session.base.layout;
  const structures = [...base.structures, ...pending.map((p) => p.structure)];
  return { ...session, pending, layout: createLayout(base.width, base.height, structures) };
}

export function pendingTotal(session: BuildSession): { cost: number; upkeep: number } {
  return session.pending.reduce((t, p) => ({ cost: t.cost + p.cost, upkeep: t.upkeep + p.upkeep }), { cost: 0, upkeep: 0 });
}

/** Pays for and applies every pending change. */
export function confirmBuild(session: BuildSession): RunState {
  const run = session.base;
  const { cost } = pendingTotal(session);
  if (run.inDebt) throw new Error('In Debt: pay it off first');
  if (run.money < cost) throw new Error('Not enough Money');
  // Upkeep follows from the layout, so it changes with it.
  return { ...run, layout: session.layout, money: run.money - cost, stats: { ...run.stats, spending: run.stats.spending + cost } };
}
