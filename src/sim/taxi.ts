/**
 * Taxi network: a graph of Taxiway tiles (4-neighbour) built from the layout.
 * Routes are lists of tiles; aircraft move along tile centres.
 */
import { spotEntry, type AirportLayout, type Facing, type Runway, type TileRect } from './layout';

/** A Stand or Holding Bay: a spot an aircraft taxis into from the Taxiway below it. */
export type Spot = TileRect & { readonly id: string; readonly facing?: Facing };

type Dir = 'n' | 's' | 'e' | 'w';
const STEP: Record<Dir, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

/**
 * Centre-line tiles of the Taxiway network: the middle row/column of every strip, extended into
 * neighbouring strips up to their centre line so junctions meet.
 * Aircraft taxi along these tiles (the yellow line) and leave them only to turn into a Stand or onto a Runway.
 */
export function centreLine(layout: AirportLayout): Set<string> {
  const taxiways = layout.structures.filter((s): s is TileRect & { kind: 'taxiway' } => s.kind === 'taxiway');
  const at = (x: number, y: number) => taxiways.find((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h);
  const out = new Set<string>();
  const centreOf = (t: TileRect) => ({ cx: t.x + Math.floor(t.w / 2), cy: t.y + Math.floor(t.h / 2) });
  for (const t of taxiways) {
    const { cx, cy } = centreOf(t);
    // A square piece follows whatever it joins: only above/below → vertical, only left/right → horizontal,
    // both → a real junction. Runway connectors are vertical (or horizontal for vertical Runways).
    const row = (yy: number) => Array.from({ length: t.w }, (_, i) => at(t.x + i, yy)).some(Boolean);
    const col = (xx: number) => Array.from({ length: t.h }, (_, i) => at(xx, t.y + i)).some(Boolean);
    const touchesRunwayEnd = layout.runways.some((r) => (t.y + t.h === r.y || t.y === r.y + r.h) && t.x >= r.x && t.x + t.w <= r.x + r.w);
    const touchesRunwaySide = layout.runways.some((r) => (t.x + t.w === r.x || t.x === r.x + r.w) && t.y >= r.y && t.y + t.h <= r.y + r.h);
    const ns = row(t.y - 1) || row(t.y + t.h) || touchesRunwayEnd;
    const ew = col(t.x - 1) || col(t.x + t.w) || touchesRunwaySide;
    const vertical = t.h > t.w || (t.h === t.w && ns && !ew);
    if (t.h === t.w && ns && ew) {
      out.add(`${cx},${cy}`);
      // squares that are not Runway connectors join every neighbour they touch
      for (const d of ['n', 's', 'e', 'w'] as Dir[]) extend(cx, cy, d);
      continue;
    }
    if (vertical) for (let y = t.y; y < t.y + t.h; y++) out.add(`${cx},${y}`);
    else for (let x = t.x; x < t.x + t.w; x++) out.add(`${x},${cy}`);
    if (vertical) {
      extend(cx, t.y, 'n');
      extend(cx, t.y + t.h - 1, 's');
    } else {
      extend(t.x, cy, 'w');
      extend(t.x + t.w - 1, cy, 'e');
    }
  }
  function extend(x: number, y: number, d: Dir): void {
    const [dx, dy] = STEP[d];
    const first = at(x + dx, y + dy);
    if (!first) return;
    const { cx, cy } = centreOf(first);
    // walk into the neighbour until reaching its centre line (perpendicular) or a few tiles (parallel)
    for (let i = 1; i <= 4; i++) {
      const nx = x + dx * i;
      const ny = y + dy * i;
      if (!at(nx, ny)) return;
      out.add(`${nx},${ny}`);
      if ((dx === 0 && ny === cy) || (dy === 0 && nx === cx)) return;
    }
  }
  return out;
}


export interface Tile {
  readonly x: number;
  readonly y: number;
}

/** How aircraft get on and off one Runway. */
export interface RunwayAccess {
  /** Index into layout.runways. */
  readonly index: number;
  readonly runway: Runway;
  readonly vertical: boolean;
  /** Taxiway tile next to the Runway where landing aircraft leave it (far end). */
  readonly runwayExit: Tile;
  /** Taxiway tile next to the Runway where departures hold short (near end). */
  readonly holdPoint: Tile;
  /** Every connector's tile next to the Runway, in order from its start (west or north) end. */
  readonly connectors: readonly Tile[];
}

/** Landing roll in tiles before an aircraft can vacate, by Size Class *(first guess)*. */
export const ROLL_TILES = { small: 12, medium: 30, large: 44 } as const;

const alongForward = (a: RunwayAccess, t: Tile) => (a.vertical ? t.y + 0.5 - a.runway.y : t.x + 0.5 - a.runway.x);
const runwayLength = (a: RunwayAccess) => (a.vertical ? a.runway.h : a.runway.w);

/** Distance in tiles from the landing threshold to a tile, for the given direction. */
export function fromThreshold(a: RunwayAccess, reverse: boolean, t: Tile): number {
  return reverse ? runwayLength(a) - alongForward(a, t) : alongForward(a, t);
}

/** Where departures hold short: at the end the takeoff roll starts from (into the wind, like landings). */
export function holdPointFor(a: RunwayAccess, reverse: boolean): Tile {
  return reverse ? a.connectors[a.connectors.length - 1]! : a.connectors[0]!;
}

/**
 * The exits a landing aircraft of this Size Class can take, in the order it reaches them: every connector past its
 * landing roll (or only the last one when none is). If the first is blocked it rolls on to the next.
 */
export function exitsFor(a: RunwayAccess, reverse: boolean, size: keyof typeof ROLL_TILES): Tile[] {
  const ordered = [...a.connectors].sort((p, q) => fromThreshold(a, reverse, p) - fromThreshold(a, reverse, q));
  const past = ordered.filter((t) => fromThreshold(a, reverse, t) >= ROLL_TILES[size]);
  return past.length ? past : [ordered[ordered.length - 1]!];
}

/** The first exit a landing aircraft of this Size Class can reach after its landing roll (or the last one). */
export function exitFor(a: RunwayAccess, reverse: boolean, size: keyof typeof ROLL_TILES): Tile {
  return exitsFor(a, reverse, size)[0]!;
}

export interface TaxiNetwork {
  readonly layout: AirportLayout;
  /** Taxiway tiles keyed by "x,y". */
  readonly tiles: ReadonlySet<string>;
  /** The centre-line tiles (the yellow line) aircraft keep to. */
  readonly centre: ReadonlySet<string>;
  /** Runways with Taxiway connectors at both ends; others can't be used. */
  readonly runways: readonly RunwayAccess[];
  /** The first usable Runway (kept for single-Runway callers). */
  readonly runway: Runway;
  readonly runwayExit: Tile;
  readonly holdPoint: Tile;
  /** Connected part of the Taxiway network each tile belongs to ("x,y" → id). */
  readonly component: ReadonlyMap<string, number>;
  /** Stands and Holding Bays an aircraft can actually taxi to from a Runway exit and back to a hold point. */
  readonly reachableSpots: ReadonlySet<string>;
}

const key = (t: Tile) => `${t.x},${t.y}`;

function tilesOf(r: TileRect): Tile[] {
  const out: Tile[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
  return out;
}

const centreTile = (r: TileRect): Tile => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

/** Taxiway connectors touching a Runway's long sides, in landing order, with the tile where each meets it. */
function runwayAccess(layout: AirportLayout, runway: Runway, index: number): RunwayAccess | null {
  const vertical = runway.h > runway.w;
  const meets: Tile[] = [];
  for (const t of layout.structures) {
    if (t.kind !== 'taxiway') continue;
    if (!vertical && t.x >= runway.x && t.x + t.w <= runway.x + runway.w) {
      if (t.y + t.h === runway.y) meets.push({ x: centreTile(t).x, y: runway.y - 1 });
      else if (t.y === runway.y + runway.h) meets.push({ x: centreTile(t).x, y: runway.y + runway.h });
    } else if (vertical && t.y >= runway.y && t.y + t.h <= runway.y + runway.h) {
      if (t.x + t.w === runway.x) meets.push({ x: runway.x - 1, y: centreTile(t).y });
      else if (t.x === runway.x + runway.w) meets.push({ x: runway.x + runway.w, y: centreTile(t).y });
    }
  }
  meets.sort((a, b) => (vertical ? a.y - b.y : a.x - b.x));
  const first = meets[0];
  const last = meets[meets.length - 1];
  if (!first || !last || meets.length < 2 || (vertical ? first.y === last.y : first.x === last.x)) return null;
  return { index, runway, vertical, holdPoint: first, runwayExit: last, connectors: meets };
}

export function buildTaxiNetwork(layout: AirportLayout): TaxiNetwork {
  if (!layout.runways[0]) throw new Error('A layout needs a Runway');
  const tiles = new Set<string>();
  for (const s of layout.structures) if (s.kind === 'taxiway') for (const t of tilesOf(s)) tiles.add(key(t));
  const runways = layout.runways.flatMap((r, i) => runwayAccess(layout, r, i) ?? []);
  const main = runways[0];
  const nowhere = { x: -1, y: -1 };
  // Connected parts of the network, so Stands cut off from every Runway are never used.
  const component = new Map<string, number>();
  let next = 0;
  for (const start of tiles) {
    if (component.has(start)) continue;
    const id = next++;
    const queue = [start];
    component.set(start, id);
    while (queue.length) {
      const [x, y] = queue.pop()!.split(',').map(Number) as [number, number];
      for (const n of [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`]) {
        if (tiles.has(n) && !component.has(n)) {
          component.set(n, id);
          queue.push(n);
        }
      }
    }
  }
  const withExit = new Set(runways.map((a) => component.get(key(a.runwayExit))));
  const withHold = new Set(runways.map((a) => component.get(key(a.holdPoint))));
  const reachableSpots = new Set<string>();
  for (const s of [...layout.stands, ...layout.holdingBays]) {
    const c = component.get(key(spotEntry(s)));
    if (c !== undefined && withExit.has(c) && withHold.has(c)) reachableSpots.add(s.id);
  }
  return {
    layout, tiles, centre: centreLine(layout), runways, component, reachableSpots,
    runway: main?.runway ?? layout.runways[0], runwayExit: main?.runwayExit ?? nowhere, holdPoint: main?.holdPoint ?? nowhere,
  };
}

/** The Taxiway tile directly in front of a Stand's open side (below it) and the Stand's centre tile. */
function standAccess(network: TaxiNetwork, stand: Spot): { entry: Tile; centre: Tile } {
  const centre = centreTile(stand);
  const entry = spotEntry(stand);
  if (!network.tiles.has(key(entry))) throw new Error(`Stand ${stand.id} has no Taxiway in front of it`);
  return { entry, centre };
}

/** Breadth-first shortest path over Taxiway tiles. */
function shortestPath(network: TaxiNetwork, from: Tile, to: Tile): Tile[] {
  const path = searchPath(network, from, to);
  if (!path) throw new Error(`No taxi route from ${key(from)} to ${key(to)}`);
  return path;
}

/** Stepping off the centre line costs this much more than following it, so routes keep to the yellow line. */
const OFF_CENTRE_COST = 6;

/**
 * Cheapest 4-neighbour path over Taxiway tiles (Dijkstra): a step onto a centre-line tile costs 1, any other tile
 * OFF_CENTRE_COST, so aircraft follow the centre line and leave it only where they have to (a Stand entry, a hold
 * point). Ties go to the neighbour found first (east, west, south, north), so routes are deterministic.
 */
/** Tiles a route must keep off: a fixed set, or a test given the tile and how many steps from the start it is reached. */
export type Avoid = ReadonlySet<string> | ((key: string, steps: number) => boolean);
const avoids = (avoid: Avoid | undefined, k: string, steps: number) => !!avoid && (typeof avoid === 'function' ? avoid(k, steps) : avoid.has(k));

function searchPath(network: TaxiNetwork, from: Tile, to: Tile, avoid?: Avoid): Tile[] | null {
  const start = key(from);
  const goal = key(to);
  const cost = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, string | null>([[start, null]]);
  const steps = new Map<string, number>([[start, 0]]);
  const done = new Set<string>();
  // binary heap of [cost, order, tile]
  const heap: [number, number, Tile][] = [[0, 0, from]];
  let order = 0;
  const less = (a: [number, number, Tile], b: [number, number, Tile]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (e: [number, number, Tile]) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l]!, heap[m]!)) m = l;
        if (r < heap.length && less(heap[r]!, heap[m]!)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m]!, heap[i]!];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [c, , t] = pop();
    const k = key(t);
    if (done.has(k)) continue;
    done.add(k);
    if (k === goal) break;
    for (const n of [{ x: t.x + 1, y: t.y }, { x: t.x - 1, y: t.y }, { x: t.x, y: t.y + 1 }, { x: t.x, y: t.y - 1 }]) {
      const nk = key(n);
      const ns = steps.get(k)! + 1;
      if (!network.tiles.has(nk) || done.has(nk) || avoids(avoid, nk, ns)) continue;
      const nc = c + (network.centre.has(nk) ? 1 : OFF_CENTRE_COST);
      if (nc < (cost.get(nk) ?? Infinity)) {
        cost.set(nk, nc);
        prev.set(nk, k);
        steps.set(nk, ns);
        push([nc, ++order, n]);
      }
    }
  }
  if (!prev.has(goal)) return null;
  const path: Tile[] = [];
  for (let k: string | null | undefined = goal; k; k = prev.get(k)) {
    const [x, y] = k.split(',').map(Number);
    path.push({ x: x!, y: y! });
  }
  return path.reverse();
}

/**
 * The same route, but around the `avoid` tiles (e.g. a Taxiway closed by an Incident) from index `from` on: the
 * start of the route and its end off the Taxiway (the walk into a Stand) stay as they are. Null when there is no way
 * round.
 */
export function detour(network: TaxiNetwork, route: readonly Tile[], from: number, avoid: Avoid): Tile[] | null {
  let end = route.length - 1;
  while (end > from && !network.tiles.has(key(route[end]!))) end--;
  const a = route[from];
  const b = route[end];
  if (!a || !b || end <= from || avoids(avoid, key(a), 0) || !network.tiles.has(key(a))) return null;
  if (typeof avoid !== 'function' && avoid.has(key(b))) return null;
  const path = searchPath(network, a, b, avoid);
  return path ? [...route.slice(0, from), ...path, ...route.slice(end + 1)] : null;
}

/** Shortest route between two Taxiway tiles (inclusive). */
export function taxiRoute(network: TaxiNetwork, from: Tile, to: Tile): Tile[] {
  return shortestPath(network, from, to);
}

export function routeToStand(network: TaxiNetwork, from: Tile, stand: Spot): Tile[] {
  const { entry, centre } = standAccess(network, stand);
  return [...shortestPath(network, from, entry), ...walkInto(entry, centre)];
}

export function routeFromStand(network: TaxiNetwork, stand: Spot, to: Tile): Tile[] {
  const { entry, centre } = standAccess(network, stand);
  return [...walkInto(entry, centre).reverse(), ...shortestPath(network, entry, to)];
}

/** From one Spot (e.g. a Holding Bay) to another (e.g. a Stand). */
export function routeBetween(network: TaxiNetwork, from: Spot, to: Spot): Tile[] {
  const toEntry = standAccess(network, to).entry;
  return [...routeFromStand(network, from, toEntry), ...routeToStand(network, toEntry, to).slice(1)];
}

/** Tiles from just inside the Stand up to its centre (excluding the entry tile). */
function walkInto(entry: Tile, centre: Tile): Tile[] {
  const out: Tile[] = [];
  const dx = Math.sign(centre.x - entry.x);
  const dy = Math.sign(centre.y - entry.y);
  for (let x = entry.x + dx, y = entry.y + dy; ; x += dx, y += dy) {
    out.push({ x, y });
    if ((dx === 0 || x === centre.x) && (dy === 0 || y === centre.y)) break;
  }
  return out;
}
