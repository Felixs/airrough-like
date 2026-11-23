/**
 * Aircraft models built in code from each type's real dimensions (metres): a lofted fuselage, airfoil wings and tails,
 * nacelles, gear, painted liveries with windows, doors and titles. One "master" is built per type and livery; every
 * aircraft on the map is drawn as instances of it.
 */
import { Color3, Mesh, MeshBuilder, PBRMaterial, TransformNode, Vector3, type Scene, type Texture } from '@babylonjs/core';
import type { AircraftTypeId } from '../sim/aircraft';
import { loft, nacelle, orient, rod, surface, type Station } from './geometry';
import { canvasTexture } from './textures';

const D2R = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface AircraftModel {
  readonly size: 'small' | 'medium' | 'large';
  readonly cargo: boolean;
  /** Length, fuselage radius and wing span in metres; gear clearance as a share of the radius. */
  readonly L: number;
  readonly R: number;
  readonly span: number;
  readonly clr: number;
  readonly nose: 'round' | 'pointed' | 'blunt';
  /** Where the nose ends and the tail cone starts, as shares of the length. */
  readonly n0: number;
  readonly tc: number;
  readonly cone?: 'blade';
  readonly hump?: boolean;
  readonly mask?: boolean;
  readonly pod?: boolean;
  readonly wing: { readonly high?: boolean; readonly pos: number; readonly root: number; readonly tip: number; readonly sweep: number; readonly dih: number; readonly kink?: number };
  readonly eng:
    | { readonly kind: 'jet'; readonly dia: number; readonly len: number; readonly at: readonly number[]; readonly fwd?: number }
    | { readonly kind: 'prop'; readonly dia: number; readonly len: number; readonly at: readonly number[]; readonly nd: number; readonly blades: number }
    | { readonly kind: 'nose'; readonly dia: number; readonly blades: number };
  readonly tail: { readonly t: boolean; readonly fin: number; readonly finChord: number; readonly finSweep: number; readonly hs: number; readonly hsChord: number; readonly hsSweep: number; readonly hsDih: number };
  readonly winglet: 'none' | 'sharklet' | 'scimitar' | 'curl' | 'raked';
  readonly windows: { readonly n: number; readonly pitch: number; readonly big?: boolean };
  readonly fixedGear?: boolean;
}

const CARAVAN: AircraftModel = {
  size: 'small', cargo: false, L: 11.5, R: 0.85, span: 15.9, clr: 0.75, nose: 'blunt', n0: 0.12, tc: 0.6,
  wing: { high: true, pos: 0.36, root: 2.0, tip: 1.45, sweep: 0.15, dih: 2 }, eng: { kind: 'nose', dia: 2.7, blades: 3 },
  tail: { t: false, fin: 0.19, finChord: 0.17, finSweep: 28, hs: 0.2, hsChord: 0.12, hsSweep: 6, hsDih: 0 }, winglet: 'none',
  windows: { n: 5, pitch: 0.95, big: true }, fixedGear: true,
};
const B737: AircraftModel = {
  size: 'medium', cargo: false, L: 39.5, R: 1.88, span: 35.8, clr: 0.85, nose: 'pointed', n0: 0.1, tc: 0.73,
  wing: { pos: 0.39, root: 7.2, tip: 1.3, sweep: 8.0, dih: 6, kink: 0.35 }, eng: { kind: 'jet', dia: 1.95, len: 4.2, at: [0.28], fwd: 0.2 },
  tail: { t: false, fin: 0.165, finChord: 0.17, finSweep: 38, hs: 0.18, hsChord: 0.1, hsSweep: 30, hsDih: 7 }, winglet: 'scimitar',
  windows: { n: 46, pitch: 0.51 },
};

export const MODELS: Record<AircraftTypeId, AircraftModel> = {
  C208: CARAVAN,
  C208F: { ...CARAVAN, cargo: true, pod: true, windows: { n: 0, pitch: 1 } },
  Q400: {
    size: 'small', cargo: false, L: 32.8, R: 1.35, span: 28.4, clr: 0.7, nose: 'round', n0: 0.1, tc: 0.7,
    wing: { high: true, pos: 0.42, root: 3.3, tip: 1.6, sweep: 0.6, dih: 2.5 }, eng: { kind: 'prop', dia: 4.1, blades: 6, at: [0.29], len: 9, nd: 1.45 },
    tail: { t: true, fin: 0.2, finChord: 0.16, finSweep: 33, hs: 0.14, hsChord: 0.08, hsSweep: 8, hsDih: 0 }, winglet: 'none',
    windows: { n: 20, pitch: 0.82 },
  },
  A320: {
    size: 'medium', cargo: false, L: 37.6, R: 1.98, span: 35.8, clr: 0.95, nose: 'round', n0: 0.085, tc: 0.73,
    wing: { pos: 0.37, root: 7.0, tip: 1.5, sweep: 7.6, dih: 5.5, kink: 0.36 }, eng: { kind: 'jet', dia: 2.05, len: 4.4, at: [0.32] },
    tail: { t: false, fin: 0.165, finChord: 0.17, finSweep: 38, hs: 0.173, hsChord: 0.105, hsSweep: 30, hsDih: 6 }, winglet: 'sharklet',
    windows: { n: 42, pitch: 0.53 },
  },
  B738: B737,
  B738F: { ...B737, cargo: true, windows: { n: 0, pitch: 1 } },
  A350: {
    size: 'large', cargo: false, L: 66.8, R: 2.99, span: 64.75, clr: 0.95, nose: 'round', n0: 0.075, tc: 0.74, mask: true,
    wing: { pos: 0.37, root: 13, tip: 2.3, sweep: 16, dih: 5, kink: 0.34 }, eng: { kind: 'jet', dia: 3.0, len: 6.4, at: [0.32], fwd: 0.12 },
    tail: { t: false, fin: 0.14, finChord: 0.14, finSweep: 40, hs: 0.144, hsChord: 0.09, hsSweep: 32, hsDih: 6 }, winglet: 'curl',
    windows: { n: 80, pitch: 0.53 },
  },
  B77W: {
    size: 'large', cargo: false, L: 73.9, R: 3.1, span: 64.8, clr: 0.95, nose: 'round', n0: 0.07, tc: 0.75, cone: 'blade',
    wing: { pos: 0.38, root: 14, tip: 2.0, sweep: 17, dih: 6, kink: 0.33 }, eng: { kind: 'jet', dia: 3.4, len: 7.3, at: [0.31], fwd: 0.15 },
    tail: { t: false, fin: 0.13, finChord: 0.13, finSweep: 40, hs: 0.165, hsChord: 0.08, hsSweep: 32, hsDih: 7 }, winglet: 'raked',
    windows: { n: 90, pitch: 0.53 },
  },
  B748F: {
    size: 'large', cargo: true, L: 76.3, R: 3.25, span: 68.4, clr: 0.9, nose: 'round', n0: 0.07, tc: 0.76, hump: true,
    wing: { pos: 0.36, root: 15, tip: 2.6, sweep: 21, dih: 5, kink: 0.33 }, eng: { kind: 'jet', dia: 2.6, len: 6.0, at: [0.25, 0.48], fwd: 0.15 },
    tail: { t: false, fin: 0.135, finChord: 0.15, finSweep: 42, hs: 0.165, hsChord: 0.09, hsSweep: 34, hsDih: 7 }, winglet: 'raked',
    windows: { n: 0, pitch: 1 },
  },
};

/** Made-up airlines; the last one flies cargo. */
export interface Livery {
  readonly name: string;
  readonly reg: string;
  readonly body: string;
  readonly belly: string;
  readonly tail: string;
  readonly accent: string;
  readonly text: string;
  readonly engine: string;
  readonly style: 'cheat' | 'sweep' | 'tail' | 'cheat2';
  readonly italic?: boolean;
}
export const LIVERIES: readonly Livery[] = [
  { name: 'VANTARO', reg: 'D-AVTA', body: '#f4f5f7', belly: '#d5d9de', tail: '#14254a', accent: '#d4a64a', text: '#14254a', engine: '#14254a', style: 'cheat' },
  { name: 'bluefinch', reg: 'D-ABFN', body: '#f7f8fa', belly: '#1f6fd0', tail: '#1f6fd0', accent: '#ffffff', text: '#1f6fd0', engine: '#f7f8fa', style: 'sweep', italic: true },
  { name: 'CORVALIA', reg: 'D-ACVL', body: '#fbfbfb', belly: '#d9dce0', tail: '#b81d36', accent: '#ffffff', text: '#b81d36', engine: '#b81d36', style: 'tail' },
  { name: 'SOLENNE', reg: 'D-ASLN', body: '#f6f5f2', belly: '#cdd2d8', tail: '#0e6f73', accent: '#f28c28', text: '#0e6f73', engine: '#f6f5f2', style: 'cheat2' },
  { name: 'TESSERA CARGO', reg: 'D-ATSC', body: '#e8eaed', belly: '#b5bbc2', tail: '#2e7d32', accent: '#c5e1a5', text: '#2e7d32', engine: '#e8eaed', style: 'tail' },
];
export const CARGO_LIVERY = 4;

/** Fuselage cross-section at t (0 nose … 1 tail): half width, height above and below the centre line, and its height. */
function profile(m: AircraftModel, t: number): { rw: number; top: number; bot: number; y: number } {
  const R = m.R;
  let rw = R;
  let top = R;
  let bot = R;
  let y = 0;
  if (t < m.n0) {
    const s = t / m.n0;
    const e = m.nose === 'pointed' ? 0.62 : m.nose === 'blunt' ? 0.32 : 0.5;
    const f = Math.pow(Math.max(0, 1 - (1 - s) ** 2), e);
    rw = R * f;
    top = R * f;
    bot = R * f;
    y = -R * (m.nose === 'pointed' ? 0.3 : m.nose === 'blunt' ? 0.05 : 0.2) * Math.pow(1 - s, 1.6);
  }
  if (t > m.tc) {
    const s = (t - m.tc) / (1 - m.tc);
    rw = R * (1 - 0.86 * Math.pow(s, 1.15));
    const h = R * (1 - 0.84 * Math.pow(s, 0.95));
    top = h;
    bot = h;
    y = R * 0.62 * Math.pow(s, 1.35);
    if (m.cone === 'blade') rw *= 1 - 0.45 * s * s;
  }
  if (m.hump) top += R * 0.6 * smooth(0, 0.1, t) * (1 - smooth(0.3, 0.42, t));
  return { rw, top, bot, y };
}

function stations(m: AircraftModel): number[] {
  const a: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const s = i / 16;
    a.push(m.nose === 'blunt' ? m.n0 * (0.6 * s * s + 0.4 * s) : m.n0 * s * s);
  }
  if (m.hump) a.push(0.14, 0.2, 0.26, 0.31, 0.36, 0.4, 0.44, 0.55);
  else a.push((m.n0 + m.tc) / 2);
  for (let i = 0; i <= 14; i++) a.push(m.tc + ((1 - m.tc) * i) / 14);
  return [...new Set(a.map((v) => +v.toFixed(5)))].sort((x, y) => x - y);
}

function doorsOf(m: AircraftModel): Array<{ t: number; exit: boolean }> {
  const xR = m.L / 2 - m.wing.pos * m.L;
  const front = m.n0 * (m.nose === 'blunt' ? 2.6 : 1.3) + 0.012;
  const d = [{ t: front, exit: false }];
  if (m.size === 'large' && !m.cargo) d.push({ t: front + 0.14, exit: false }, { t: 0.6, exit: false });
  if (m.size === 'medium' && !m.cargo) {
    const tw = (m.L / 2 - (xR - m.wing.root * 0.35)) / m.L;
    d.push({ t: tw, exit: true }, { t: tw + 0.02, exit: true });
  }
  d.push({ t: m.tc - 0.015, exit: false });
  return d;
}

/**
 * The front left door (the one a jet bridge docks at), in the model's own frame: metres, nose along +x, left side +z,
 * the fuselage centre line at y = 0.
 */
export function frontDoor(type: AircraftTypeId): Vector3 {
  const m = MODELS[type];
  const t = doorsOf(m)[0]!.t;
  return new Vector3(m.L / 2 - t * m.L, m.R * 0.1, m.R);
}

/**
 * The fuselage texture: u along the length (0 nose … 1 tail), v round the body starting underneath (v = (θ + 90°) / 360°,
 * θ = 0 on the left side, 90° on top). Paint, livery shapes, windows, doors, cockpit windows and titles; a second
 * texture holds the cabin windows lit at night.
 */
function paintFuselage(scene: Scene, m: AircraftModel, liv: Livery): { albedo: Texture; lit: Texture } {
  const big = m.L > 50;
  const W = big ? 2048 : 1024;
  const H = 256;
  const kx = W / m.L;
  const ky = H / (2 * Math.PI * m.R);
  const X = (t: number) => t * W;
  const Y = (th: number) => (1 - (th + 90) / 360) * H;
  const mir = (th: number) => 180 - th;
  const doors = doorsOf(m);
  const xR = m.L / 2 - m.wing.pos * m.L;
  const windowsAt: Array<[number, number, number, number]> = [];
  const albedo = canvasTexture(scene, `fus-${liv.name}`, W, H, (g) => {
    g.fillStyle = liv.body;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.045)';
    for (let x = 0; x < W; x += kx * 2.1) g.fillRect(x, 0, 1, H);
    const bc = liv.style === 'sweep' ? liv.body : liv.belly;
    g.fillStyle = bc;
    g.fillRect(X(m.n0 * 0.4), Y(-32), W, H - Y(-32));
    g.fillRect(X(m.n0 * 0.4), 0, W, Y(212));
    const sides = (draw: (f: (th: number) => number) => void) => {
      draw((th) => th);
      draw(mir);
    };
    if (liv.style === 'cheat') {
      sides((f) => {
        g.fillStyle = liv.tail;
        const a = Y(f(-6));
        const b = Y(f(-14));
        g.fillRect(X(0.03), Math.min(a, b), X(0.93) - X(0.03), Math.abs(b - a));
        g.fillStyle = liv.accent;
        const c = Y(f(-16));
        const d = Y(f(-18));
        g.fillRect(X(0.05), Math.min(c, d), X(0.9) - X(0.05), Math.abs(d - c));
      });
    } else if (liv.style === 'cheat2') {
      sides((f) => {
        g.fillStyle = liv.tail;
        g.beginPath();
        g.moveTo(X(0.05), Y(f(-8)));
        g.lineTo(X(1), Y(f(10)));
        g.lineTo(X(1), Y(f(-4)));
        g.lineTo(X(0.05), Y(f(-14)));
        g.fill();
        g.fillStyle = liv.accent;
        g.beginPath();
        g.moveTo(X(0.08), Y(f(-17)));
        g.lineTo(X(1), Y(f(-7)));
        g.lineTo(X(1), Y(f(-12)));
        g.lineTo(X(0.08), Y(f(-20)));
        g.fill();
      });
    } else if (liv.style === 'sweep') {
      sides((f) => {
        g.fillStyle = liv.tail;
        g.beginPath();
        g.moveTo(X(0.18), Y(f(-90)));
        g.bezierCurveTo(X(0.45), Y(f(-60)), X(0.7), Y(f(-30)), X(0.86), Y(f(40)));
        g.lineTo(X(1), Y(f(80)));
        g.lineTo(X(1), Y(f(-90)));
        g.fill();
      });
    } else {
      g.fillStyle = liv.tail;
      g.beginPath();
      g.moveTo(X(0.93), 0);
      g.quadraticCurveTo(X(0.7), H / 2, X(0.93), H);
      g.lineTo(W, H);
      g.lineTo(W, 0);
      g.fill();
      sides((f) => {
        const a = Y(f(-10));
        const b = Y(f(-12));
        g.fillRect(X(0.04), Math.min(a, b), X(0.8) - X(0.04), Math.abs(b - a));
      });
    }
    // windows (skipping door positions)
    if (m.windows.n > 0) {
      const ww = (m.windows.big ? 0.62 : 0.26) * kx;
      const wh = (m.windows.big ? 0.48 : 0.38) * ky;
      const xs = m.L / 2 - (m.n0 * (m.windows.big ? 1.9 : 1.35) + 0.05) * m.L;
      const doorX = doors.map((d) => X(d.t));
      for (let i = 0; i < m.windows.n; i++) {
        const x = xs - i * m.windows.pitch;
        if (x < m.L / 2 - (m.tc + 0.03) * m.L) break;
        if (m.windows.big && x < xR - m.wing.root * 1.4) break;
        const px = ((m.L / 2 - x) / m.L) * W;
        if (doorX.some((d) => Math.abs(d - px) < 0.9 * kx)) continue;
        for (const th of [17, 163]) {
          const y = Y(th) - wh / 2;
          g.fillStyle = '#1b2431';
          g.fillRect(px - ww / 2, y, ww, wh);
          g.fillStyle = 'rgba(255,255,255,0.18)';
          g.fillRect(px - ww / 2, y, ww, wh * 0.25);
          windowsAt.push([px - ww / 2, y, ww, wh]);
        }
      }
    }
    // doors
    g.strokeStyle = 'rgba(60,66,74,0.75)';
    g.lineWidth = Math.max(1.2, kx * 0.035);
    for (const d of doors) {
      const px = X(d.t);
      const dw = (d.exit ? 0.55 : m.size === 'small' ? 0.75 : 1.05) * kx;
      const dh = (d.exit ? 1.0 : m.size === 'small' ? 1.6 : 1.9) / m.R / D2R;
      const b0 = d.exit ? -12 : -20;
      for (const [a, b] of [[b0, b0 + dh], [mir(b0 + dh), mir(b0)]] as const) {
        const y0 = Y(Math.max(a, b));
        const y1 = Y(Math.min(a, b));
        g.strokeRect(px - dw / 2, y0, dw, y1 - y0);
      }
    }
    if (m.cargo && m.size !== 'small') {
      const x0 = X(m.n0 * 1.7);
      const b = -12 + 2.7 / m.R / D2R;
      g.strokeRect(x0, Y(b), 3.4 * kx, Y(-12) - Y(b));
    }
    // cockpit windows
    const n0 = m.n0;
    const quad = (t0: number, t1: number, a0: number, a1: number, a2: number, a3: number) => {
      g.beginPath();
      g.moveTo(X(t0), Y(a0));
      g.lineTo(X(t1), Y(a1));
      g.lineTo(X(t1), Y(a2));
      g.lineTo(X(t0), Y(a3));
      g.closePath();
      g.fill();
    };
    g.fillStyle = '#0c1119';
    if (m.mask) {
      g.beginPath();
      g.moveTo(X(n0 * 0.42), Y(70));
      g.quadraticCurveTo(X(n0 * 0.36), Y(90), X(n0 * 0.42), Y(110));
      g.lineTo(X(n0 * 1.05), Y(150));
      g.lineTo(X(n0 * 1.0), Y(160));
      g.lineTo(X(n0 * 0.6), Y(140));
      g.lineTo(X(n0 * 0.6), Y(40));
      g.lineTo(X(n0 * 1.0), Y(20));
      g.lineTo(X(n0 * 1.05), Y(30));
      g.closePath();
      g.fill();
    } else if (m.nose === 'blunt') {
      quad(n0 * 1.3, n0 * 2.0, 40, 30, 10, 10);
      quad(n0 * 1.3, n0 * 2.0, 140, 150, 170, 170);
      quad(n0 * 1.0, n0 * 1.35, 60, 50, 130, 120);
    } else {
      const a = n0 * 0.55;
      const b = n0 * 0.78;
      const c = n0 * 0.98;
      quad(a, b, 66, 60, 88, 88);
      quad(a, b, 114, 120, 92, 92);
      quad(b + n0 * 0.01, c, 58, 46, 36, 40);
      quad(b + n0 * 0.01, c, 122, 134, 144, 140);
    }
    // titles, upright on both sides, and the registration near the tail
    const text = (s: string, t: number, th: number, hm: number, colour: string, flip: boolean, italic = false) => {
      g.save();
      g.translate(X(t), Y(th));
      if (flip) g.rotate(Math.PI);
      g.scale(kx / ky, 1);
      g.font = `${italic ? 'italic ' : ''}700 ${hm * ky}px Arial, Helvetica, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = colour;
      g.fillText(s, 0, 0);
      g.restore();
    };
    const hm = clamp(m.R * 0.42, 0.35, 1.5);
    const tt = m.size === 'small' ? 0.42 : 0.34;
    const name = m.cargo && !liv.name.includes('CARGO') ? `${liv.name} CARGO` : liv.name;
    text(name, tt, 42, hm, liv.text, false, liv.italic);
    text(name, tt, 138, hm, liv.text, true, liv.italic);
    text(liv.reg, 0.84, 22, hm * 0.32, '#30353b', false);
    text(liv.reg, 0.84, 158, hm * 0.32, '#30353b', true);
  }, { clamp: true });
  const lit = canvasTexture(scene, `fusLit-${liv.name}`, W / 2, H / 2, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W / 2, H / 2);
    g.scale(0.5, 0.5);
    let k = 0;
    for (const [x, y, w, h] of windowsAt) g.fillStyle = (k++ * 7) % 11 === 3 ? '#5a4020' : '#ffd28a', g.fillRect(x, y, w, h);
  }, { clamp: true });
  return { albedo, lit };
}

/** The tail fin: the livery colour with an emblem on both sides (u root → tip, v round the airfoil). */
function paintFin(scene: Scene, liv: Livery): Texture {
  return canvasTexture(scene, `fin-${liv.name}`, 512, 512, (g, W, H) => {
    g.fillStyle = liv.tail;
    g.fillRect(0, 0, W, H);
    for (const sideA of [true, false]) {
      const yc = (c: number) => (sideA ? H - ((1 - c) * H) / 2 : ((1 - c) * H) / 2);
      if (liv.style === 'cheat') {
        g.fillStyle = liv.accent;
        for (const off of [0, 0.09]) {
          g.beginPath();
          g.moveTo(W * (0.1 + off), yc(1));
          g.lineTo(W * (0.95 + off), yc(0.1));
          g.lineTo(W * (0.95 + off), yc(0));
          g.lineTo(W * (0.05 + off), yc(0.95));
          g.closePath();
          g.fill();
        }
      }
      if (liv.style === 'cheat2') {
        g.fillStyle = liv.accent;
        g.beginPath();
        g.moveTo(0, yc(0.35));
        g.lineTo(W, yc(0.75));
        g.lineTo(W, yc(1));
        g.lineTo(0, yc(0.55));
        g.closePath();
        g.fill();
      }
      const cx = W * 0.55;
      const cy = yc(0.5);
      const rx = W * 0.17;
      const ry = H * 0.15;
      g.fillStyle = liv.style === 'tail' ? '#ffffff' : liv.accent;
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = liv.tail;
      g.beginPath();
      g.moveTo(cx - rx * 0.6, cy + ry * 0.1);
      g.quadraticCurveTo(cx, cy - ry * 0.9, cx + rx * 0.65, cy - ry * 0.2);
      g.quadraticCurveTo(cx + rx * 0.05, cy - ry * 0.25, cx - rx * 0.6, cy + ry * 0.1);
      g.fill();
    }
  }, { clamp: true });
}

/** The wing: light grey with flap, slat and spoiler lines and a walkway; winglets in the tail colour. */
function paintWing(scene: Scene, liv: Livery, wingletFrom: number): Texture {
  return canvasTexture(scene, `wing-${liv.name}-${wingletFrom.toFixed(2)}`, 1024, 256, (g, W, H) => {
    g.fillStyle = '#c3c8ce';
    g.fillRect(0, H / 2, W, H / 2);
    g.fillStyle = '#d3d7dc';
    g.fillRect(0, 0, W, H / 2);
    const yu = (c: number) => H * (0.5 + 0.5 * c);
    g.strokeStyle = 'rgba(40,46,54,0.55)';
    g.lineWidth = 1.5;
    const line = (c: number, s0: number, s1: number) => {
      g.beginPath();
      g.moveTo(W * s0, yu(c));
      g.lineTo(W * s1, yu(c));
      g.stroke();
    };
    line(0.12, 0.06, wingletFrom * 0.98);
    line(0.72, 0.05, wingletFrom * 0.72);
    line(0.76, wingletFrom * 0.72, wingletFrom * 0.95);
    for (let i = 0; i < 5; i++) g.strokeRect(W * (0.18 + i * 0.09), yu(0.6), W * 0.085, yu(0.72) - yu(0.6));
    for (let s = 0.05; s < wingletFrom; s += 0.11) line(0.72, s, s);
    g.strokeStyle = 'rgba(20,20,20,0.6)';
    g.lineWidth = 2;
    g.strokeRect(W * 0.02, yu(0.3), W * 0.1, yu(0.55) - yu(0.3));
    if (wingletFrom < 0.99) {
      g.fillStyle = liv.tail;
      g.fillRect(W * wingletFrom + 4, 0, W, H);
    }
  }, { clamp: true });
}

/** Shared plain materials for aircraft parts. */
export interface AircraftMaterials {
  readonly chrome: PBRMaterial;
  readonly metal: PBRMaterial;
  readonly rubber: PBRMaterial;
  readonly gear: PBRMaterial;
  readonly fan: PBRMaterial;
  readonly grey: PBRMaterial;
}

export function pbr(scene: Scene, name: string, colour: string, rough = 0.4, metal = 0, clear = false): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = Color3.FromHexString(colour).toLinearSpace();
  m.metallic = metal;
  m.roughness = rough;
  m.maxSimultaneousLights = 8;
  if (clear) {
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = 0.55;
    m.clearCoat.roughness = 0.08;
  }
  return m;
}

export function aircraftMaterials(scene: Scene): AircraftMaterials {
  const fan = pbr(scene, 'ac-fan', '#ffffff', 0.35, 0.7);
  fan.albedoTexture = canvasTexture(scene, 'ac-fan', 256, 256, (g, W) => {
    const c = W / 2;
    g.fillStyle = '#16181b';
    g.fillRect(0, 0, W, W);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      g.strokeStyle = '#5c6168';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 30, c + Math.sin(a) * 30);
      g.quadraticCurveTo(c + Math.cos(a + 0.25) * 80, c + Math.sin(a + 0.25) * 80, c + Math.cos(a + 0.45) * 126, c + Math.sin(a + 0.45) * 126);
      g.stroke();
    }
    g.fillStyle = '#c5c9ce';
    g.beginPath();
    g.arc(c, c, 30, 0, Math.PI * 2);
    g.fill();
  }, { clamp: true });
  return {
    chrome: pbr(scene, 'ac-chrome', '#d6d9dd', 0.18, 1),
    metal: pbr(scene, 'ac-metal', '#b9bec5', 0.32, 0.8),
    rubber: pbr(scene, 'ac-rubber', '#141516', 0.9),
    gear: pbr(scene, 'ac-gear', '#c9cdd2', 0.35, 0.6),
    fan,
    grey: pbr(scene, 'ac-grey', '#cfd3d8', 0.35),
  };
}

/** Where a light sits on the aircraft (metres, aircraft frame: +x nose, +y up, +z left wing). */
export interface LightSpot {
  readonly at: Vector3;
  readonly colour: 'red' | 'green' | 'white';
  readonly role: 'nav' | 'beacon' | 'strobe';
  readonly phase: number;
}

export interface Master {
  readonly model: AircraftModel;
  /** Merged meshes (hidden; drawn through instances) for the airframe and the gear. */
  readonly meshes: readonly Mesh[];
  readonly gear: readonly Mesh[];
  readonly lights: readonly LightSpot[];
  readonly props: ReadonlyArray<{ at: Vector3; dia: number; blades: number }>;
  /** Height of the fuselage centre line above the wheels. */
  readonly bodyY: number;
  /** Lit cabin windows' material, brightened at night. */
  readonly lit: PBRMaterial | null;
}

/** Builds the master model of one type in one livery. Every part is merged per material and hidden. */
export function buildMaster(scene: Scene, type: AircraftTypeId, liveryIndex: number, mats: AircraftMaterials): Master {
  const m = MODELS[type];
  const liv = LIVERIES[liveryIndex]!;
  const { L, R, span } = m;
  const half = span / 2;
  const gy = -R * (1 + m.clr);
  const parts: Mesh[] = [];
  const gearParts: Mesh[] = [];
  const add = (mesh: Mesh, mat: PBRMaterial): Mesh => {
    mesh.material = mat;
    parts.push(mesh);
    return mesh;
  };
  const P = (t: number) => profile(m, t);
  const xAt = (t: number) => L / 2 - t * L;
  const tAt = (x: number) => clamp((L / 2 - x) / L, 0, 1);

  const fus = paintFuselage(scene, m, liv);
  const body = pbr(scene, `body-${type}-${liv.name}`, '#ffffff', 0.3, 0, true);
  body.albedoTexture = fus.albedo;
  body.emissiveTexture = fus.lit;
  body.emissiveColor = Color3.Black();
  const fin = pbr(scene, `fin-${type}-${liv.name}`, '#ffffff', 0.3, 0, true);
  fin.albedoTexture = paintFin(scene, liv);
  const tailSolid = pbr(scene, `tail-${type}-${liv.name}`, liv.tail, 0.3, 0, true);
  const engine = pbr(scene, `eng-${type}-${liv.name}`, liv.engine, 0.3, 0, true);
  const white = pbr(scene, `white-${type}-${liv.name}`, liv.body, 0.3, 0, true);

  // fuselage
  const N = 32;
  const rings: Vector3[][] = [];
  const us: number[] = [];
  for (const t of stations(m)) {
    const p = P(t);
    const ring: Vector3[] = [];
    for (let j = 0; j < N; j++) {
      const th = -Math.PI / 2 + (j / N) * Math.PI * 2;
      const s = Math.sin(th);
      ring.push(new Vector3(xAt(t), p.y + (s > 0 ? p.top : p.bot) * s, p.rw * Math.cos(th)));
    }
    rings.push(ring);
    us.push(t);
  }
  const pe = P(1);
  rings.push(Array.from({ length: N }, () => new Vector3(xAt(1) - 0.001, pe.y, 0)));
  us.push(1);
  add(orient(loft(scene, 'fuselage', rings, us, null, true), (x) => [x, P(tAt(x)).y, 0]), body);
  if (m.pod) {
    const pod = MeshBuilder.CreateSphere('pod', { diameterX: L * 0.5, diameterY: R * 0.7, diameterZ: R * 1.2, segments: 10 }, scene);
    pod.position.set(-L * 0.02, -R * 1.05, 0);
    add(pod, white);
  }

  // wings and winglets
  const W = m.wing;
  const xR = L / 2 - W.pos * L;
  const y0 = W.high ? R * 0.8 : -R * 0.55;
  const swp = W.sweep / half;
  const leAt = (z: number) => new Vector3(xR - z * swp, y0 + z * Math.tan(W.dih * D2R), z);
  const st: Station[] = [{ le: leAt(0), chord: W.root, t: 0.13 }];
  if (W.kink) st.push({ le: leAt(W.kink * half), chord: lerp(W.root, W.tip, W.kink) * 0.82, t: 0.11 });
  let tip: Station;
  let lower: Station[] | null = null;
  if (m.winglet === 'raked') {
    st.push({ le: leAt(half * 0.9), chord: W.tip * 1.15, t: 0.09 });
    const e = leAt(half);
    e.x -= half * 0.16;
    tip = { le: e, chord: W.tip * 0.32, t: 0.08 };
    st.push(tip);
  } else if (m.winglet === 'sharklet' || m.winglet === 'scimitar') {
    const h = span * (m.winglet === 'sharklet' ? 0.066 : 0.055);
    tip = { le: leAt(half * 0.985), chord: W.tip, t: 0.09 };
    st.push(tip);
    const b = leAt(half);
    b.y += h * 0.2;
    b.x -= h * 0.2;
    st.push({ le: b, chord: W.tip * 0.8, t: 0.08 });
    const top = leAt(half);
    top.z += h * 0.08;
    top.y += h;
    top.x -= h * 0.95;
    st.push({ le: top, chord: W.tip * 0.32, t: 0.08 });
    if (m.winglet === 'scimitar') {
      const lo = leAt(half);
      lo.y -= h * 0.42;
      lo.x -= h * 0.75;
      lo.z += 0.05;
      lower = [{ le: leAt(half * 0.975), chord: W.tip * 0.85, t: 0.08 }, { le: lo, chord: W.tip * 0.3, t: 0.08 }];
    }
  } else if (m.winglet === 'curl') {
    const h = span * 0.055;
    tip = { le: leAt(half * 0.93), chord: W.tip * 1.05, t: 0.09 };
    st.push(tip);
    const a = leAt(half);
    a.y += h * 0.12;
    a.x -= h * 0.3;
    st.push({ le: a, chord: W.tip * 0.78, t: 0.08 });
    const b = leAt(half);
    b.z += h * 0.05;
    b.y += h * 0.55;
    b.x -= h * 0.95;
    st.push({ le: b, chord: W.tip * 0.48, t: 0.08 });
    const c = leAt(half);
    c.z += h * 0.02;
    c.y += h;
    c.x -= h * 1.7;
    st.push({ le: c, chord: W.tip * 0.2, t: 0.07 });
  } else {
    tip = { le: leAt(half), chord: W.tip, t: 0.1 };
    st.push(tip);
  }
  let wingMat: PBRMaterial | null = null;
  for (const mirror of [false, true]) {
    const s = surface(scene, 'wing', st, 0.12, mirror);
    if (!wingMat) {
      const from = m.winglet === 'none' || m.winglet === 'raked' ? 1 : s.us[st.indexOf(tip)] ?? 1;
      wingMat = pbr(scene, `wing-${type}-${liv.name}`, '#ffffff', 0.35, 0.15);
      wingMat.albedoTexture = paintWing(scene, liv, from);
    }
    add(s.mesh, wingMat);
    if (lower) add(surface(scene, 'winglet-low', lower, 0.08, mirror).mesh, tailSolid);
  }

  // tail
  const tl = m.tail;
  const finC = tl.finChord * L;
  const finH = tl.fin * L;
  const xF = -L / 2 + 0.025 * L + finC * 1.05;
  const pF = P(tAt(xF - finC * 0.4));
  const yF = pF.y + pF.top - 0.3 * R;
  const finTip = new Vector3(xF - finH * Math.tan(tl.finSweep * D2R), yF + finH, 0);
  add(surface(scene, 'fin', [{ le: new Vector3(xF, yF, 0), chord: finC }, { le: finTip, chord: finC * 0.4 }], 0.1, false).mesh, fin);
  const hsC = tl.hsChord * L;
  const hsHalf = tl.hs * span;
  const hx = tl.t ? finTip.x + 0.2 : -L / 2 + 0.035 * L + hsC;
  const hy = tl.t ? finTip.y - 0.2 : P(tAt(hx - hsC * 0.5)).y + (m.cone === 'blade' ? 0 : 0.05 * R);
  const hs: Station[] = [
    { le: new Vector3(hx, hy, 0), chord: hsC },
    { le: new Vector3(hx - hsHalf * Math.tan(tl.hsSweep * D2R), hy + hsHalf * Math.tan(tl.hsDih * D2R), hsHalf), chord: hsC * 0.42 },
  ];
  for (const mirror of [false, true]) add(surface(scene, 'stabiliser', hs, 0.1, mirror).mesh, tl.t ? tailSolid : mats.grey);

  // engines and propellers
  const props: Array<{ at: Vector3; dia: number; blades: number }> = [];
  const E = m.eng;
  if (E.kind === 'jet') {
    for (const f of E.at) {
      const z = f * half;
      const le = leAt(z);
      const D = E.dia;
      const len = E.len;
      const cx = le.x + len * (0.08 + (E.fwd ?? 0));
      const cy = le.y - D * 0.62;
      for (const s of [1, -1]) {
        add(nacelle(scene, D, len, false), engine).position.set(cx, cy, z * s);
        const lip = add(MeshBuilder.CreateTorus('lip', { diameter: D * 0.93, thickness: D * 0.09, tessellation: 28 }, scene), mats.chrome);
        lip.rotation.z = Math.PI / 2;
        lip.position.set(cx + len * 0.5, cy, z * s);
        const fan = add(MeshBuilder.CreateDisc('fan', { radius: D * 0.44, tessellation: 24 }, scene), mats.fan);
        fan.rotation.y = -Math.PI / 2;
        fan.position.set(cx + len * 0.38, cy, z * s);
        const exhaust = add(MeshBuilder.CreateCylinder('exhaust', { height: len * 0.3, diameterTop: D * 0.62, diameterBottom: D * 0.12, tessellation: 18 }, scene), mats.metal);
        exhaust.rotation.z = -Math.PI / 2;
        exhaust.position.set(cx - len * 0.48, cy, z * s);
        add(MeshBuilder.CreateBox('pylon', { width: len * 0.85, height: D * 0.55, depth: D * 0.12 }, scene), mats.grey).position.set(cx - len * 0.12, cy + D * 0.5, z * s);
      }
    }
  } else if (E.kind === 'nose') {
    props.push({ at: new Vector3(L / 2 + 0.25, P(0.02).y, 0), dia: E.dia, blades: E.blades });
  } else {
    for (const f of E.at) {
      const z = f * half;
      const le = leAt(z);
      const cx = le.x - E.len * 0.05;
      const cy = le.y - E.nd * 0.35;
      for (const s of [1, -1]) {
        add(nacelle(scene, E.nd, E.len, true), white).position.set(cx, cy, z * s);
        props.push({ at: new Vector3(cx + E.len * 0.53, cy, z * s), dia: E.dia, blades: E.blades });
      }
    }
  }
  if (m.fixedGear) for (const s of [1, -1]) add(rod(scene, new Vector3(xR - 0.8, -R * 0.5, s * R * 0.6), new Vector3(xR - 0.9, y0, s * half * 0.45), 0.12, 6), white);

  // landing gear
  const wd = m.size === 'small' ? 0.65 : m.size === 'medium' ? 1.15 : 1.3;
  const ww = wd * 0.36;
  const leg = (x: number, z: number, top: number, axles: readonly number[], pairs: readonly number[], w = wd) => {
    const strut = rod(scene, new Vector3(x, top, z), new Vector3(x, gy + w * 0.5, z), w * 0.22, 6);
    strut.material = mats.gear;
    gearParts.push(strut);
    for (const a of axles) {
      for (const p of pairs) {
        const wheel = MeshBuilder.CreateCylinder('wheel', { diameter: w, height: ww, tessellation: 12 }, scene);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x + a, gy + w * 0.5, z + p);
        wheel.material = mats.rubber;
        gearParts.push(wheel);
      }
    }
  };
  const xM = xR - W.root * 0.62;
  if (m.fixedGear) {
    for (const s of [1, -1]) leg(xR - 0.9, s * 1.6, -R * 0.6, [0], [0]);
    leg(L / 2 - 1.4, 0, -R * 0.4, [0], [0], wd * 0.8);
  } else if (E.kind === 'prop') {
    for (const s of [1, -1]) leg(xR - 1.2, s * E.at[0]! * half, y0 - 1.2, [0], [-ww * 0.6, ww * 0.6]);
    leg(L / 2 - L * 0.1, 0, -R * 0.5, [0], [-ww * 0.6, ww * 0.6], wd * 0.75);
  } else {
    const zM = Math.max(R * 1.05, 0.105 * span);
    const axles = type === 'B77W' ? [-1.4, 0, 1.4] : m.size === 'large' ? [-0.8, 0.8] : [0];
    for (const s of [1, -1]) leg(xM, s * zM, y0 - 0.2, axles, [-ww * 0.7, ww * 0.7]);
    if (type === 'B748F') for (const s of [1, -1]) leg(xM - 3, s * R * 0.55, -R * 0.7, axles, [-ww * 0.7, ww * 0.7]);
    leg(L / 2 - L * 0.11, 0, -R * 0.6, [0], [-ww * 0.55, ww * 0.55], wd * 0.72);
  }

  const merge = (list: Mesh[]): Mesh[] => {
    const groups = new Map<number, Mesh[]>();
    for (const mesh of list) {
      const k = mesh.material!.uniqueId;
      groups.set(k, [...(groups.get(k) ?? []), mesh]);
    }
    const out: Mesh[] = [];
    for (const group of groups.values()) {
      const merged = group.length > 1 ? Mesh.MergeMeshes(group, true, true) : group[0]!;
      if (!merged) continue;
      merged.isVisible = false;
      merged.isPickable = false;
      merged.receiveShadows = true;
      out.push(merged);
    }
    return out;
  };

  const tipLE = tip.le;
  const pTop = P(0.45);
  const lights: LightSpot[] = [
    { at: new Vector3(tipLE.x - tip.chord * 0.2, tipLE.y, tipLE.z + 0.1), colour: 'red', role: 'nav', phase: 0 },
    { at: new Vector3(tipLE.x - tip.chord * 0.2, tipLE.y, -tipLE.z - 0.1), colour: 'green', role: 'nav', phase: 0 },
    { at: new Vector3(xAt(1) - 0.2, pe.y, 0), colour: 'white', role: 'nav', phase: 0 },
    { at: new Vector3(xR - W.root * 0.3, pTop.y + pTop.top + 0.12, 0), colour: 'red', role: 'beacon', phase: 0 },
    { at: new Vector3(xR - W.root * 0.5, -R - 0.12, 0), colour: 'red', role: 'beacon', phase: 0.5 },
    { at: new Vector3(tipLE.x - tip.chord * 0.6, tipLE.y, tipLE.z + 0.1), colour: 'white', role: 'strobe', phase: 0 },
    { at: new Vector3(tipLE.x - tip.chord * 0.6, tipLE.y, -tipLE.z - 0.1), colour: 'white', role: 'strobe', phase: 0 },
  ];
  return { model: m, meshes: merge(parts), gear: merge(gearParts), lights, props, bodyY: -gy, lit: m.windows.n > 0 ? body : null };
}

/** A transform node helper for the visual tree. */
export const node = (scene: Scene, name: string, parent?: TransformNode): TransformNode => {
  const n = new TransformNode(name, scene);
  if (parent) n.parent = parent;
  return n;
};
