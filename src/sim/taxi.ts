/**
 * Taxi network: a graph of Taxiway tiles (4-neighbour) built from the layout.
 * Routes are lists of tiles; aircraft move along tile centres.
 */
import type { AirportLayout, Runway, TileRect } from './layout';

/** A Stand or Holding Bay: a spot an aircraft taxis into from the Taxiway below it. */
export type Spot = TileRect & { readonly id: string };

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

/** The first exit a landing aircraft of this Size Class can reach after its landing roll (or the last one). */
export function exitFor(a: RunwayAccess, reverse: boolean, size: keyof typeof ROLL_TILES): Tile {
  const ordered = [...a.connectors].sort((p, q) => fromThreshold(a, reverse, p) - fromThreshold(a, reverse, q));
  return ordered.find((t) => fromThreshold(a, reverse, t) >= ROLL_TILES[size]) ?? ordered[ordered.length - 1]!;
}

export interface TaxiNetwork {
  readonly layout: AirportLayout;
  /** Taxiway tiles keyed by "x,y". */
  readonly tiles: ReadonlySet<string>;
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
    const c = component.get(key({ x: centreTile(s).x, y: s.y + s.h }));
    if (c !== undefined && withExit.has(c) && withHold.has(c)) reachableSpots.add(s.id);
  }
  return {
    layout, tiles, runways, component, reachableSpots,
    runway: main?.runway ?? layout.runways[0], runwayExit: main?.runwayExit ?? nowhere, holdPoint: main?.holdPoint ?? nowhere,
  };
}

/** The Taxiway tile directly in front of a Stand's open side (below it) and the Stand's centre tile. */
function standAccess(network: TaxiNetwork, stand: Spot): { entry: Tile; centre: Tile } {
  const centre = centreTile(stand);
  const entry = { x: centre.x, y: stand.y + stand.h };
  if (!network.tiles.has(key(entry))) throw new Error(`Stand ${stand.id} has no Taxiway in front of it`);
  return { entry, centre };
}

/** Breadth-first shortest path over Taxiway tiles. */
function shortestPath(network: TaxiNetwork, from: Tile, to: Tile): Tile[] {
  const start = key(from);
  const goal = key(to);
  const prev = new Map<string, string | null>([[start, null]]);
  const queue: Tile[] = [from];
  while (queue.length) {
    const t = queue.shift()!;
    if (key(t) === goal) break;
    for (const n of [{ x: t.x + 1, y: t.y }, { x: t.x - 1, y: t.y }, { x: t.x, y: t.y + 1 }, { x: t.x, y: t.y - 1 }]) {
      const k = key(n);
      if (network.tiles.has(k) && !prev.has(k)) {
        prev.set(k, key(t));
        queue.push(n);
      }
    }
  }
  if (!prev.has(goal)) throw new Error(`No taxi route from ${start} to ${goal}`);
  const path: Tile[] = [];
  for (let k: string | null | undefined = goal; k; k = prev.get(k)) {
    const [x, y] = k.split(',').map(Number);
    path.push({ x: x!, y: y! });
  }
  return path.reverse();
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
  for (let y = entry.y - 1; y >= centre.y; y--) out.push({ x: entry.x, y });
  return out;
}
