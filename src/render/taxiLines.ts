import type { Graphics } from 'pixi.js';
import { TILE_SIZE, type AirportLayout, type TileRect } from '../sim/layout';
import { holdShortLines } from '../sim/markings';

const T = TILE_SIZE;
type Dir = 'n' | 's' | 'e' | 'w';
const STEP: Record<Dir, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const key = (x: number, y: number) => `${x},${y}`;

/**
 * Centre-line tiles of the Taxiway network: the middle row/column of every strip, extended into
 * neighbouring strips up to their centre line so junctions meet. Tiles from the hold line onwards are left out.
 */
export function centreTiles(layout: AirportLayout): Set<string> {
  const taxiways = layout.structures.filter((s): s is TileRect & { kind: 'taxiway' } => s.kind === 'taxiway');
  const at = (x: number, y: number) => taxiways.find((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h);
  const out = new Set<string>();
  const centreOf = (t: TileRect) => ({ cx: t.x + Math.floor(t.w / 2), cy: t.y + Math.floor(t.h / 2) });
  for (const t of taxiways) {
    const { cx, cy } = centreOf(t);
    const vertical = t.h > t.w || (t.h === t.w && layout.runways.some((r) => t.y + t.h === r.y || t.y === r.y + r.h));
    if (t.h === t.w && !vertical) {
      out.add(key(cx, cy));
      // squares that are not Runway connectors join every neighbour they touch
      for (const d of ['n', 's', 'e', 'w'] as Dir[]) extend(cx, cy, d);
      continue;
    }
    if (vertical) for (let y = t.y; y < t.y + t.h; y++) out.add(key(cx, y));
    else for (let x = t.x; x < t.x + t.w; x++) out.add(key(x, cy));
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
      out.add(key(nx, ny));
      if ((dx === 0 && ny === cy) || (dy === 0 && nx === cx)) return;
    }
  }
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
