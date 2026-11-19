/**
 * Build Mode: a session of pending placements on top of the Run's layout, validated with a checks list,
 * paid for and applied on Confirm. The simulation routes on the new layout from the next Day.
 */
import { createLayout, WORLD, type AirportLayout, type HoldingBay, type SizeClass, type Stand, type Structure, type TileRect } from './layout';
import { UPKEEP, type RunState } from './run';
import type { Tile } from './taxi';

/** Prices *(first guess)*. */
export const BUILD_COSTS = {
  taxiwayPerTile: 600,
  taxiwayUpkeepPerTile: 2,
  /** Taxiways have one width that fits every aircraft. */
  taxiwayWidth: 3,
  stand: { small: 8_000, medium: 16_000, large: 36_000 },
  remoteStandFactor: 0.5,
  holdingBay: { small: 4_000, medium: 8_000, large: 16_000 },
  /** Each copy of the same Stand or Holding Bay already built (or pending) adds this share. */
  perCopy: 0.25,
} as const;

/** Stand and Holding Bay footprints (outline plus clearance), in tiles; they open onto the Taxiway below. */
export const FOOTPRINT = { small: { w: 2, h: 3 }, medium: { w: 3, h: 3 }, large: { w: 4, h: 3 } } as const;

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

function nextId(layout: AirportLayout, prefix: string, numeric: boolean): string {
  const used = new Set(layout.structures.flatMap((s) => ('id' in s ? [s.id] : [])));
  for (let n = 1; ; n++) {
    const id = numeric ? String(n) : `${prefix}${n}`;
    if (!used.has(id)) return id;
  }
}

/** A new Stand with its top-left tile at `at`. Contact Stands get the building's numbering (1, 2… / C1, C2…), Remote ones R1, R2… */
export function newStand(session: BuildSession, at: Tile, size: SizeClass, placement: Stand['placement'], serves: Stand['serves']): Stand {
  const id = placement === 'remote' ? nextId(session.layout, 'R', false) : serves === 'terminal' ? nextId(session.layout, '', true) : nextId(session.layout, 'C', false);
  return { kind: 'stand', id, x: at.x, y: at.y, ...FOOTPRINT[size], size, serves, placement };
}

export function newHoldingBay(session: BuildSession, at: Tile, size: SizeClass): HoldingBay {
  return { kind: 'holdingBay', id: nextId(session.layout, 'B', false), x: at.x, y: at.y, ...FOOTPRINT[size], size };
}

const SIZE_NAME: Record<SizeClass, string> = { small: 'Small', medium: 'Medium', large: 'Large' };

/** Price of a Stand or Holding Bay given how many copies of the same kind exist (built or pending). */
function spotPrice(layout: AirportLayout, s: Stand | HoldingBay): number {
  const copies = layout.structures.filter((o) =>
    o.kind === s.kind && o.size === s.size && (o.kind !== 'stand' || s.kind !== 'stand' || o.placement === s.placement)).length;
  const base = s.kind === 'stand'
    ? BUILD_COSTS.stand[s.size] * (s.placement === 'remote' ? BUILD_COSTS.remoteStandFactor : 1)
    : BUILD_COSTS.holdingBay[s.size];
  return Math.round(base * (1 + BUILD_COSTS.perCopy * copies));
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
  if (s.kind === 'stand' || s.kind === 'holdingBay') {
    cost = spotPrice(layout, s);
    upkeepCost = s.kind === 'stand' ? UPKEEP.stand[s.size] : UPKEEP.holdingBay[s.size];
    label = s.kind === 'stand'
      ? `${SIZE_NAME[s.size]} ${s.placement === 'remote' ? 'Remote' : 'Contact'} Stand ${s.id} (${s.serves === 'terminal' ? 'Terminal' : 'Cargo Hub'})`
      : `${SIZE_NAME[s.size]} Holding Bay ${s.id}`;
    items.push({ label: 'Clear of other structures', ok: !layout.structures.some((o) => overlaps(o, s)) });
    const entry = { x: s.x + Math.floor(s.w / 2), y: s.y + s.h };
    items.push({ label: 'Taxiway access', ok: isTaxiwayAt(layout, entry) });
    if (s.kind === 'stand' && s.placement === 'contact') {
      const building = s.serves === 'terminal' ? 'terminal' : 'cargoHub';
      const attached = layout.structures.some((b) => b.kind === building && b.y + b.h === s.y && s.x >= b.x && s.x + s.w <= b.x + b.w);
      items.push({ label: s.serves === 'terminal' ? 'Attached to the Terminal' : 'Attached to the Cargo Hub', ok: attached });
    }
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
