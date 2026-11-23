import { TILE_SIZE, type AirportLayout } from '../sim/layout';
import { holdShortLines } from '../sim/markings';
import { centreLine } from '../sim/taxi';

const T = TILE_SIZE;
type Dir = 'n' | 's' | 'e' | 'w';
const STEP: Record<Dir, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const key = (x: number, y: number) => `${x},${y}`;

/**
 * Centre-line tiles to draw the yellow line on: the network's centre line, stopping at the hold-short lines. Where a
 * strip's centre line runs on one tile past a corner or junction into the end of the strip it meets, that tile is
 * left out, so no line leads into nowhere and a plain corner is a single curve, not a T.
 */
export function centreTiles(layout: AirportLayout): Set<string> {
  const out = centreLine(layout);
  for (const h of holdShortLines(layout)) {
    for (let y = h.y; y < h.y + h.h; y++) for (let x = h.x; x < h.x + h.w; x++) out.delete(key(x, y));
  }
  const arms = (x: number, y: number) => (Object.values(STEP) as Array<[number, number]>).filter(([dx, dy]) => out.has(key(x + dx, y + dy)));
  const stubs = [...out].filter((k) => {
    const [x, y] = k.split(',').map(Number) as [number, number];
    const next = arms(x, y);
    if (next.length !== 1) return false;
    const [dx, dy] = next[0]!;
    return arms(x + dx, y + dy).length >= 3;
  });
  for (const k of stubs) out.delete(k);
  return out;
}

export type Polyline = Array<[number, number]>;

/**
 * The yellow centre lines as polylines in world units (simulation x, y): straight half-segments between tile centres,
 * curved corners, and curved lead-offs at T-junctions.
 */
export function centreLinePaths(layout: AirportLayout): Polyline[] {
  const tiles = centreTiles(layout);
  const has = (x: number, y: number) => tiles.has(key(x, y));
  const mid = (x: number, y: number): [number, number] => [(x + 0.5) * T, (y + 0.5) * T];
  const skip = new Set<string>(); // half-segments replaced by a corner curve: "x,y,dir"
  const out: Polyline[] = [];
  for (const k of tiles) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    const arms = (['n', 's', 'e', 'w'] as Dir[]).filter((d) => has(x + STEP[d][0], y + STEP[d][1]));
    const vertical = arms.filter((d) => d === 'n' || d === 's');
    const horizontal = arms.filter((d) => d === 'e' || d === 'w');
    if (vertical.length === 0 || horizontal.length === 0) continue;
    for (const v of vertical) {
      for (const h of horizontal) {
        const a = mid(x + STEP[v][0], y + STEP[v][1]);
        const c = mid(x, y);
        const b = mid(x + STEP[h][0], y + STEP[h][1]);
        const curve: Polyline = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          curve.push([(1 - t) ** 2 * a[0] + 2 * t * (1 - t) * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * t * (1 - t) * c[1] + t * t * b[1]]);
        }
        out.push(curve);
        if (arms.length === 2) {
          skip.add(`${x},${y},${v}`).add(`${x},${y},${h}`);
          skip.add(`${x + STEP[v][0]},${y + STEP[v][1]},${v === 'n' ? 's' : 'n'}`).add(`${x + STEP[h][0]},${y + STEP[h][1]},${h === 'e' ? 'w' : 'e'}`);
        }
      }
    }
  }
  for (const k of tiles) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    for (const d of ['e', 's'] as Dir[]) {
      const nx = x + STEP[d][0];
      const ny = y + STEP[d][1];
      if (!has(nx, ny)) continue;
      const back: Dir = d === 'e' ? 'w' : 'n';
      const a = mid(x, y);
      const b = mid(nx, ny);
      const half: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (!skip.has(`${x},${y},${d}`)) out.push([a, half]);
      if (!skip.has(`${nx},${ny},${back}`)) out.push([half, b]);
    }
  }
  return out;
}
