/**
 * Airport layout as pure data on a tile grid (1 tile = 8 world units).
 * Every structure occupies a rectangular footprint of whole tiles.
 */

export const TILE_SIZE = 8;

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
export interface Stand extends TileRect {
  readonly kind: 'stand';
  readonly id: string;
  readonly size: SizeClass;
  readonly serves: 'terminal' | 'cargoHub';
  readonly placement: 'contact' | 'remote';
}
export interface HoldingBay extends TileRect {
  readonly kind: 'holdingBay';
  readonly size: SizeClass;
}
export interface AtcTower extends TileRect {
  readonly kind: 'atcTower';
}

export type Structure = Runway | Taxiway | Terminal | CargoHub | Stand | HoldingBay | AtcTower;

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

const stand = (id: string, x: number, serves: Stand['serves']): Stand => ({
  kind: 'stand', id, x, y: 6, w: 3, h: 3, size: 'medium', serves, placement: 'contact',
});

/** The layout every Run begins with. */
export function startingAirport(): AirportLayout {
  return createLayout(48, 28, [
    { kind: 'atcTower', x: 2, y: 2, w: 3, h: 4 },
    { kind: 'terminal', x: 7, y: 2, w: 15, h: 4 },
    { kind: 'cargoHub', x: 25, y: 2, w: 10, h: 4 },
    stand('1', 8, 'terminal'),
    stand('2', 11, 'terminal'),
    stand('3', 14, 'terminal'),
    stand('4', 17, 'terminal'),
    stand('C1', 26, 'cargoHub'),
    stand('C2', 29, 'cargoHub'),
    { kind: 'holdingBay', x: 38, y: 6, w: 3, h: 3, size: 'medium' },
    // Taxiway along the Stands, links down to Taxiway A, Taxiway A, connectors onto the Runway
    { kind: 'taxiway', x: 7, y: 9, w: 35, h: 3 },
    { kind: 'taxiway', x: 12, y: 12, w: 3, h: 4 },
    { kind: 'taxiway', x: 29, y: 12, w: 3, h: 4 },
    { kind: 'taxiway', x: 6, y: 16, w: 36, h: 3 },
    { kind: 'taxiway', x: 6, y: 19, w: 3, h: 3 },
    { kind: 'taxiway', x: 39, y: 19, w: 3, h: 3 },
    { kind: 'runway', x: 6, y: 22, w: 36, h: 4, length: 'medium', surface: 'asphalt' },
  ]);
}
