/**
 * Airport layout as pure data on a tile grid (1 tile = 8 world units).
 * Every structure occupies a rectangular footprint of whole tiles.
 */

export const TILE_SIZE = 8;

/**
 * The whole map in tiles, split into 16 × 14 Land Plots. It starts at (x0, y0), which is negative so there is
 * land on every side: the Run starts owning plots (0…2, 0…1) in the middle.
 */
export const WORLD = { x0: -16, y0: -16, width: 96, height: 64, plotW: 16, plotH: 16 } as const;

export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type SizeClass = 'small' | 'medium' | 'large';
export type RunwayLength = 'short' | 'medium' | 'long';
export type RunwaySurface = 'grass' | 'asphalt' | 'lit' | 'ils';

export interface Runway extends TileRect {
  readonly kind: 'runway';
  readonly length: RunwayLength;
  readonly surface: RunwaySurface;
}
export interface Taxiway extends TileRect {
  readonly kind: 'taxiway';
}
export interface Terminal extends TileRect {
  readonly kind: 'terminal';
}
export interface CargoHub extends TileRect {
  readonly kind: 'cargoHub';
}
/** The side a Stand or Holding Bay opens onto the Taxiway (default: south). */
export type Facing = 'north' | 'south' | 'east' | 'west';
export interface Stand extends TileRect {
  readonly kind: 'stand';
  readonly id: string;
  readonly size: SizeClass;
  readonly serves: 'terminal' | 'cargoHub';
  readonly placement: 'contact' | 'remote';
  readonly facing?: Facing;
}
export interface HoldingBay extends TileRect {
  readonly kind: 'holdingBay';
  readonly id: string;
  readonly size: SizeClass;
  readonly facing?: Facing;
}
export interface AtcTower extends TileRect {
  readonly kind: 'atcTower';
}
/** Enables one Emergency Action. */
/** Small buildings: three enable an Emergency Action, the others give their bonus while placed. */
export type SupportRole = 'rampAgentStation' | 'adminOffice' | 'airlineOffice' | 'fireRescueStation' | 'fuelFarm' | 'deIcingPad';
export interface SupportBuilding extends TileRect {
  readonly kind: 'supportBuilding';
  readonly role: SupportRole;
}

export type Structure = Runway | Taxiway | Terminal | CargoHub | Stand | HoldingBay | AtcTower | SupportBuilding;

export interface AirportLayout {
  /** Grid size in tiles. */
  readonly width: number;
  readonly height: number;
  readonly structures: readonly Structure[];
  readonly runways: readonly Runway[];
  readonly stands: readonly Stand[];
  readonly holdingBays: readonly HoldingBay[];
}

export function createLayout(width: number, height: number, structures: readonly Structure[]): AirportLayout {
  return {
    width,
    height,
    structures,
    runways: structures.filter((s): s is Runway => s.kind === 'runway'),
    stands: structures.filter((s): s is Stand => s.kind === 'stand'),
    holdingBays: structures.filter((s): s is HoldingBay => s.kind === 'holdingBay'),
  };
}

function rectsOverlap(a: TileRect, b: TileRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Every pair of structures that share at least one tile. Touching edges is fine. */
export function findOverlaps(layout: AirportLayout): Array<[Structure, Structure]> {
  const pairs: Array<[Structure, Structure]> = [];
  const all = layout.structures;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      if (rectsOverlap(a, b)) pairs.push([a, b]);
    }
  }
  return pairs;
}

const stand = (id: string, x: number, size: 'small' | 'medium', serves: Stand['serves']): Stand => ({
  kind: 'stand', id, x, y: 8, w: size === 'small' ? 2 : 3, h: 3, size, serves, placement: 'contact',
});

/**
 * The layout every Run begins with, centred in the starting land (3×2 Land Plots = 48×32 tiles): the Terminal with
 * 2 Small + 1 Medium Stands, the Cargo Hub with 1 Medium + 1 Small, a Small and a Medium Holding Bay right of the
 * cargo Stands, an apron lane along them with a link down near each end, the parallel Taxiway, a connector at each end of a Medium Asphalt Runway, and the ATC Tower.
 */
export function startingAirport(): AirportLayout {
  return createLayout(WORLD.width, WORLD.height, [
    // Terminal (west) and Cargo Hub (east) with 12 tiles between them: room for two Terminal wings growing east
    // (x 18–23) and two Cargo Hub wings growing west (x 24–29), each wing with Contact Stands below it on the apron lane
    { kind: 'atcTower', x: 2, y: 4, w: 3, h: 4 },
    { kind: 'terminal', x: 8, y: 4, w: 10, h: 4 },
    { kind: 'cargoHub', x: 30, y: 4, w: 7, h: 4 },
    stand('1', 8, 'small', 'terminal'),
    stand('2', 10, 'small', 'terminal'),
    stand('3', 12, 'medium', 'terminal'),
    stand('C1', 30, 'medium', 'cargoHub'),
    stand('C2', 33, 'small', 'cargoHub'),
    { kind: 'holdingBay', id: 'B1', x: 39, y: 8, w: 2, h: 3, size: 'small' },
    { kind: 'holdingBay', id: 'B2', x: 41, y: 8, w: 3, h: 3, size: 'medium' },
    // apron lane along the whole frontage (room to grow included), two links down near the middle, the parallel
    // Taxiway, Runway connectors
    { kind: 'taxiway', x: 7, y: 11, w: 37, h: 3 },
    { kind: 'taxiway', x: 15, y: 14, w: 3, h: 4 },
    { kind: 'taxiway', x: 33, y: 14, w: 3, h: 4 },
    { kind: 'taxiway', x: 6, y: 18, w: 36, h: 3 },
    { kind: 'taxiway', x: 6, y: 21, w: 3, h: 3 },
    { kind: 'taxiway', x: 39, y: 21, w: 3, h: 3 },
    { kind: 'runway', x: 6, y: 24, w: 36, h: 4, length: 'medium', surface: 'asphalt' },
  ]);
}

type Spot = TileRect & { readonly facing?: Facing };

/** The Taxiway tile right in front of a Stand's or Holding Bay's open side. */
export function spotEntry(s: Spot): { x: number; y: number } {
  const cx = s.x + Math.floor(s.w / 2);
  const cy = s.y + Math.floor(s.h / 2);
  switch (s.facing ?? 'south') {
    case 'north': return { x: cx, y: s.y - 1 };
    case 'east': return { x: s.x + s.w, y: cy };
    case 'west': return { x: s.x - 1, y: cy };
    default: return { x: cx, y: s.y + s.h };
  }
}

/** Heading of an aircraft parked nose-in on a Stand (it faces away from the open side). */
export function parkedHeading(s: Spot): number {
  return { south: 0, north: 180, east: 270, west: 90 }[s.facing ?? 'south'];
}

/** Whether two rectangles share at least one full tile of edge. */
export function sharesEdge(a: TileRect, b: TileRect): boolean {
  const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ((a.x + a.w === b.x || b.x + b.w === a.x) && yOverlap >= 1) || ((a.y + a.h === b.y || b.y + b.h === a.y) && xOverlap >= 1);
}

const SURFACE_RANK: Record<RunwaySurface, number> = { grass: 0, asphalt: 1, lit: 2, ils: 3 };

/**
 * The airport's Runway Surface: the best surface bought (it is an airport-wide upgrade). New paved Runways are built
 * with it; Grass strips stay Grass.
 */
export function airportSurface(layout: AirportLayout): RunwaySurface {
  return layout.runways.reduce<RunwaySurface>((best, r) => (SURFACE_RANK[r.surface] > SURFACE_RANK[best] ? r.surface : best), 'grass');
}

/** The two names of a Runway: `forward` for landing east or south (09 / 18), `reverse` for west or north (27 / 36). */
export interface RunwayName { readonly forward: string; readonly reverse: string }

/**
 * Runway designators as on a real airport: 09/27 (horizontal) or 18/36 (vertical), and parallel Runways get letters as
 * seen from the approach (ICAO Annex 14): two L R, three L C R; from four on they are split into groups of up to three
 * and each further group takes the next number (e.g. 09L 09R 10L 10R). Letters swap at the other end: 09L is 27R.
 */
export function runwayNames(layout: AirportLayout): RunwayName[] {
  const names: RunwayName[] = layout.runways.map(() => ({ forward: '', reverse: '' }));
  const two = (n: number) => String(n).padStart(2, '0');
  const flip: Record<string, string> = { L: 'R', R: 'L', C: 'C', '': '' };
  const groups = (n: number): string[][] => {
    if (n === 1) return [['']];
    if (n === 2) return [['L', 'R']];
    if (n === 3) return [['L', 'C', 'R']];
    if (n === 4) return [['L', 'R'], ['L', 'R']];
    if (n === 5) return [['L', 'C', 'R'], ['L', 'R']];
    return [['L', 'C', 'R'], ...groups(n - 3)];
  };
  for (const vertical of [false, true]) {
    // left to right as seen landing east (09: north first) or south (18: east first)
    const order = layout.runways.map((r, i) => ({ r, i })).filter(({ r }) => (r.h > r.w) === vertical)
      .sort((a, b) => (vertical ? b.r.x - a.r.x : a.r.y - b.r.y));
    const base = vertical ? 18 : 9;
    let k = 0;
    groups(order.length || 1).forEach((letters, g) => {
      for (const letter of letters) {
        const at = order[k++];
        if (!at) return;
        const forward = (base + g - 1) % 36 + 1;
        names[at.i] = { forward: two(forward) + letter, reverse: two((forward + 17) % 36 + 1) + flip[letter] };
      }
    });
  }
  return names;
}

/** Tiles past each end of a Runway, its full width, where nothing may be built (approach and departure areas). */
export const RUNWAY_END_CLEAR_TILES = 4;

/** The two no-build areas beyond a Runway's ends; they may reach into land not bought yet. */
export function runwayEndZones(r: TileRect): TileRect[] {
  const n = RUNWAY_END_CLEAR_TILES;
  return r.w >= r.h
    ? [{ x: r.x - n, y: r.y, w: n, h: r.h }, { x: r.x + r.w, y: r.y, w: n, h: r.h }]
    : [{ x: r.x, y: r.y - n, w: r.w, h: n }, { x: r.x, y: r.y + r.h, w: r.w, h: n }];
}
