/**
 * Where airfield markings go, in tile coordinates: hold-short lines and signs where Taxiways meet a Runway,
 * and blue Taxiway edge lights (none across junction mouths). Pure, so the renderer only draws them.
 */
import type { AirportLayout, Runway, TileRect } from './layout';

export interface HoldShortLine {
  /** Tile row (north/south) or column (west/east) of the hold line, and its extent. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Side of the Runway the Taxiway is on. */
  readonly side: 'north' | 'south' | 'west' | 'east';
  readonly sign: string;
}

const runwaySign = (r: Runway) => (r.w >= r.h ? '09-27' : '18-36');

export function holdShortLines(layout: AirportLayout): HoldShortLine[] {
  const out: HoldShortLine[] = [];
  for (const r of layout.runways) {
    for (const t of layout.structures) {
      if (t.kind !== 'taxiway') continue;
      const alongX = t.x >= r.x && t.x + t.w <= r.x + r.w;
      const alongY = t.y >= r.y && t.y + t.h <= r.y + r.h;
      if (alongX && t.y + t.h === r.y) out.push({ x: t.x, y: r.y - 1, w: t.w, h: 1, side: 'north', sign: runwaySign(r) });
      else if (alongX && t.y === r.y + r.h) out.push({ x: t.x, y: r.y + r.h, w: t.w, h: 1, side: 'south', sign: runwaySign(r) });
      else if (alongY && t.x + t.w === r.x) out.push({ x: r.x - 1, y: t.y, w: 1, h: t.h, side: 'west', sign: runwaySign(r) });
      else if (alongY && t.x === r.x + r.w) out.push({ x: r.x + r.w, y: t.y, w: 1, h: t.h, side: 'east', sign: runwaySign(r) });
    }
  }
  return out.sort((a, b) => a.x - b.x || a.y - b.y);
}

export interface EdgeLight {
  readonly x: number;
  readonly y: number;
}

const tilesOf = (r: TileRect) => {
  const out: Array<[number, number]> = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push([x, y]);
  return out;
};

/** One light at the middle of every Taxiway tile edge that borders unpaved ground. */
export function taxiwayEdgeLights(layout: AirportLayout): EdgeLight[] {
  const paved = new Set<string>();
  const taxi = new Set<string>();
  for (const s of layout.structures) {
    if (s.kind === 'taxiway' || s.kind === 'runway' || s.kind === 'stand' || s.kind === 'holdingBay') {
      for (const [x, y] of tilesOf(s)) {
        paved.add(`${x},${y}`);
        if (s.kind === 'taxiway') taxi.add(`${x},${y}`);
      }
    }
  }
  const out: EdgeLight[] = [];
  for (const k of taxi) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    if (!paved.has(`${x},${y - 1}`)) out.push({ x: x + 0.5, y });
    if (!paved.has(`${x},${y + 1}`)) out.push({ x: x + 0.5, y: y + 1 });
    if (!paved.has(`${x - 1},${y}`)) out.push({ x, y: y + 0.5 });
    if (!paved.has(`${x + 1},${y}`)) out.push({ x: x + 1, y: y + 0.5 });
  }
  return out;
}
