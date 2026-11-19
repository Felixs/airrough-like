/**
 * Taxi network: a graph of Taxiway tiles (4-neighbour) built from the layout.
 * Routes are lists of tiles; aircraft move along tile centres.
 */
import type { AirportLayout, Runway, Stand, TileRect } from './layout';

export interface Tile {
  readonly x: number;
  readonly y: number;
}

export interface TaxiNetwork {
  readonly layout: AirportLayout;
  /** Taxiway tiles keyed by "x,y". */
  readonly tiles: ReadonlySet<string>;
  readonly runway: Runway;
  /** Taxiway tile next to the Runway where landing aircraft leave it (far end, Runway 09 in use). */
  readonly runwayExit: Tile;
  /** Taxiway tile next to the Runway where departures hold short (near end). */
  readonly holdPoint: Tile;
}

const key = (t: Tile) => `${t.x},${t.y}`;

function tilesOf(r: TileRect): Tile[] {
  const out: Tile[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
  return out;
}

const centreTile = (r: TileRect): Tile => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

export function buildTaxiNetwork(layout: AirportLayout): TaxiNetwork {
  const runway = layout.runways[0];
  if (!runway) throw new Error('A layout needs a Runway');
  const tiles = new Set<string>();
  for (const s of layout.structures) if (s.kind === 'taxiway') for (const t of tilesOf(s)) tiles.add(key(t));

  // Connectors: Taxiways touching the Runway's top edge. The row right above the Runway is where they meet it.
  const edgeRow = runway.y - 1;
  const connectors = layout.structures
    .filter((s) => s.kind === 'taxiway' && s.y + s.h === runway.y && s.x >= runway.x && s.x + s.w <= runway.x + runway.w)
    .sort((a, b) => a.x - b.x);
  const first = connectors[0];
  const last = connectors[connectors.length - 1];
  if (!first || !last || first === last) throw new Error('A Runway needs Taxiway connectors at both ends');
  return {
    layout,
    tiles,
    runway,
    holdPoint: { x: centreTile(first).x, y: edgeRow },
    runwayExit: { x: centreTile(last).x, y: edgeRow },
  };
}

/** The Taxiway tile directly in front of a Stand's open side (below it) and the Stand's centre tile. */
function standAccess(network: TaxiNetwork, stand: Stand): { entry: Tile; centre: Tile } {
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

export function routeToStand(network: TaxiNetwork, from: Tile, stand: Stand): Tile[] {
  const { entry, centre } = standAccess(network, stand);
  return [...shortestPath(network, from, entry), ...walkInto(entry, centre)];
}

export function routeFromStand(network: TaxiNetwork, stand: Stand, to: Tile): Tile[] {
  const { entry, centre } = standAccess(network, stand);
  return [...walkInto(entry, centre).reverse(), ...shortestPath(network, entry, to)];
}

/** Tiles from just inside the Stand up to its centre (excluding the entry tile). */
function walkInto(entry: Tile, centre: Tile): Tile[] {
  const out: Tile[] = [];
  for (let y = entry.y - 1; y >= centre.y; y--) out.push({ x: entry.x, y });
  return out;
}
