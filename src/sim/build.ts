/**
 * Build Mode: a session of pending placements on top of the Run's layout, validated with a checks list,
 * paid for and applied on Confirm. The simulation routes on the new layout from the next Day.
 */
import { createLayout, WORLD, type AirportLayout, type HoldingBay, type Runway, type RunwayLength, type SizeClass, type Stand, type Structure, type SupportBuilding, type SupportRole, type TileRect } from './layout';
import { UPKEEP, type LandPlot, type RunState } from './run';
import { AIRCRAFT_TYPES, sizeRank } from './aircraft';
import { unlockableName, type UnlockableId } from './meta';
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
  /** Each copy of the same Stand, Holding Bay or Runway already built (or pending) adds this share. */
  perCopy: 0.25,
  runway: { short: 30_000, medium: 80_000, long: 160_000 },
  runwayTiles: { short: 24, medium: 36, long: 48 },
  runwayWidth: 4,
  supportBuilding: { rampAgentStation: 12_000, adminOffice: 15_000, airlineOffice: 20_000, fireRescueStation: 25_000, fuelFarm: 18_000, deIcingPad: 22_000 },
  /** A Short Grass Runway (Grass strip Unlockable). */
  grassStrip: 12_000,
  supportBuildingSize: { w: 3, h: 2 },
  /** Terminal and Cargo Hub wings, per tile. */
  wingPerTile: 1_500,
  /** Demolish refunds this share of the base price (100% while testing how layouts play). */
  refundShare: 1,
  /** Land Plot n (counting from the first bought) costs this × n. */
  plotBase: 24_000,
  startingPlots: 6,
} as const;

/** Stand and Holding Bay footprints (outline plus clearance), in tiles; they open onto the Taxiway below. */
export const FOOTPRINT = { small: { w: 2, h: 3 }, medium: { w: 3, h: 3 }, large: { w: 4, h: 3 } } as const;

/** A change in Build Mode. Structures are matched by identity within the session's layout. */
export type Change =
  | { readonly kind: 'add'; readonly structure: Structure }
  | { readonly kind: 'remove'; readonly structure: Structure }
  | { readonly kind: 'move'; readonly from: Structure; readonly to: Structure }
  | { readonly kind: 'replace'; readonly from: Structure; readonly to: Structure }
  | { readonly kind: 'buyPlot'; readonly plot: LandPlot };

export type PendingChange = Change & {
  readonly label: string;
  /** Money paid (negative for refunds). */
  readonly cost: number;
  /** Change in daily Upkeep. */
  readonly upkeep: number;
};

export interface BuildSession {
  readonly base: RunState;
  readonly pending: readonly PendingChange[];
  /** The base layout with every pending change applied. */
  readonly layout: AirportLayout;
  readonly ownedPlots: readonly LandPlot[];
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
  return { base: run, pending: [], layout: run.layout, ownedPlots: run.ownedPlots };
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

export function ownsTile(owner: { readonly ownedPlots: readonly LandPlot[] }, t: Tile): boolean {
  if (t.x < WORLD.x0 || t.y < WORLD.y0 || t.x >= WORLD.x0 + WORLD.width || t.y >= WORLD.y0 + WORLD.height) return false;
  const px = Math.floor(t.x / WORLD.plotW);
  const py = Math.floor(t.y / WORLD.plotH);
  return owner.ownedPlots.some((p) => p.px === px && p.py === py);
}

function isTaxiwayAt(layout: AirportLayout, t: Tile): boolean {
  return layout.structures.some((s) => s.kind === 'taxiway' && t.x >= s.x && t.x < s.x + s.w && t.y >= s.y && t.y < s.y + s.h);
}

/** At least one end cap of a Taxiway strip touches (or overlaps) a Taxiway, or meets a Runway's side; dead ends are fine. */
function connectsAtAnEnd(layout: AirportLayout, t: TileRect): boolean {
  const width = BUILD_COSTS.taxiwayWidth;
  // The strip runs along whichever side is not the Taxiway width (both are tried for a square or odd strip).
  const orientations = t.w === width && t.h !== width ? [true] : t.h === width && t.w !== width ? [false] : [true, false];
  const runwayAt = (p: Tile) => layout.runways.some((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
  return orientations.some((vertical) => {
    const ends: Array<[Tile[], Tile[]]> = vertical
      ? [
          [tilesOf({ x: t.x, y: t.y - 1, w: t.w, h: 1 }), tilesOf({ x: t.x, y: t.y, w: t.w, h: 1 })],
          [tilesOf({ x: t.x, y: t.y + t.h, w: t.w, h: 1 }), tilesOf({ x: t.x, y: t.y + t.h - 1, w: t.w, h: 1 })],
        ]
      : [
          [tilesOf({ x: t.x - 1, y: t.y, w: 1, h: t.h }), tilesOf({ x: t.x, y: t.y, w: 1, h: t.h })],
          [tilesOf({ x: t.x + t.w, y: t.y, w: 1, h: t.h }), tilesOf({ x: t.x + t.w - 1, y: t.y, w: 1, h: t.h })],
        ];
    const sides = vertical
      ? [tilesOf({ x: t.x - 1, y: t.y, w: 1, h: t.h }), tilesOf({ x: t.x + t.w, y: t.y, w: 1, h: t.h })]
      : [tilesOf({ x: t.x, y: t.y - 1, w: t.w, h: 1 }), tilesOf({ x: t.x, y: t.y + t.h, w: t.w, h: 1 })];
    // an end cap, or a long side, that meets the existing network
    return ends.some(([outside, inside]) => [...outside, ...inside].some((tile) => isTaxiwayAt(layout, tile)) || outside.every(runwayAt)) ||
      sides.some((side) => side.some((tile) => isTaxiwayAt(layout, tile)));
  });
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


export function newRunway(_session: BuildSession, at: Tile, length: RunwayLength, vertical: boolean, grass = false): Runway {
  const size = grass ? 'short' : length;
  const long = BUILD_COSTS.runwayTiles[size];
  const wide = BUILD_COSTS.runwayWidth;
  return { kind: 'runway', x: at.x, y: at.y, w: vertical ? wide : long, h: vertical ? long : wide, length: size, surface: grass ? 'grass' : 'asphalt' };
}

/** The Unlockable a new structure needs, if any. */
export function unlockNeeded(s: Structure): UnlockableId | null {
  if (s.kind === 'stand' && s.placement === 'remote') return 'remoteStands';
  if (s.kind === 'terminal') return 'terminalWing';
  if (s.kind === 'cargoHub') return 'cargoWing';
  if (s.kind === 'supportBuilding') return s.role;
  if (s.kind === 'runway' && s.surface === 'grass') return 'grassStrip';
  return null;
}

export function newBuilding(_session: BuildSession, at: Tile, role: SupportRole): SupportBuilding {
  return { kind: 'supportBuilding', role, x: at.x, y: at.y, ...BUILD_COSTS.supportBuildingSize };
}

export const ROLE_NAME: Record<SupportRole, string> = {
  rampAgentStation: 'Ramp Agent Station', adminOffice: 'Admin Office', airlineOffice: 'Airline Office',
  fireRescueStation: 'Fire & Rescue Station', fuelFarm: 'Fuel farm', deIcingPad: 'De-icing pad',
};
const LENGTH_NAME: Record<RunwayLength, string> = { short: 'Short', medium: 'Medium', long: 'Long' };

/** Base price (no copy surcharge) used for refunds. */
function basePrice(s: Structure): number {
  switch (s.kind) {
    case 'taxiway': return s.w * s.h * BUILD_COSTS.taxiwayPerTile;
    case 'stand': return BUILD_COSTS.stand[s.size] * (s.placement === 'remote' ? BUILD_COSTS.remoteStandFactor : 1);
    case 'holdingBay': return BUILD_COSTS.holdingBay[s.size];
    case 'runway': return s.surface === 'grass' ? BUILD_COSTS.grassStrip : BUILD_COSTS.runway[s.length];
    case 'supportBuilding': return BUILD_COSTS.supportBuilding[s.role];
    case 'terminal':
    case 'cargoHub': return s.w * s.h * BUILD_COSTS.wingPerTile;
    default: return 0;
  }
}

function structureUpkeep(s: Structure): number {
  switch (s.kind) {
    case 'taxiway': return s.w * s.h * UPKEEP.taxiwayPerTile;
    case 'stand': return UPKEEP.stand[s.size];
    case 'holdingBay': return UPKEEP.holdingBay[s.size];
    case 'runway': return UPKEEP.runway[s.length] + UPKEEP.surface[s.surface];
    case 'supportBuilding': return UPKEEP.supportBuilding;
    default: return 0;
  }
}

function describe(s: Structure): string {
  switch (s.kind) {
    case 'taxiway': return `Taxiway, ${s.w * s.h} tiles`;
    case 'stand': return `${SIZE_NAME[s.size]} ${s.placement === 'remote' ? 'Remote' : 'Contact'} Stand ${s.id} (${s.serves === 'terminal' ? 'Terminal' : 'Cargo Hub'})`;
    case 'holdingBay': return `${SIZE_NAME[s.size]} Holding Bay ${s.id}`;
    case 'runway': return `${LENGTH_NAME[s.length]} Runway (${s.w >= s.h ? '09-27' : '18-36'})`;
    case 'supportBuilding': return ROLE_NAME[s.role];
    case 'terminal': return `Terminal wing, ${s.w * s.h} tiles`;
    case 'cargoHub': return `Cargo Hub wing, ${s.w * s.h} tiles`;
    case 'atcTower': return 'ATC Tower';
  }
}

/** Price of a new structure, with the copy surcharge for Stands, Holding Bays and Runways. */
function priceOf(layout: AirportLayout, s: Structure): number {
  if (s.kind === 'stand' || s.kind === 'holdingBay') return spotPrice(layout, s);
  if (s.kind === 'runway') return Math.round(basePrice(s) * (1 + BUILD_COSTS.perCopy * layout.runways.length));
  return basePrice(s);
}

/** Structures are matched by value, so they survive merges and rebuilt layouts. */
export const sameStructure = (a: Structure, b: Structure) => JSON.stringify(a) === JSON.stringify(b);
const without = (layout: AirportLayout, ...gone: Structure[]) =>
  createLayout(layout.width, layout.height, layout.structures.filter((o) => !gone.some((g) => sameStructure(o, g))));

/** Contact Stands attached to a Terminal or Cargo Hub building (they move with it). */
export function attachedStands(layout: AirportLayout, b: Structure): Stand[] {
  if (b.kind !== 'terminal' && b.kind !== 'cargoHub') return [];
  return layout.stands.filter((st) => st.placement === 'contact' && st.serves === b.kind && b.y + b.h === st.y && st.x >= b.x && st.x + st.w <= b.x + b.w);
}

/** Collinear, touching Taxiways (or same-height building wings) become one structure. */
function mergeInto(structures: Structure[], s: Structure): Structure[] {
  if (s.kind !== 'taxiway' && s.kind !== 'terminal' && s.kind !== 'cargoHub') return [...structures, s];
  let merged: Structure = s;
  let rest = structures;
  for (;;) {
    const m = merged;
    const partner = rest.find((o) => o.kind === m.kind && (
      (o.y === m.y && o.h === m.h && o.x <= m.x + m.w && m.x <= o.x + o.w) ||
      (m.kind === 'taxiway' && o.x === m.x && o.w === m.w && o.y <= m.y + m.h && m.y <= o.y + o.h)));
    if (!partner) break;
    const x = Math.min(m.x, partner.x);
    const y = Math.min(m.y, partner.y);
    merged = { ...m, x, y, w: Math.max(m.x + m.w, partner.x + partner.w) - x, h: Math.max(m.y + m.h, partner.y + partner.h) - y } as Structure;
    rest = rest.filter((o) => o !== partner);
  }
  return [...rest, merged];
}

/** Where a structure may stand on `layout` (shared by new placements, Moves and lengthening). */
function siteChecks(session: BuildSession, layout: AirportLayout, s: Structure, isNew = true): Check[] {
  const items: Check[] = [];
  const clearOfAll = !layout.structures.some((o) => overlaps(o, s));
  switch (s.kind) {
    case 'taxiway':
      items.push({ label: 'Connects to a Taxiway or Runway', ok: connectsAtAnEnd(layout, s) });
      items.push({ label: 'Crosses no Runway', ok: !layout.runways.some((r) => overlaps(r, s)) });
      items.push({ label: 'Clear of buildings and Stands', ok: !layout.structures.some((o) => o.kind !== 'taxiway' && o.kind !== 'runway' && overlaps(o, s)) });
      break;
    case 'stand':
    case 'holdingBay': {
      items.push({ label: 'Clear of other structures', ok: clearOfAll });
      items.push({ label: 'Taxiway access', ok: isTaxiwayAt(layout, { x: s.x + Math.floor(s.w / 2), y: s.y + s.h }) });
      if (s.kind === 'stand' && s.placement === 'contact') {
        const building = s.serves === 'terminal' ? 'terminal' : 'cargoHub';
        const attached = layout.structures.some((b) => b.kind === building && b.y + b.h === s.y && s.x >= b.x && s.x + s.w <= b.x + b.w);
        items.push({ label: s.serves === 'terminal' ? 'Attached to the Terminal' : 'Attached to the Cargo Hub', ok: attached });
      }
      break;
    }
    case 'terminal':
    case 'cargoHub': {
      items.push({ label: 'Clear of other structures', ok: clearOfAll });
      const touches = (b: TileRect) =>
        (b.x + b.w === s.x || s.x + s.w === b.x) && s.y < b.y + b.h && b.y < s.y + s.h ||
        (b.y + b.h === s.y || s.y + s.h === b.y) && s.x < b.x + b.w && b.x < s.x + s.w;
      const freeStanding = s.kind === 'terminal' && session.base.modifiers.unlocks.includes('secondTerminal');
      if (isNew && !freeStanding) items.push({ label: s.kind === 'terminal' ? 'Attached to the Terminal' : 'Attached to the Cargo Hub', ok: layout.structures.some((b) => b.kind === s.kind && touches(b)) });
      break;
    }
    default:
      items.push({ label: 'Clear of other structures', ok: clearOfAll });
  }
  items.push({ label: 'Inside owned land', ok: tilesOf(s).every((t) => ownsTile(session, t)) });
  return items;
}

/** Overnight aircraft still fit on the remaining Stands. */
function overnightFits(run: RunState, layout: AirportLayout): boolean {
  const free = new Set(layout.stands.map((s) => s.id));
  const aircraft = [...run.overnight].sort((a, b) => sizeRank(AIRCRAFT_TYPES[b.type].size) - sizeRank(AIRCRAFT_TYPES[a.type].size));
  for (const f of aircraft) {
    const t = AIRCRAFT_TYPES[f.type];
    const serves = t.purpose === 'passenger' ? 'terminal' : 'cargoHub';
    const stand = layout.stands
      .filter((s) => free.has(s.id) && s.serves === serves && sizeRank(s.size) >= sizeRank(t.size))
      .sort((a, b) => sizeRank(a.size) - sizeRank(b.size))[0];
    if (!stand) return false;
    free.delete(stand.id);
  }
  return true;
}

const adjacentPlot = (plots: readonly LandPlot[], p: LandPlot) =>
  plots.some((o) => Math.abs(o.px - p.px) + Math.abs(o.py - p.py) === 1);

/** Checks a change against the session (with everything already pending), with its cost and Upkeep. */
export function checkChange(session: BuildSession, change: Change): PlacementCheck {
  const run = session.base;
  const layout = session.layout;
  let items: Check[] = [];
  let cost = 0;
  let upkeepCost = 0;
  let label = '';
  switch (change.kind) {
    case 'add': {
      const s = change.structure;
      items = siteChecks(session, layout, s);
      const needs = unlockNeeded(s);
      if (needs && !run.modifiers.unlocks.includes(needs)) items.unshift({ label: `🔒 Needs Unlockable: ${unlockableName(needs)}`, ok: false });
      cost = Math.round(priceOf(layout, s) * (s.kind === 'taxiway' ? run.modifiers.taxiwayCostFactor : 1));
      upkeepCost = structureUpkeep(s);
      label = describe(s);
      break;
    }
    case 'move': {
      label = `Move ${describe(change.from).replace(/ wing, \d+ tiles/, '')}`;
      const stands = attachedStands(layout, change.from);
      const dx = change.to.x - change.from.x;
      const dy = change.to.y - change.from.y;
      const rest = without(layout, change.from, ...stands);
      items = siteChecks(session, rest, change.to, false);
      const movedStands = stands.map((st) => ({ ...st, x: st.x + dx, y: st.y + dy }));
      const withBuilding = createLayout(rest.width, rest.height, [...rest.structures, change.to, ...movedStands]);
      if (movedStands.length) {
        items.push({ label: 'Its Stands stay clear', ok: movedStands.every((st) => !rest.structures.some((o) => overlaps(o, st))) });
        items.push({ label: 'Its Stands keep Taxiway access', ok: movedStands.every((st) => isTaxiwayAt(withBuilding, { x: st.x + Math.floor(st.w / 2), y: st.y + st.h })) });
      }
      break;
    }
    case 'replace': {
      const { from, to } = change;
      label = from.kind === 'runway' && to.kind === 'runway' ? `Lengthen Runway to ${LENGTH_NAME[to.length]}` : `Change ${describe(from)}`;
      items = siteChecks(session, without(layout, from), to);
      cost = Math.max(0, basePrice(to) - basePrice(from));
      upkeepCost = structureUpkeep(to) - structureUpkeep(from);
      break;
    }
    case 'remove': {
      const s = change.structure;
      const after = without(layout, s);
      label = `Demolish ${describe(s)}`;
      cost = -Math.round(basePrice(s) * BUILD_COSTS.refundShare);
      upkeepCost = -structureUpkeep(s);
      if (s.kind === 'runway') items.push({ label: 'Not the last Runway', ok: after.runways.length > 0 });
      if (s.kind === 'atcTower') items.push({ label: 'Not the ATC Tower', ok: false });
      if (s.kind === 'terminal' || s.kind === 'cargoHub') {
        const left = after.structures.filter((b) => b.kind === s.kind);
        const orphan = layout.stands.some((st) => st.placement === 'contact' && st.serves === s.kind &&
          !left.some((b) => b.y + b.h === st.y && st.x >= b.x && st.x + st.w <= b.x + b.w));
        items.push({ label: 'No Contact Stands attached', ok: !orphan });
      }
      if (s.kind === 'stand') items.push({ label: 'Not in use by an aircraft', ok: overnightFits(run, after) });
      break;
    }
    case 'buyPlot': {
      const { plot } = change;
      label = `Land Plot ${plot.px + 1}-${plot.py + 1}`;
      const bought = session.ownedPlots.length - session.base.startingPlots;
      cost = Math.round(BUILD_COSTS.plotBase * (bought + 1) * run.modifiers.landCostFactor);
      const inWorld = plot.px * WORLD.plotW >= WORLD.x0 && plot.py * WORLD.plotH >= WORLD.y0 &&
        (plot.px + 1) * WORLD.plotW <= WORLD.x0 + WORLD.width && (plot.py + 1) * WORLD.plotH <= WORLD.y0 + WORLD.height;
      items.push({ label: 'Not owned yet', ok: !session.ownedPlots.some((o) => o.px === plot.px && o.py === plot.py) });
      items.push({ label: 'Borders owned land', ok: inWorld && adjacentPlot(session.ownedPlots, plot) });
      break;
    }
  }
  if (run.inDebt && cost > 0) items.push({ label: 'Not in Debt', ok: false });
  items.push({ label: 'Affordable', ok: run.money >= pendingTotal(session).cost + cost });
  return { ok: items.every((c) => c.ok), items, cost, upkeep: upkeepCost, label };
}

/** Same as checkChange for a new structure (kept for the placement ghost). */
export function placementChecks(session: BuildSession, s: Structure): PlacementCheck {
  return checkChange(session, { kind: 'add', structure: s });
}

/** Adds a valid change to the pending list; throws with the failed checks otherwise. */
export function applyChange(session: BuildSession, change: Change): BuildSession {
  const check = checkChange(session, change);
  if (!check.ok) throw new Error(check.items.filter((c) => !c.ok).map((c) => c.label).join(', '));
  return withPending(session, [...session.pending, { ...change, label: check.label, cost: check.cost, upkeep: check.upkeep }]);
}

export function addPending(session: BuildSession, s: Structure): BuildSession {
  return applyChange(session, { kind: 'add', structure: s });
}

export function undoPending(session: BuildSession): BuildSession {
  return withPending(session, session.pending.slice(0, -1));
}

function withPending(session: BuildSession, pending: readonly PendingChange[]): BuildSession {
  const base = session.base.layout;
  let structures: Structure[] = [...base.structures];
  let plots: LandPlot[] = [...session.base.ownedPlots];
  for (const p of pending) {
    switch (p.kind) {
      case 'add': structures = mergeInto(structures, p.structure); break;
      case 'remove': structures = structures.filter((s) => !sameStructure(s, p.structure)); break;
      case 'move': {
        const layout = createLayout(base.width, base.height, structures);
        const stands = attachedStands(layout, p.from);
        const dx = p.to.x - p.from.x;
        const dy = p.to.y - p.from.y;
        structures = structures.map((s) =>
          sameStructure(s, p.from) ? p.to : stands.some((st) => sameStructure(st, s)) ? ({ ...s, x: s.x + dx, y: s.y + dy } as Structure) : s);
        break;
      }
      case 'replace': structures = structures.map((s) => (sameStructure(s, p.from) ? p.to : s)); break;
      case 'buyPlot': plots = [...plots, p.plot]; break;
    }
  }
  return { ...session, pending, layout: createLayout(base.width, base.height, structures), ownedPlots: plots };
}

export function pendingTotal(session: BuildSession): { cost: number; upkeep: number } {
  return session.pending.reduce((t, p) => ({ cost: t.cost + p.cost, upkeep: t.upkeep + p.upkeep }), { cost: 0, upkeep: 0 });
}

/** Pays for and applies every pending change. */
export function confirmBuild(session: BuildSession): RunState {
  const run = session.base;
  const { cost } = pendingTotal(session);
  if (run.inDebt && cost > 0) throw new Error('In Debt: pay it off first');
  if (run.money < cost) throw new Error('Not enough Money');
  // Upkeep follows from the layout, so it changes with it.
  return {
    ...run, layout: session.layout, ownedPlots: session.ownedPlots, money: run.money - cost,
    stats: { ...run.stats, spending: run.stats.spending + Math.max(0, cost) },
  };
}

/** The structure drawn on top at a tile (buildings over Stands over Runways over Taxiways). */
export function structureAt(layout: AirportLayout, t: Tile): Structure | undefined {
  const rank: Record<Structure['kind'], number> = {
    atcTower: 0, supportBuilding: 0, terminal: 1, cargoHub: 1, stand: 2, holdingBay: 2, runway: 3, taxiway: 4,
  };
  return layout.structures
    .filter((s) => t.x >= s.x && t.x < s.x + s.w && t.y >= s.y && t.y < s.y + s.h)
    .sort((a, b) => rank[a.kind] - rank[b.kind])[0];
}

/** The same Runway one length class longer (extending east or south), or null when already Long. */
export function lengthened(r: Runway): Runway | null {
  const next: RunwayLength | undefined = r.length === 'short' ? 'medium' : r.length === 'medium' ? 'long' : undefined;
  if (!next) return null;
  const tiles = BUILD_COSTS.runwayTiles[next];
  return r.w >= r.h ? { ...r, w: tiles, length: next } : { ...r, h: tiles, length: next };
}

/** Plot price for the next purchase in this session. */
export function nextPlotPrice(session: BuildSession): number {
  return Math.round(BUILD_COSTS.plotBase * (session.ownedPlots.length - session.base.startingPlots + 1) * session.base.modifiers.landCostFactor);
}
