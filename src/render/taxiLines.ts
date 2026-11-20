import type { Graphics } from 'pixi.js';
import { TILE_SIZE, type AirportLayout } from '../sim/layout';
import { holdShortLines } from '../sim/markings';
import { centreLine } from '../sim/taxi';

const T = TILE_SIZE;
type Dir = 'n' | 's' | 'e' | 'w';
const STEP: Record<Dir, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const key = (x: number, y: number) => `${x},${y}`;

/** Centre-line tiles to draw the yellow line on: the network's centre line, stopping at the hold-short lines. */
export function centreTiles(layout: AirportLayout): Set<string> {
  const out = centreLine(layout);
  for (const h of holdShortLines(layout)) {
    for (let y = h.y; y < h.y + h.h; y++) for (let x = h.x; x < h.x + h.w; x++) out.delete(key(x, y));
  }
  return out;
}

/** Draws connected centre lines with curved corners and curved lead-offs at T-junctions. */
export function drawCentreLines(g: Graphics, layout: AirportLayout, color: number): void {
  const tiles = centreTiles(layout);
  const has = (x: number, y: number) => tiles.has(key(x, y));
  const mid = (x: number, y: number): [number, number] => [(x + 0.5) * T, (y + 0.5) * T];
  const stroke = { width: 0.6, color, cap: 'round' as const };
  const skip = new Set<string>(); // half-segments replaced by a corner curve: "x,y,dir"
  const curves: Array<[[number, number], [number, number], [number, number]]> = [];

  for (const k of tiles) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    const arms = (['n', 's', 'e', 'w'] as Dir[]).filter((d) => has(x + STEP[d][0], y + STEP[d][1]));
    const vertical = arms.filter((d) => d === 'n' || d === 's');
    const horizontal = arms.filter((d) => d === 'e' || d === 'w');
    if (vertical.length === 0 || horizontal.length === 0) continue;
    for (const v of vertical) {
      for (const h of horizontal) {
        const a: [number, number] = [x + STEP[v][0], y + STEP[v][1]];
        const b: [number, number] = [x + STEP[h][0], y + STEP[h][1]];
        curves.push([mid(...a), mid(x, y), mid(...b)]);
        if (arms.length === 2) {
          // a plain corner: the curve replaces the straight lines through it
          skip.add(`${x},${y},${v}`).add(`${x},${y},${h}`);
          skip.add(`${a[0]},${a[1]},${v === 'n' ? 's' : 'n'}`).add(`${b[0]},${b[1]},${h === 'e' ? 'w' : 'e'}`);
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
      const [ax, ay] = mid(x, y);
      const [bx, by] = mid(nx, ny);
      const hx = (ax + bx) / 2;
      const hy = (ay + by) / 2;
      if (!skip.has(`${x},${y},${d}`)) g.moveTo(ax, ay).lineTo(hx, hy).stroke(stroke);
      if (!skip.has(`${nx},${ny},${back}`)) g.moveTo(hx, hy).lineTo(bx, by).stroke(stroke);
    }
  }
  for (const [a, c, b] of curves) g.moveTo(...a).quadraticCurveTo(c[0], c[1], b[0], b[1]).stroke(stroke);
}
