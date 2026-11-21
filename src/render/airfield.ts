import { Container, Graphics, Text } from 'pixi.js';
import { runwayNames, sharesEdge, TILE_SIZE, WORLD, type AirportLayout, type RunwayName, type Facing, type Structure, type TileRect } from '../sim/layout';
import { holdShortLines, TAXIWAY_INSET, taxiwayEdgeLights } from '../sim/markings';
import { centreLine } from '../sim/taxi';
import { drawCentreLines } from './taxiLines';

/** Colours from the accepted UI baseline (ATC Console, night palette, v5 realistic vector art). */
const COLOURS = {
  grass: 0x0f1a15,
  grass2: 0x0c1511,
  grass3: 0x12201a,
  asphalt: 0x1a2024,
  asphaltEdge: 0x131819,
  marking: 0xb9c5c7,
  taxiLine: 0xc9a227,
  standOutline: 0xb3392f,
  roof: 0x27322d,
  roofEdge: 0x33413b,
  terminalRoof: 0x2a3531,
  cargoRoof: 0x2f2823,
  wall: 0x151c19,
  glass: 0x2c6f69,
  glassHi: 0x4fa39b,
  label: 0x7f9a92,
  edgeLight: 0x4aa3ff,
  edgeWhite: 0xe6f0f2,
  thresholdGreen: 0x5ff28a,
  signRed: 0xb3261e,
  signText: 0xf2f2f2,
  fence: 0x2f3d37,
  tree: 0x10261a,
  treeHi: 0x163223,
} as const;
const SHADOW = { color: 0x000000, alpha: 0.45 } as const;

const T = TILE_SIZE;

function label(text: string, x: number, y: number): Text {
  const t = new Text({
    text,
    style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 4, fontWeight: '700', fill: COLOURS.label, letterSpacing: 0.6 },
  });
  t.anchor.set(0.5, 1);
  t.position.set(x, y);
  t.resolution = 4;
  return t;
}

/** Oblique 3D box: roof w×d at (x, y), a visible south wall of height h, and a shadow cast to the south-east. */
function box(g: Graphics, x: number, y: number, w: number, d: number, h: number, roof: number, wall: number, edgeHi = 0x3a4943, edgeLo = 0x141a17): void {
  const sh = h * 0.9;
  g.poly([x + w, y, x + w + sh, y + sh * 0.55, x + w + sh, y + d + h + sh * 0.55, x + sh, y + d + h + sh * 0.55, x, y + d + h]).fill(SHADOW);
  g.rect(x, y + d, w, h).fill(wall);
  g.rect(x, y, w, d).fill(roof);
  g.moveTo(x, y + d).lineTo(x, y).lineTo(x + w, y).stroke({ width: 0.7, color: edgeHi });
  g.moveTo(x + w, y).lineTo(x + w, y + d).stroke({ width: 0.7, color: edgeLo });
  g.rect(x + 1.2, y + 1.2, w - 2.4, d - 2.4).stroke({ width: 0.35, color: edgeLo, alpha: 0.8 });
}

function hvac(g: Graphics, x: number, y: number, w = 5, d = 3.5): void {
  g.rect(x + 0.8, y + 0.8, w, d).fill({ color: 0x000000, alpha: 0.35 });
  g.rect(x, y, w, d).fill(0x3b4a44);
  g.circle(x + w * 0.3, y + d / 2, d * 0.32).fill(0x26302c);
  g.circle(x + w * 0.72, y + d / 2, d * 0.32).fill(0x26302c);
}

function text(labels: Container, value: string, x: number, y: number, size: number, fill: number, rotation = 0): void {
  const t = new Text({ text: value, style: { fontFamily: 'JetBrains Mono, monospace', fontSize: size, fontWeight: '700', fill, align: 'center', lineHeight: size * 1.1 } });
  t.resolution = 6;
  t.anchor.set(0.5);
  t.position.set(x, y);
  t.rotation = rotation;
  labels.addChild(t);
}

function drawRunway(g: Graphics, s: Structure & { kind: 'runway' }, labels: Container, name: RunwayName): void {
  const x = s.x * T;
  const y = s.y * T;
  const w = s.w * T;
  const h = s.h * T;
  const vertical = h > w;
  if (s.surface === 'grass') {
    drawGrassStrip(g, x, y, w, h, vertical, labels, name);
    return;
  }
  g.rect(x - 0.5, y - 0.5, w + 1, h + 1).fill(COLOURS.asphaltEdge);
  g.rect(x, y, w, h).fill(COLOURS.asphalt);
  const len = vertical ? h : w;
  const wid = vertical ? w : h;
  // Rectangles and points given along/across offsets from the Runway's start corner.
  const r = (along: number, across: number, l: number, a: number, color: number = COLOURS.marking) =>
    (vertical ? g.rect(x + across, y + along, a, l) : g.rect(x + along, y + across, l, a)).fill(color);
  const dot = (along: number, across: number, radius: number, color: number) =>
    (vertical ? g.circle(x + across, y + along, radius) : g.circle(x + along, y + across, radius)).fill(color);
  // centre line, threshold bars, aiming points, side stripes
  for (let d = 22; d < len - 22; d += 13) r(d, wid / 2 - 0.4, 7.5, 0.8);
  for (let k = 0; k < 8; k++) {
    const across = 2 + k * ((wid - 4) / 8);
    r(1.5, across, 7, 1.4);
    r(len - 8.5, across, 7, 1.4);
  }
  const aim = Math.min(48, len * 0.2);
  for (const along of [aim, len - aim - 9]) {
    r(along, wid * 0.22, 9, 2.2);
    r(along, wid * 0.78 - 2.2, 9, 2.2);
  }
  r(0, 0.5, len, 0.4);
  r(0, wid - 0.9, len, 0.4);
  // designators (e.g. 09L / 27R) read from each landing direction
  const { forward: a, reverse: b } = name;
  const rot = vertical ? 0 : Math.PI / 2;
  const at = (along: number) => (vertical ? [x + wid / 2, y + along] : [x + along, y + wid / 2]) as [number, number];
  // the number, with a parallel Runway's letter (L / C / R) under it, nearer the threshold
  const paint = (name: string) => (name.length > 2 ? `${name.slice(0, 2)}\n${name.slice(2)}` : name);
  // upright for the pilot on approach: the top of the digits points the way the aircraft lands
  text(labels, paint(a), ...at(14), 5, COLOURS.marking, vertical ? Math.PI : rot);
  text(labels, paint(b), ...at(len - 14), 5, COLOURS.marking, vertical ? 0 : -rot);
  // white edge and green threshold lights once the Runway is Lit; approach lights only with an ILS
  if (s.surface !== 'lit' && s.surface !== 'ils') return;
  for (let d = 4; d < len; d += 8) {
    dot(d, -0.6, 0.45, COLOURS.edgeWhite);
    dot(d, wid + 0.6, 0.45, COLOURS.edgeWhite);
  }
  for (let c = 1.5; c < wid; c += 2.5) {
    dot(-0.6, c, 0.45, COLOURS.thresholdGreen);
    dot(len + 0.6, c, 0.45, COLOURS.thresholdGreen);
  }
  if (s.surface !== 'ils') return;
  for (let k = 1; k <= 5; k++) {
    dot(-3 - k * 3, wid / 2, 0.5, COLOURS.edgeWhite);
    dot(len + 3 + k * 3, wid / 2, 0.5, COLOURS.edgeWhite);
  }
}

/**
 * A Grass strip: mown grass, not paving — lighter green with mowing bands across it, white boundary markers along
 * both edges, a row of markers at each threshold, no centre line, no lights. The designators are painted small.
 */
function drawGrassStrip(g: Graphics, x: number, y: number, w: number, h: number, vertical: boolean, labels: Container, name: RunwayName): void {
  const len = vertical ? h : w;
  const wid = vertical ? w : h;
  const r = (along: number, across: number, l: number, a: number, color: number, alpha = 1) =>
    (vertical ? g.rect(x + across, y + along, a, l) : g.rect(x + along, y + across, l, a)).fill({ color, alpha });
  r(0, 0, len, wid, 0x2f5a2c);
  for (let d = 0; d < len; d += 12) r(d, 0, 6, wid, 0x3a6a35, 0.9); // mowing bands
  for (let d = 4; d < len - 2; d += 16) {
    r(d, 0.3, 2.4, 1, 0xf2f2ea);
    r(d, wid - 1.3, 2.4, 1, 0xf2f2ea);
  }
  for (let c = 2; c < wid - 1; c += 6) {
    r(2, c, 1.2, 2, 0xf2f2ea);
    r(len - 3.2, c, 1.2, 2, 0xf2f2ea);
  }
  const rot = vertical ? 0 : Math.PI / 2;
  const at = (along: number) => (vertical ? [x + wid / 2, y + along] : [x + along, y + wid / 2]) as [number, number];
  text(labels, name.forward, ...at(12), 4, 0xf2f2ea, vertical ? Math.PI : rot);
  text(labels, name.reverse, ...at(len - 12), 4, 0xf2f2ea, vertical ? 0 : -rot);
}

/**
 * Maps points given in a Stand's own frame — `u` across its open side, `v` from the back (building side, 0) to the
 * open side (depth) — onto the map, so every marking is drawn once and turns with the Stand's facing.
 */
function spotFrame(s: TileRect & { facing?: Facing }) {
  const x = s.x * T;
  const y = s.y * T;
  const w = s.w * T;
  const h = s.h * T;
  const facing = s.facing ?? 'south';
  const across = facing === 'south' || facing === 'north' ? w : h;
  const depth = facing === 'south' || facing === 'north' ? h : w;
  const p = (u: number, v: number): [number, number] => {
    switch (facing) {
      case 'north': return [x + w - u, y + h - v];
      case 'east': return [x + v, y + u];
      case 'west': return [x + w - v, y + u];
      default: return [x + u, y + v];
    }
  };
  const rect = (g: Graphics, u: number, v: number, du: number, dv: number) => {
    const [ax, ay] = p(u, v);
    const [bx, by] = p(u + du, v + dv);
    return g.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
  };
  return { across, depth, p, rect };
}

/** Lead-in line from the taxilane in front, curving in from both directions, with the yellow stop bar. */
function leadIn(g: Graphics, f: ReturnType<typeof spotFrame>, stopAt: number): void {
  const { p } = f;
  const c = f.across / 2;
  const lane = f.depth + 1.5 * T;
  const line = { width: 0.6, color: COLOURS.taxiLine, cap: 'round' } as const;
  g.moveTo(...p(c, stopAt)).lineTo(...p(c, lane - 6)).stroke(line);
  for (const side of [-6, 6]) g.moveTo(...p(c + side, lane)).quadraticCurveTo(...p(c, lane), ...p(c, lane - 6)).stroke(line);
  g.moveTo(...p(c - 3.5, stopAt)).lineTo(...p(c + 3.5, stopAt)).stroke({ width: 0.9, color: COLOURS.taxiLine });
}

/**
 * Small id (a Stand number or B1, B2…) inside a spot: at the open side, in the corner left of the lead-in line, so it
 * clears the lead-in line and stop bar (which sit on the centre line and at the back) and the jet bridge (back right).
 */
function spotNumber(labels: Container, f: ReturnType<typeof spotFrame>, id: string): void {
  const size = 2.8;
  const num = new Text({ text: id, style: { fontFamily: 'JetBrains Mono, monospace', fontSize: size, fontWeight: '700', fill: COLOURS.taxiLine } });
  num.resolution = 6;
  const width = 1.75 * id.length;
  const u = Math.max(1.6, Math.min(2, f.across / 2 - 0.8 - width)); // keep clear of the lead-in line
  const v = f.depth - 1.4 - size;
  const [ax, ay] = f.p(u, v);
  const [bx, by] = f.p(u + width, v + size);
  num.position.set(Math.min(ax, bx), Math.min(ay, by));
  labels.addChild(num);
}

function drawStand(g: Graphics, s: Structure & { kind: 'stand' }, labels: Container, layout: AirportLayout): void {
  const f = spotFrame(s);
  g.rect(s.x * T, s.y * T, s.w * T, s.h * T).fill(COLOURS.asphalt);
  // dashed outline (footprint minus clearance)
  const dash = (u0: number, v0: number, u1: number, v1: number) => {
    const len = Math.hypot(u1 - u0, v1 - v0);
    for (let q = 0; q < len; q += 2.2) {
      const t0 = q / len;
      const t1 = Math.min(1, (q + 1.2) / len);
      g.moveTo(...f.p(u0 + (u1 - u0) * t0, v0 + (v1 - v0) * t0)).lineTo(...f.p(u0 + (u1 - u0) * t1, v0 + (v1 - v0) * t1));
    }
  };
  const [ou, ov, ow, oh] = [1.5, 1, f.across - 3, f.depth - 2];
  dash(ou, ov, ou + ow, ov);
  dash(ou + ow, ov, ou + ow, ov + oh);
  dash(ou, ov + oh, ou + ow, ov + oh);
  dash(ou, ov, ou, ov + oh);
  g.stroke({ width: 0.35, color: COLOURS.standOutline, alpha: 0.85 });
  leadIn(g, f, 3);
  spotNumber(labels, f, s.id);
  // jet bridge from the Terminal for Contact Stands
  if (s.placement === 'contact' && layout.structures.some((b) => b.kind === 'terminal' && sharesEdge(b, s))) {
    const c = f.across / 2;
    f.rect(g, c + 2.2, -0.5, 1.8, 5).fill(0x3a4943).stroke({ width: 0.3, color: 0x141a17 });
    f.rect(g, c + 1.6, 4, 3, 1.6).fill(0x4a5a54);
  }
}

function drawHoldingBay(g: Graphics, s: Structure & { kind: 'holdingBay' }, labels: Container): void {
  const f = spotFrame(s);
  g.rect(s.x * T, s.y * T, s.w * T, s.h * T).fill(COLOURS.asphalt);
  f.rect(g, 1, 1, f.across - 2, f.depth - 2).stroke({ width: 0.4, color: COLOURS.taxiLine });
  leadIn(g, f, 4);
  spotNumber(labels, f, s.id);
}

function drawStructure(g: Graphics, s: Structure, labels: Container, layout: AirportLayout): void {
  const x = s.x * T;
  const y = s.y * T;
  const w = s.w * T;
  const h = s.h * T;
  switch (s.kind) {
    case 'runway':
      drawRunway(g, s, labels, runwayNames(layout)[layout.runways.indexOf(s)] ?? { forward: '09', reverse: '27' });
      break;
    case 'taxiway':
      break; // drawn all together by drawTaxiways
    case 'terminal': {
      const wall = 6;
      const d = h - wall;
      box(g, x, y, w, d, wall, COLOURS.terminalRoof, 0x132422);
      const panels = Math.max(1, Math.round(w / 30));
      for (let k = 0; k < panels; k++) g.rect(x + 3 + (k * (w - 6)) / panels, y + 3, (w - 6) / panels - 1.5, d - 6).fill(k % 2 ? 0x2e3a35 : 0x28332f);
      g.rect(x + 6, y + d / 2 - 1.4, w - 12, 2.8).fill(0x24504b);
      for (let xx = x + 8; xx < x + w - 8; xx += 4) g.rect(xx, y + d / 2 - 1.4, 0.3, 2.8).fill(0x1a2e2b);
      for (const hx of [x + 6, x + w - 12]) if (w > 30) hvac(g, hx, y + 3.5, 4.5, 3);
      // glass curtain wall with mullions
      g.rect(x, y + d, w, wall).fill(0x1c4440);
      g.rect(x, y + d + 1, w, 1.4).fill({ color: 0x3f8a82, alpha: 0.6 });
      for (let xx = x; xx < x + w; xx += 3) g.rect(xx, y + d, 0.3, wall).fill(0x0f2422);
      if (w >= 40) labels.addChild(label('TERMINAL', x + w / 2, y + d / 2 + 2));
      break;
    }
    case 'cargoHub': {
      const wall = 6;
      const d = h - wall;
      box(g, x, y, w, d, wall, COLOURS.cargoRoof, 0x1a1613, 0x4a3f36, 0x120f0d);
      for (let xx = x + 2; xx < x + w - 1; xx += 3) g.rect(xx, y + 1.5, 1.4, d - 3).fill(0x3a312a);
      for (let vx = x + 12; vx < x + w - 6; vx += 20) g.circle(vx, y + d / 2, 1.4).fill(0x22201d);
      for (let k = 0; x + 4 + k * 12.5 + 8 <= x + w; k++) {
        g.rect(x + 4 + k * 12.5, y + d + 1, 8, wall - 1).fill(0x2a2420);
        g.rect(x + 4 + k * 12.5, y + d + 1, 8, 0.8).fill(COLOURS.taxiLine);
      }
      if (w >= 30) labels.addChild(label('CARGO', x + w / 2, y + d / 2 + 2));
      break;
    }
    case 'stand':
      drawStand(g, s, labels, layout);
      break;
    case 'holdingBay':
      drawHoldingBay(g, s, labels);
      break;
    case 'supportBuilding': {
      const name = {
        rampAgentStation: 'RAMP', adminOffice: 'ADMIN', airlineOffice: 'AIRLINE', fireRescueStation: 'FIRE & RESCUE', fuelFarm: 'FUEL', deIcingPad: 'DE-ICING',
      }[s.role];
      if (s.role === 'fireRescueStation') {
        // red roof with a cross, open bays and two fire trucks on the apron in front
        box(g, x, y, w, h - 9, 3, 0x3d1d1a, 0x1b1513, 0x5e2a25, 0x140c0b);
        g.rect(x + w - 7, y + 1.5, 4.5, 3.5).stroke({ width: 0.5, color: 0xe8d7d4 });
        g.moveTo(x + w - 4.75, y + 2).lineTo(x + w - 4.75, y + 4.6).moveTo(x + w - 6.4, y + 3.25).lineTo(x + w - 3.1, y + 3.25).stroke({ width: 0.5, color: 0xe8d7d4 });
        for (let k = 0; k < 3; k++) g.rect(x + 1.5 + k * 7, y + h - 9 + 3.2, 5.5, 2.4).fill(0x0d0f0e);
        for (const dx of [2, 11]) {
          g.roundRect(x + dx + 0.5, y + h - 5.4, 5, 4.6, 0.6).fill(SHADOW);
          g.roundRect(x + dx, y + h - 6, 5, 4.6, 0.6).fill(0xc0392b);
          g.rect(x + dx + 0.6, y + h - 5.6, 3.8, 1).fill(0x2b3732);
          g.rect(x + dx + 1, y + h - 4.2, 3, 0.5).fill(COLOURS.edgeLight);
        }
      } else if (s.role === 'fuelFarm') {
        g.rect(x, y, w, h).fill(0x1d2420).stroke({ width: 0.4, color: COLOURS.fence });
        for (const [cx, cy] of [[x + 5, y + 5], [x + 12, y + 5], [x + 19, y + 5], [x + 8.5, y + 11.5], [x + 15.5, y + 11.5]] as const) {
          g.circle(cx + 1, cy + 1, 3).fill(SHADOW);
          g.circle(cx, cy, 3).fill(0xc9ced0);
          g.circle(cx, cy, 2).stroke({ width: 0.3, color: 0x8a9496 });
        }
      } else if (s.role === 'deIcingPad') {
        g.rect(x, y, w, h).fill(COLOURS.asphalt);
        g.rect(x + 1, y + 1, w - 2, h - 2).stroke({ width: 0.5, color: 0x7fc4ff });
        g.rect(x + 2, y + h / 2 - 2, 3, 4).fill(0x2f6f9f);
        g.rect(x + w - 5, y + h / 2 - 2, 3, 4).fill(0x2f6f9f);
      } else {
        box(g, x, y, w, h - 4, 4, COLOURS.roof, COLOURS.wall);
        hvac(g, x + 2, y + 2, 4, 2.6);
      }
      labels.addChild(label(name, x + w / 2, y - 1));
      break;
    }
    case 'atcTower':
      drawTower(g, s, labels);
      break;
  }
}

/** Deterministic 0…1 noise per tile (so the paving looks the same every time it is drawn). */
const noise = (x: number, y: number, salt = 0) => {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * Taxiways as one paved surface, like the Runway: a darker edge round the outside, concrete slabs with joints,
 * weathered patches and rubber on the centre line, and paved shoulders with a faint edge line along the outer sides.
 * A Taxiway is 3 tiles wide in the game, but along a side that faces open ground the paving is drawn half a tile in
 * (TAXIWAY_INSET), so a plain Taxiway looks 2 tiles wide, half a Runway; sides that meet Stands, Holding Bays, Runways
 * or other Taxiways are paved right up to them.
 */
function drawTaxiways(g: Graphics, layout: AirportLayout): void {
  const strips = layout.structures.filter((s) => s.kind === 'taxiway');
  const paved = new Set<string>();
  for (const s of strips) for (let x = s.x; x < s.x + s.w; x++) for (let y = s.y; y < s.y + s.h; y++) paved.add(`${x},${y}`);
  const others = new Set<string>();
  for (const s of layout.structures) {
    if (s.kind === 'runway' || s.kind === 'stand' || s.kind === 'holdingBay') for (let x = s.x; x < s.x + s.w; x++) for (let y = s.y; y < s.y + s.h; y++) others.add(`${x},${y}`);
  }
  const open = (tx: number, ty: number) => !paved.has(`${tx},${ty}`) && !others.has(`${tx},${ty}`);
  /** The paved part of a tile: inset on its sides that face open ground. */
  const pavedRect = (tx: number, ty: number) => {
    const l = open(tx - 1, ty) ? TAXIWAY_INSET * T : 0;
    const r = open(tx + 1, ty) ? TAXIWAY_INSET * T : 0;
    const t = open(tx, ty - 1) ? TAXIWAY_INSET * T : 0;
    const b = open(tx, ty + 1) ? TAXIWAY_INSET * T : 0;
    return { x: tx * T + l, y: ty * T + t, w: T - l - r, h: T - t - b };
  };
  const tiles = [...paved].map((k) => k.split(',').map(Number) as [number, number]);
  const isPaved = (tx: number, ty: number) => paved.has(`${tx},${ty}`) || others.has(`${tx},${ty}`);
  const I = TAXIWAY_INSET * T;
  const ROUND = 4; // outer corners of turns and ends: the whole drawn corner square
  const FILLET = T; // inner corners of junctions and turns
  /**
   * The outline of a tile's paving, clockwise: inset from open ground, with a corner square cut away where the tile
   * sits at an inside corner (both neighbours paved, the diagonal open: the neighbours are inset there), and rounded
   * where two open sides meet (an outside corner).
   */
  const outline = (tx: number, ty: number) => {
    const p = pavedRect(tx, ty);
    const pts: Array<{ x: number; y: number; round?: number }> = [];
    const add = (cx: number, cy: number, dx: -1 | 1, dy: -1 | 1) => {
      const sideX = open(tx + dx, ty);
      const sideY = open(tx, ty + dy);
      if (sideX && sideY) {
        pts.push({ x: cx, y: cy, round: Math.min(ROUND, p.w, p.h) });
      } else if (!sideX && !sideY && open(tx + dx, ty + dy)) {
        // a notch I × I: walking clockwise, along the side before the corner, in, then out to the next side
        const first = dx === dy ? { x: cx, y: cy - dy * I } : { x: cx - dx * I, y: cy };
        const second = dx === dy ? { x: cx - dx * I, y: cy } : { x: cx, y: cy - dy * I };
        pts.push(first, { x: cx - dx * I, y: cy - dy * I }, second);
      } else pts.push({ x: cx, y: cy });
    };
    add(p.x, p.y, -1, -1);
    add(p.x + p.w, p.y, 1, -1);
    add(p.x + p.w, p.y + p.h, 1, 1);
    add(p.x, p.y + p.h, -1, 1);
    return pts;
  };
  const trace = (pts: ReadonlyArray<{ x: number; y: number; round?: number }>) => {
    const n = pts.length;
    const first = pts[0]!;
    const last = pts[n - 1]!;
    g.moveTo((first.x + last.x) / 2, (first.y + last.y) / 2);
    for (let i = 0; i < n; i++) {
      const c = pts[i]!;
      const next = pts[(i + 1) % n]!;
      if (c.round) g.arcTo(c.x, c.y, (c.x + next.x) / 2, (c.y + next.y) / 2, c.round);
      else g.lineTo(c.x, c.y);
    }
    g.closePath();
  };
  // a dark edge round the paving, then the paving over it
  for (const [tx, ty] of tiles) {
    trace(outline(tx, ty));
    g.stroke({ width: 1.2, color: COLOURS.asphaltEdge });
  }
  for (const [tx, ty] of tiles) {
    trace(outline(tx, ty));
    g.fill(COLOURS.asphalt);
  }
  for (const [tx, ty] of tiles) {
    const { x: px, y: py, w: pw, h: ph } = pavedRect(tx, ty);
    // slab tone varies a little; some slabs are patched
    const n = noise(tx, ty);
    trace(outline(tx, ty));
    g.fill({ color: n > 0.5 ? 0x232a2e : 0x12171a, alpha: Math.abs(n - 0.5) * 0.5 });
    if (noise(tx, ty, 1) > 0.88) g.rect(px + 1 + noise(tx, ty, 2) * (pw - 4), py + 1 + noise(tx, ty, 3) * (ph - 4), 2.5, 2).fill({ color: 0x0e1214, alpha: 0.5 });
    for (let i = 0; i < 3; i++) g.circle(px + noise(tx, ty, 10 + i) * pw, py + noise(tx, ty, 20 + i) * ph, 0.25).fill({ color: 0x2c3438, alpha: 0.7 });
    // slab joints on the tile grid
    g.moveTo(px, py).lineTo(px + pw, py).moveTo(px, py).lineTo(px, py + ph).stroke({ width: 0.18, color: 0x0b0f11, alpha: 0.7 });
    // shoulder and edge line on sides that face open ground (at the edge of the drawn paving)
    const shoulder = 1.2;
    const edgeLine = { width: 0.3, color: COLOURS.taxiLine, alpha: 0.35 };
    const shoulderFill = { color: 0x252c30, alpha: 0.8 };
    const N = open(tx, ty - 1);
    const S = open(tx, ty + 1);
    const W = open(tx - 1, ty);
    const E = open(tx + 1, ty);
    // at a rounded outside corner the straight shoulders stop short and an arc joins them
    const R = Math.min(ROUND, pw, ph);
    const nw = N && W ? R : 0;
    const ne = N && E ? R : 0;
    const sw = S && W ? R : 0;
    const se = S && E ? R : 0;
    if (N) { g.rect(px + nw, py, pw - nw - ne, shoulder).fill(shoulderFill); g.moveTo(px + nw, py + shoulder).lineTo(px + pw - ne, py + shoulder).stroke(edgeLine); }
    if (S) { g.rect(px + sw, py + ph - shoulder, pw - sw - se, shoulder).fill(shoulderFill); g.moveTo(px + sw, py + ph - shoulder).lineTo(px + pw - se, py + ph - shoulder).stroke(edgeLine); }
    if (W) { g.rect(px, py + nw, shoulder, ph - nw - sw).fill(shoulderFill); g.moveTo(px + shoulder, py + nw).lineTo(px + shoulder, py + ph - sw).stroke(edgeLine); }
    if (E) { g.rect(px + pw - shoulder, py + ne, shoulder, ph - ne - se).fill(shoulderFill); g.moveTo(px + pw - shoulder, py + ne).lineTo(px + pw - shoulder, py + ph - se).stroke(edgeLine); }
    const cornerArc = (cx: number, cy: number, from: number) => {
      g.arc(cx, cy, R - shoulder / 2, from, from + Math.PI / 2).stroke({ width: shoulder, color: shoulderFill.color, alpha: shoulderFill.alpha });
      g.arc(cx, cy, R - shoulder, from, from + Math.PI / 2).stroke(edgeLine);
    };
    if (nw) cornerArc(px + R, py + R, Math.PI);
    if (ne) cornerArc(px + pw - R, py + R, -Math.PI / 2);
    if (se) cornerArc(px + pw - R, py + ph - R, 0);
    if (sw) cornerArc(px + R, py + ph - R, Math.PI / 2);
  }
  // fillets (over the shoulders of the edges they join): a curved apron of paving in every inside corner, tangent to both edges
  for (const [tx, ty] of tiles) {
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      if (open(tx + dx, ty) || open(tx, ty + dy) || !open(tx + dx, ty + dy)) continue;
      if (!isPaved(tx + dx, ty) || !isPaved(tx, ty + dy)) continue;
      // the inner corner point, where the two neighbours' inset edges meet
      const cx = (dx > 0 ? (tx + 1) * T : tx * T) - dx * I;
      const cy = (dy > 0 ? (ty + 1) * T : ty * T) - dy * I;
      const ax = cx + dx * FILLET;
      const by = cy + dy * FILLET;
      g.moveTo(ax, cy).lineTo(cx, cy).lineTo(cx, by).quadraticCurveTo(cx, cy, ax, cy).fill(COLOURS.asphalt);
      g.moveTo(ax, cy).quadraticCurveTo(cx, cy, cx, by).stroke({ width: 0.3, color: COLOURS.taxiLine, alpha: 0.25 });
    }
  }
  // tyre rubber along the centre line
  for (const k of centreLine(layout)) {
    const [tx, ty] = k.split(',').map(Number) as [number, number];
    g.rect(tx * T + 1.5, ty * T + 1.5, T - 3, T - 3).fill({ color: 0x0c1012, alpha: 0.35 });
  }
}

/**
 * The ATC Tower in the same oblique 3D as the other buildings: a base building, a tapered concrete shaft lit from the
 * west, a catwalk, the glass cab with mullions under an overhanging roof, a radar dome and a mast with a red light.
 */
function drawTower(g: Graphics, s: Structure, labels: Container): void {
  const x = s.x * T;
  const y = s.y * T;
  const w = s.w * T;
  const h = s.h * T;
  const cx = x + w / 2;
  const base = y + h - 2; // foot of the shaft
  const top = y + 6; // cab roof centre
  // long shadow of the shaft and cab towards the south-east
  g.poly([cx - 3, base, cx + 3, base - 2, cx + 30, base + 11, cx + 33, base + 17, cx + 26, base + 18, cx - 2, base + 4]).fill(SHADOW);
  box(g, x - 2, base - 6, w + 4, 6, 3, COLOURS.terminalRoof, COLOURS.wall);
  // tapered shaft: light west face, dark east face, ring joints and a window slit
  const shaftTop = top + 9;
  const bw = 3.6;
  const tw = 2.6;
  g.poly([cx - bw, base - 3, cx, base - 3, cx, shaftTop, cx - tw, shaftTop]).fill(0x4a5a54);
  g.poly([cx, base - 3, cx + bw, base - 3, cx + tw, shaftTop, cx, shaftTop]).fill(0x26302c);
  for (let yy = shaftTop + 4; yy < base - 4; yy += 4) {
    const k = (yy - shaftTop) / (base - 3 - shaftTop);
    const half = tw + (bw - tw) * k;
    g.moveTo(cx - half, yy).lineTo(cx + half, yy).stroke({ width: 0.25, color: 0x161d1a, alpha: 0.8 });
  }
  g.rect(cx - 0.45, shaftTop + 2, 0.9, base - shaftTop - 8).fill({ color: COLOURS.glassHi, alpha: 0.45 });
  // octagon helper around (cx, cy) with radius r, squashed vertically for the oblique view
  const oct = (cy: number, r: number) => [-0.38, -0.92, 0.38, -0.92, 0.92, -0.38, 0.92, 0.38, 0.38, 0.92, -0.38, 0.92, -0.92, 0.38, -0.92, -0.38]
    .map((v, i) => (i % 2 === 0 ? cx + v * r : cy + v * r * 0.6));
  // catwalk below the cab
  g.poly(oct(shaftTop, 7.6)).fill(0x1b2320).stroke({ width: 0.35, color: 0x6f7f79 });
  // glass cab: a band of tilted windows between the catwalk and the roof
  const cabTop = top + 1.5;
  const r = 6.2;
  g.poly([cx - r * 0.92, cabTop, cx + r * 0.92, cabTop, cx + r * 0.92, shaftTop - 1, cx - r * 0.92, shaftTop - 1]).fill(0x1f5752);
  g.poly(oct(shaftTop - 1, r)).fill(0x1f5752);
  g.rect(cx - r * 0.92, cabTop, r * 0.9, shaftTop - 1 - cabTop).fill({ color: COLOURS.glassHi, alpha: 0.35 }); // lit west half
  for (let k = -3; k <= 3; k++) g.moveTo(cx + k * r * 0.28, cabTop).lineTo(cx + k * r * 0.3, shaftTop - 0.6).stroke({ width: 0.3, color: 0x0d1f1d });
  g.moveTo(cx - r * 0.92, cabTop + 1.4).lineTo(cx + r * 0.92, cabTop + 1.4).stroke({ width: 0.25, color: 0x8fd6cd, alpha: 0.5 });
  // overhanging roof with an edge highlight
  g.poly(oct(top, 7.4)).fill(COLOURS.roofEdge);
  g.poly(oct(top - 0.6, 6.4)).fill(COLOURS.roof).stroke({ width: 0.3, color: 0x4a5a54 });
  // radar dome, mast and obstruction light
  g.circle(cx - 2.2, top - 1.2, 1.5).fill(0xd6dedb).stroke({ width: 0.25, color: 0x8a9a95 });
  g.rect(cx + 1.6, top - 9, 0.7, 8).fill(0x8a9a95);
  g.rect(cx + 0.6, top - 6.5, 2.7, 0.35).fill(0x8a9a95);
  g.circle(cx + 1.95, top - 9.2, 0.8).fill(0xff5a4a);
  labels.addChild(label('TWR', cx, y + h + 6));
}

/** Perimeter fence round everything built (plus a margin), with trees only outside it. */
function drawSurroundings(g: Graphics, layout: AirportLayout): void {
  const X0 = WORLD.x0 * T;
  const Y0 = WORLD.y0 * T;
  const W = WORLD.width * T;
  const H = WORLD.height * T;
  // mottled grass
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 220; k++) g.circle(X0 + rnd() * W, Y0 + rnd() * H, 6 + rnd() * 14).fill({ color: k % 2 ? COLOURS.grass2 : COLOURS.grass3, alpha: 0.6 });
  const xs = layout.structures.flatMap((s) => [s.x, s.x + s.w]);
  const ys = layout.structures.flatMap((s) => [s.y, s.y + s.h]);
  const fx = (Math.min(...xs) - 1.5) * T;
  const fy = (Math.min(...ys) - 1.5) * T;
  const fx1 = (Math.max(...xs) + 1.5) * T;
  const fy1 = (Math.max(...ys) + 1.5) * T;
  for (let k = 0; k < 420; k++) {
    const tx = X0 + rnd() * W;
    const ty = Y0 + rnd() * H;
    const r = 2.5 + rnd() * 2.5;
    if (tx > fx - r - 2 && tx < fx1 + r + 2 && ty > fy - r - 2 && ty < fy1 + r + 2) continue;
    g.circle(tx + 1.2, ty + 1.2, r).fill(SHADOW);
    g.circle(tx, ty, r).fill(COLOURS.tree);
    g.circle(tx - r * 0.3, ty - r * 0.3, r * 0.55).fill(COLOURS.treeHi);
  }
  g.rect(fx, fy, fx1 - fx, fy1 - fy).stroke({ width: 0.5, color: COLOURS.fence });
  for (let px = fx; px <= fx1; px += 6) g.circle(px, fy, 0.35).circle(px, fy1, 0.35).fill(COLOURS.fence);
  for (let py = fy; py <= fy1; py += 6) g.circle(fx, py, 0.35).circle(fx1, py, 0.35).fill(COLOURS.fence);
}

/** Centre lines, hold-short lines with "09-27" signs, and blue edge lights. */
function drawTaxiMarkings(g: Graphics, layout: AirportLayout, labels: Container): void {
  drawCentreLines(g, layout, COLOURS.taxiLine);
  for (const h of holdShortLines(layout)) {
    const across = h.side === 'north' || h.side === 'south';
    // two solid lines on the Taxiway side, two dashed on the Runway side
    const towardRunway = h.side === 'north' || h.side === 'west' ? 1 : -1;
    const base = across ? (h.side === 'north' ? h.y * T : (h.y + 1) * T) : h.side === 'west' ? h.x * T : (h.x + 1) * T;
    const offsets = [1.6, 2.6, 4.2, 5.2].map((o) => base + towardRunway * o);
    offsets.forEach((o, i) => {
      const dashed = i >= 2;
      // across the drawn paving only (a connector is drawn inset from open ground on both sides)
      const len = ((across ? h.w : h.h) - 2 * TAXIWAY_INSET) * T;
      const start = ((across ? h.x : h.y) + TAXIWAY_INSET) * T;
      for (let p = 0; p < len; p += dashed ? 2.4 : len) {
        const seg = dashed ? 1.4 : len;
        if (across) g.rect(start + p, o - 0.25, seg, 0.5).fill(COLOURS.taxiLine);
        else g.rect(o - 0.25, start + p, 0.5, seg).fill(COLOURS.taxiLine);
      }
    });
    const sw = 1.6 + h.sign.length * 1.45; // the plate fits "09-27" as well as "09L-27R"
    const sx = across ? h.x * T - sw - 0.5 : (h.side === 'west' ? h.x * T - sw - 0.5 : (h.x + 1) * T + 0.5);
    const sy = across ? (h.side === 'north' ? h.y * T + 1 : h.y * T + 3) : h.y * T - 4;
    g.roundRect(sx, sy, sw, 3.4, 0.4).fill(COLOURS.signRed);
    const text = new Text({ text: h.sign, style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 2.4, fontWeight: '700', fill: COLOURS.signText } });
    text.resolution = 6;
    text.anchor.set(0.5);
    text.position.set(sx + sw / 2, sy + 1.75);
    labels.addChild(text);
  }
  for (const l of taxiwayEdgeLights(layout)) g.circle(l.x * T, l.y * T, 0.45).fill(COLOURS.edgeLight);
}

/** Builds a container drawing the layout in world units (1 tile = TILE_SIZE units). */
export function drawAirfield(layout: AirportLayout): Container {
  const root = new Container();
  const ground = new Graphics();
  ground.rect(WORLD.x0 * T, WORLD.y0 * T, WORLD.width * T, WORLD.height * T).fill(COLOURS.grass);
  drawSurroundings(ground, layout);
  const g = new Graphics();
  const labels = new Container();
  // Paved surfaces first, buildings and markings on top.
  const order: Structure['kind'][] = ['taxiway', 'runway', 'holdingBay', 'stand', 'terminal', 'cargoHub', 'supportBuilding', 'atcTower'];
  for (const kind of order) {
    if (kind === 'taxiway') drawTaxiways(g, layout);
    else for (const s of layout.structures) if (s.kind === kind) drawStructure(g, s, labels, layout);
    if (kind === 'runway') drawTaxiMarkings(g, layout, labels);
  }
  root.addChild(ground, g, labels);
  return root;
}

/** The tiles the airport covers, plus a margin (what the Live Day shows). */
export function airportBounds(layout: AirportLayout, margin = 3): TileRect {
  const xs = layout.structures.flatMap((s) => [s.x, s.x + s.w]);
  const ys = layout.structures.flatMap((s) => [s.y, s.y + s.h]);
  const x = Math.min(...xs) - margin;
  const y = Math.min(...ys) - margin;
  return { x, y, w: Math.max(...xs) + margin - x, h: Math.max(...ys) + margin - y };
}

/** The whole world map (what Build Mode shows). */
export const worldBounds: TileRect = { x: WORLD.x0, y: WORLD.y0, w: WORLD.width, h: WORLD.height };

/** Scales and centres the airfield so the given tile area (default: the airport) fits the screen. */
export function fitToScreen(airfield: Container, layout: AirportLayout, screenW: number, screenH: number, area: TileRect = airportBounds(layout)): void {
  const scale = Math.min(screenW / (area.w * T), screenH / (area.h * T));
  airfield.scale.set(scale);
  airfield.position.set((screenW - area.w * T * scale) / 2 - area.x * T * scale, (screenH - area.h * T * scale) / 2 - area.y * T * scale);
}
