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
  return { index, runway, vertical, holdPoint: first, runwayExit: last };
}

export function buildTaxiNetwork(layout: AirportLayout): TaxiNetwork {
  if (!layout.runways[0]) throw new Error('A layout needs a Runway');
  const tiles = new Set<string>();
  for (const s of layout.structures) if (s.kind === 'taxiway') for (const t of tilesOf(s)) tiles.add(key(t));
  const runways = layout.runways.flatMap((r, i) => runwayAccess(layout, r, i) ?? []);
  const main = runways[0];
  const nowhere = { x: -1, y: -1 };
  return {
    layout, tiles, runways,
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
