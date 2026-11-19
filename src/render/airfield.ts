import { Container, Graphics, Text } from 'pixi.js';
import { TILE_SIZE, type AirportLayout, type Structure } from '../sim/layout';
import { holdShortLines, taxiwayEdgeLights } from '../sim/markings';
import { drawCentreLines } from './taxiLines';

/** Colours from the accepted UI baseline (ATC Console, night palette). Full art comes with the art pass. */
const COLOURS = {
  grass: 0x0f1a15,
  asphalt: 0x1a2024,
  asphaltEdge: 0x131819,
  marking: 0xb9c5c7,
  taxiLine: 0xc9a227,
  standOutline: 0xb3392f,
  terminalRoof: 0x2a3531,
  cargoRoof: 0x2f2823,
  wall: 0x151c19,
  glass: 0x2c6f69,
  label: 0x7f9a92,
  edgeLight: 0x4f8cff,
  signRed: 0xb3261e,
  signText: 0xf2f2f2,
} as const;

const T = TILE_SIZE;

function label(text: string, x: number, y: number): Text {
  const t = new Text({
    text,
    style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 5, fontWeight: '700', fill: COLOURS.label, letterSpacing: 0.6 },
  });
  t.anchor.set(0.5, 1);
  t.position.set(x, y);
  t.resolution = 4;
  return t;
}

function drawStructure(g: Graphics, s: Structure, labels: Container): void {
  const x = s.x * T;
  const y = s.y * T;
  const w = s.w * T;
  const h = s.h * T;
  switch (s.kind) {
    case 'runway': {
      g.rect(x, y, w, h).fill(COLOURS.asphalt).stroke({ width: 0.6, color: COLOURS.asphaltEdge });
      const cy = y + h / 2;
      for (let dx = 16; dx < w - 16; dx += 13) g.rect(x + dx, cy - 0.4, 7.5, 0.8).fill(COLOURS.marking);
      for (let k = 0; k < 8; k++) {
        const by = y + 2 + k * ((h - 4) / 8);
        g.rect(x + 2, by, 9, 1.4).fill(COLOURS.marking);
        g.rect(x + w - 11, by, 9, 1.4).fill(COLOURS.marking);
      }
      g.rect(x, y + 0.5, w, 0.4).fill(COLOURS.marking);
      g.rect(x, y + h - 0.9, w, 0.4).fill(COLOURS.marking);
      break;
    }
    case 'taxiway': {
      g.rect(x, y, w, h).fill(COLOURS.asphalt);
      break;
    }
    case 'terminal':
    case 'cargoHub': {
      const roof = s.kind === 'terminal' ? COLOURS.terminalRoof : COLOURS.cargoRoof;
      g.rect(x, y, w, h - 4).fill(roof);
      g.rect(x, y + h - 4, w, 4).fill(s.kind === 'terminal' ? COLOURS.glass : COLOURS.wall);
      labels.addChild(label(s.kind === 'terminal' ? 'TERMINAL' : 'CARGO', x + w / 2, y - 1));
      break;
    }
    case 'stand': {
      g.rect(x, y, w, h).fill(COLOURS.asphalt);
      g.rect(x + 2, y + 1, w - 4, h - 2).stroke({ width: 0.35, color: COLOURS.standOutline });
      g.moveTo(x + w / 2, y + 3).lineTo(x + w / 2, y + h).stroke({ width: 0.6, color: COLOURS.taxiLine });
      g.moveTo(x + w / 2 - 3.5, y + 3).lineTo(x + w / 2 + 3.5, y + 3).stroke({ width: 0.9, color: COLOURS.taxiLine });
      const num = new Text({ text: s.id, style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 3.2, fontWeight: '700', fill: COLOURS.taxiLine } });
      num.resolution = 4;
      num.position.set(x + 2.6, y + 1.6);
      labels.addChild(num);
      break;
    }
    case 'holdingBay': {
      g.rect(x, y, w, h).fill(COLOURS.asphalt);
      g.rect(x + 0.5, y + 0.5, w - 1, h - 1).stroke({ width: 0.4, color: COLOURS.taxiLine });
      labels.addChild(label('BAY', x + w / 2, y - 1));
      break;
    }
    case 'supportBuilding': {
      g.rect(x, y, w, h).fill(COLOURS.terminalRoof).stroke({ width: 0.4, color: COLOURS.wall });
      const name = { rampAgentStation: 'RAMP', adminOffice: 'ADMIN', airlineOffice: 'AIRLINE' }[s.role];
      labels.addChild(label(name, x + w / 2, y - 1));
      break;
    }
    case 'atcTower': {
      const cx = x + w / 2;
      g.rect(x, y + h - 9, w, 9).fill(COLOURS.terminalRoof);
      g.rect(cx - 3, y + 8, 6, h - 16).fill(0x2b3732);
      g.circle(cx, y + 8, 8).fill(0x33413b);
      g.circle(cx, y + 8, 5.6).fill(COLOURS.glass);
      labels.addChild(label('TWR', cx, y + h + 7));
      break;
    }
  }
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
    g.rect(sx, sy, 7, 3.4).fill(COLOURS.signRed);
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
  ground.rect(0, 0, layout.width * T, layout.height * T).fill(COLOURS.grass);
  const g = new Graphics();
  const labels = new Container();
  // Paved surfaces first, buildings and markings on top.
  const order: Structure['kind'][] = ['taxiway', 'runway', 'holdingBay', 'stand', 'terminal', 'cargoHub', 'supportBuilding', 'atcTower'];
  for (const kind of order) {
    for (const s of layout.structures) if (s.kind === kind) drawStructure(g, s, labels);
    if (kind === 'runway') drawTaxiMarkings(g, layout, labels);
  }
  root.addChild(ground, g, labels);
  return root;
}

/** Scales and centres the airfield so the whole layout fits the given screen size. */
export function fitToScreen(airfield: Container, layout: AirportLayout, screenW: number, screenH: number): void {
  const worldW = layout.width * T;
  const worldH = layout.height * T;
  const scale = Math.min(screenW / worldW, screenH / worldH);
  airfield.scale.set(scale);
  airfield.position.set((screenW - worldW * scale) / 2, (screenH - worldH * scale) / 2);
}
