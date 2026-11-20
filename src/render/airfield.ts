import { Container, Graphics, Text } from 'pixi.js';
import { TILE_SIZE, WORLD, type AirportLayout, type Structure, type TileRect } from '../sim/layout';
import { holdShortLines, taxiwayEdgeLights } from '../sim/markings';
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
  const t = new Text({ text: value, style: { fontFamily: 'JetBrains Mono, monospace', fontSize: size, fontWeight: '700', fill } });
  t.resolution = 6;
  t.anchor.set(0.5);
  t.position.set(x, y);
  t.rotation = rotation;
  labels.addChild(t);
}

function drawRunway(g: Graphics, s: Structure & { kind: 'runway' }, labels: Container): void {
  const x = s.x * T;
  const y = s.y * T;
  const w = s.w * T;
  const h = s.h * T;
  g.rect(x - 0.5, y - 0.5, w + 1, h + 1).fill(COLOURS.asphaltEdge);
  g.rect(x, y, w, h).fill(COLOURS.asphalt);
  const vertical = h > w;
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
  // designators: '09'/'27' (or '18'/'36') read from each landing direction
  const [a, b] = vertical ? ['18', '36'] : ['09', '27'];
  const rot = vertical ? 0 : Math.PI / 2;
  const at = (along: number) => (vertical ? [x + wid / 2, y + along] : [x + along, y + wid / 2]) as [number, number];
  text(labels, a!, ...at(14), 5, COLOURS.marking, vertical ? 0 : -rot);
  text(labels, b!, ...at(len - 14), 5, COLOURS.marking, vertical ? Math.PI : rot);
  // white edge lights, green threshold lights, approach lights
  for (let d = 4; d < len; d += 8) {
    dot(d, -0.6, 0.45, COLOURS.edgeWhite);
    dot(d, wid + 0.6, 0.45, COLOURS.edgeWhite);
  }
  for (let c = 1.5; c < wid; c += 2.5) {
    dot(-0.6, c, 0.45, COLOURS.thresholdGreen);
    dot(len + 0.6, c, 0.45, COLOURS.thresholdGreen);
  }
  for (let k = 1; k <= 5; k++) {
    dot(-3 - k * 3, wid / 2, 0.5, COLOURS.edgeWhite);
    dot(len + 3 + k * 3, wid / 2, 0.5, COLOURS.edgeWhite);
  }
}

function drawStand(g: Graphics, s: Structure & { kind: 'stand' }, labels: Container, layout: AirportLayout): void {
  const x = s.x * T;
  const y = s.y * T;
  const w = s.w * T;
  const h = s.h * T;
  const cx = x + w / 2;
  g.rect(x, y, w, h).fill(COLOURS.asphalt);
  // dashed outline (footprint minus clearance)
  const ox = x + 1.5;
  const oy = y + 1;
  const ow = w - 3;
  const oh = h - 2;
  const dash = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let p = 0; p < len; p += 2.2) {
      const t0 = p / len;
      const t1 = Math.min(1, (p + 1.2) / len);
      g.moveTo(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0).lineTo(x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1);
    }
  };
  dash(ox, oy, ox + ow, oy);
  dash(ox + ow, oy, ox + ow, oy + oh);
  dash(ox, oy + oh, ox + ow, oy + oh);
  dash(ox, oy, ox, oy + oh);
  g.stroke({ width: 0.35, color: COLOURS.standOutline, alpha: 0.85 });
  // lead-in line from the taxilane with curves both ways, and the stop bar (the yellow T)
  const lane = y + h + 1.5 * T;
  g.moveTo(cx, y + 3).lineTo(cx, lane - 6).stroke({ width: 0.6, color: COLOURS.taxiLine, cap: 'round' });
  g.moveTo(cx - 6, lane).quadraticCurveTo(cx, lane, cx, lane - 6).stroke({ width: 0.6, color: COLOURS.taxiLine, cap: 'round' });
  g.moveTo(cx + 6, lane).quadraticCurveTo(cx, lane, cx, lane - 6).stroke({ width: 0.6, color: COLOURS.taxiLine, cap: 'round' });
  g.moveTo(cx - 3.5, y + 3).lineTo(cx + 3.5, y + 3).stroke({ width: 0.9, color: COLOURS.taxiLine });
  // number inside the outline, in the corner away from the taxilane
  const num = new Text({ text: s.id, style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 3.2, fontWeight: '700', fill: COLOURS.taxiLine } });
  num.resolution = 6;
  num.position.set(ox + 0.8, oy + 0.6);
  labels.addChild(num);
  // jet bridge from the building for Contact Stands
  if (s.placement === 'contact') {
    const building = layout.structures.find((b) => (b.kind === 'terminal' || b.kind === 'cargoHub') && b.y + b.h === s.y && s.x >= b.x && s.x + s.w <= b.x + b.w);
    if (building?.kind === 'terminal') {
      g.rect(cx + 2.2, y - 0.5, 1.8, 5).fill(0x3a4943).stroke({ width: 0.3, color: 0x141a17 });
      g.rect(cx + 1.6, y + 4, 3, 1.6).fill(0x4a5a54);
    }
  }
}

function drawStructure(g: Graphics, s: Structure, labels: Container, layout: AirportLayout): void {
  const x = s.x * T;
  const y = s.y * T;
  const w = s.w * T;
  const h = s.h * T;
  switch (s.kind) {
    case 'runway':
      drawRunway(g, s, labels);
      break;
    case 'taxiway':
      g.rect(x, y, w, h).fill(COLOURS.asphalt);
      break;
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
      if (w >= 60) labels.addChild(label('TERMINAL', x + w / 2, y - 1.5));
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
      if (w >= 40) labels.addChild(label('CARGO', x + w / 2, y - 1.5));
      break;
    }
    case 'stand':
      drawStand(g, s, labels, layout);
      break;
    case 'holdingBay': {
      g.rect(x, y, w, h).fill(COLOURS.asphalt);
      g.rect(x + 1, y + 1, w - 2, h - 2).stroke({ width: 0.4, color: COLOURS.taxiLine });
      g.moveTo(x + w / 2, y + 3).lineTo(x + w / 2, y + h).stroke({ width: 0.6, color: COLOURS.taxiLine });
      labels.addChild(label('BAY', x + w / 2, y - 1));
      break;
    }
    case 'supportBuilding': {
      box(g, x, y, w, h - 4, 4, COLOURS.roof, COLOURS.wall);
      hvac(g, x + 2, y + 2, 4, 2.6);
      const name = { rampAgentStation: 'RAMP', adminOffice: 'ADMIN', airlineOffice: 'AIRLINE' }[s.role];
      labels.addChild(label(name, x + w / 2, y - 1));
      break;
    }
    case 'atcTower': {
      // base building, tall shaft, octagonal glass cab, antenna; (cx, base) = foot of the shaft
      const cx = x + w / 2;
      const base = y + h - 2;
      g.poly([cx + 3, base, cx + 30, base + 12, cx + 30, base + 16, cx - 3, base + 4]).fill(SHADOW);
      box(g, x - 2, base - 6, w + 4, 6, 3, COLOURS.terminalRoof, COLOURS.wall);
      const top = y + 7;
      g.rect(cx - 2.6, top, 5.2, base - top - 4).fill(0x2b3732);
      g.rect(cx - 2.6, top, 1.9, base - top - 4).fill(0x3a4943);
      const oct = (r: number) => [-0.38, -0.92, 0.38, -0.92, 0.92, -0.38, 0.92, 0.38, 0.38, 0.92, -0.38, 0.92, -0.92, 0.38, -0.92, -0.38]
        .map((v, i) => (i % 2 === 0 ? cx + v * r : top + v * r));
      g.poly(oct(7.5)).fill(COLOURS.roofEdge);
      g.poly(oct(5.3)).fill(COLOURS.glass).stroke({ width: 0.4, color: COLOURS.glassHi });
      g.circle(cx, top, 2.6).fill(COLOURS.roof);
      g.rect(cx - 0.4, top - 10, 0.8, 8).fill(0x8a9a95);
      g.circle(cx, top - 10, 0.8).fill(0xff5a4a);
      labels.addChild(label('TWR', cx, y + h + 6));
      break;
    }
  }
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
      const len = (across ? h.w : h.h) * T;
      const start = (across ? h.x : h.y) * T;
      for (let p = 0; p < len; p += dashed ? 2.4 : len) {
        const seg = dashed ? 1.4 : len;
        if (across) g.rect(start + p, o - 0.25, seg, 0.5).fill(COLOURS.taxiLine);
        else g.rect(o - 0.25, start + p, 0.5, seg).fill(COLOURS.taxiLine);
      }
    });
    const sx = across ? h.x * T - 7.5 : (h.side === 'west' ? h.x * T - 7.5 : (h.x + 1) * T + 0.5);
    const sy = across ? (h.side === 'north' ? h.y * T + 1 : h.y * T + 3) : h.y * T - 4;
    g.roundRect(sx, sy, 7, 3.4, 0.4).fill(COLOURS.signRed);
    const text = new Text({ text: h.sign, style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 2.4, fontWeight: '700', fill: COLOURS.signText } });
    text.resolution = 6;
    text.anchor.set(0.5);
    text.position.set(sx + 3.5, sy + 1.75);
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
    for (const s of layout.structures) if (s.kind === kind) drawStructure(g, s, labels, layout);
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
