/**
 * The airfield in 3D, built from the layout: grass, trees and fence; painted Runways and Taxiways with their lights;
 * Stands and Holding Bays with markings and numbers; Terminals, Cargo Hubs, the ATC Tower and Support Buildings.
 * Everything is built in code from the tile rectangles (1 tile = 16 m).
 */
import { Color3, Mesh, MeshBuilder, PBRMaterial, StandardMaterial, type Scene, type Texture } from '@babylonjs/core';
import { runwayNames, sharesEdge, TILE_SIZE, WORLD, type AirportLayout, type Facing, type RunwayName, type Structure, type TileRect } from '../sim/layout';
import { holdShortLines, TAXIWAY_INSET, taxiwayEdgeLights } from '../sim/markings';
import { pbr } from './aircraftModels';
import { groundLines, meshFrom, orient, thinInstances, type Place } from './geometry';
import { centreLinePaths } from './taxiLines';
import { blots, canvasTexture, rng, speckle } from './textures';

const T = TILE_SIZE;
/** Heights of the paved layers above the grass. */
const Y = { apron: 0.15, taxi: 0.18, runway: 0.2, paint: 0.03 } as const;

/** What the view needs to light the airfield through the Day. */
export interface Airfield {
  /** Light materials: brightened at night. `day` is how bright they are by day (0…1). */
  readonly lights: ReadonlyArray<{ mat: StandardMaterial; colour: Color3; day: number }>;
  /** Glass that glows from inside at night. */
  readonly litGlass: readonly PBRMaterial[];
}

export interface AirfieldContext {
  readonly scene: Scene;
  readonly caster: (m: Mesh) => void;
  readonly glow: (m: Mesh) => void;
}

/** World-space rectangle of a tile rectangle on the ground: x0…x1 east, z0…z1 (z = −y). */
const box3 = (r: TileRect) => ({ x0: r.x * T, x1: (r.x + r.w) * T, z0: -(r.y + r.h) * T, z1: -r.y * T, cx: (r.x + r.w / 2) * T, cz: -(r.y + r.h / 2) * T, w: r.w * T, d: r.h * T });

export function buildAirfield(ctx: AirfieldContext, layout: AirportLayout): Airfield {
  const { scene } = ctx;
  const lights: Array<{ mat: StandardMaterial; colour: Color3; day: number }> = [];
  const litGlass: PBRMaterial[] = [];
  const lightMat = (name: string, hex: string, day = 0.12) => {
    const mat = new StandardMaterial(name, scene);
    mat.disableLighting = true;
    const colour = Color3.FromHexString(hex);
    mat.emissiveColor = colour.scale(day);
    lights.push({ mat, colour, day });
    return mat;
  };
  const lightBoxes = (name: string, hex: string, places: Place[], size = 0.7, day = 0.12) => {
    if (!places.length) return;
    const b = MeshBuilder.CreateBox(name, { size }, scene);
    b.material = lightMat(name, hex, day);
    b.isPickable = false;
    ctx.glow(thinInstances(b, places));
  };
  const textured = (name: string, tex: Texture, rough = 0.85, metal = 0) => {
    const m = pbr(scene, name, '#ffffff', rough, metal);
    m.albedoTexture = tex;
    return m;
  };
  const paint = (name: string, hex: string) => {
    const m = pbr(scene, name, hex, 0.6);
    m.zOffset = -2;
    return m;
  };
  const yellow = paint('paint-yellow', '#e7b928');
  const bridgeMat = pbr(scene, 'jet-bridge', '#c9ccd0', 0.4, 0.3);
  const red = paint('paint-red', '#c0392b');

  // ---- grass, trees, fence
  const margin = 40 * T;
  const grassTex = canvasTexture(scene, 'grass', 512, 512, (g, W, H) => {
    g.fillStyle = '#5a7838';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < W; i += 64) {
      g.fillStyle = (i / 64) % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.04)';
      g.fillRect(0, i, W, 64);
    }
    const r = rng(11);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '90,70,30' : '30,60,20'},${0.08 * r()})`;
      g.beginPath();
      g.arc(r() * W, r() * H, 10 + r() * 60, 0, Math.PI * 2);
      g.fill();
    }
    speckle(g, W, H, 18000, 0.16, 2, 5);
  }, { u: (WORLD.width * T + 2 * margin) / 120, v: (WORLD.height * T + 2 * margin) / 120 });
  const world = box3({ x: WORLD.x0, y: WORLD.y0, w: WORLD.width, h: WORLD.height });
  const grass = MeshBuilder.CreateGround('grass', { width: world.w + 2 * margin, height: world.d + 2 * margin }, scene);
  grass.position.set(world.cx, 0, world.cz);
  grass.material = textured('grass', grassTex, 0.95);
  grass.receiveShadows = true;
  grass.isPickable = false;

  const xs = layout.structures.flatMap((s) => [s.x, s.x + s.w]);
  const ys = layout.structures.flatMap((s) => [s.y, s.y + s.h]);
  const fence = { x0: (Math.min(...xs) - 1.5) * T, x1: (Math.max(...xs) + 1.5) * T, z0: -(Math.max(...ys) + 1.5) * T, z1: -(Math.min(...ys) - 1.5) * T };
  {
    const r = rng(42);
    const trunks: Place[] = [];
    const crowns: Place[] = [];
    const colours: number[] = [];
    const greens = ['#3c5a2a', '#4a6b2f', '#355226', '#56733a', '#2f4a22'];
    for (let i = 0; i < 900; i++) {
      const x = world.x0 - margin * 0.8 + r() * (world.w + margin * 1.6);
      const z = world.z0 - margin * 0.8 + r() * (world.d + margin * 1.6);
      const s = 1.8 + r() * 2.6;
      if (x > fence.x0 - s - 3 && x < fence.x1 + s + 3 && z > fence.z0 - s - 3 && z < fence.z1 + s + 3) continue;
      trunks.push([x, s * 0.6, z, s * 0.12, s * 1.2, s * 0.12]);
      crowns.push([x, s * 1.6, z, s, s * (0.9 + r() * 0.5), s]);
      const c = Color3.FromHexString(greens[Math.floor(r() * greens.length)]!);
      colours.push(c.r, c.g, c.b, 1);
    }
    const trunk = MeshBuilder.CreateCylinder('trunk', { height: 1, diameter: 1, tessellation: 6 }, scene);
    trunk.material = pbr(scene, 'trunk', '#4a3b2b', 0.9);
    thinInstances(trunk, trunks);
    const crown = MeshBuilder.CreateIcoSphere('crown', { radius: 1, subdivisions: 2 }, scene);
    crown.material = pbr(scene, 'crown', '#ffffff', 0.9);
    ctx.caster(thinInstances(crown, crowns, new Float32Array(colours)));
    const posts: Place[] = [];
    for (let x = fence.x0; x <= fence.x1; x += 3) posts.push([x, 0.6, fence.z0, 0.08, 1.2, 0.08], [x, 0.6, fence.z1, 0.08, 1.2, 0.08]);
    for (let z = fence.z0; z <= fence.z1; z += 3) posts.push([fence.x0, 0.6, z, 0.08, 1.2, 0.08], [fence.x1, 0.6, z, 0.08, 1.2, 0.08]);
    const post = MeshBuilder.CreateBox('fence-post', { size: 1 }, scene);
    post.material = pbr(scene, 'fence', '#9aa1a8', 0.5, 0.5);
    thinInstances(post, posts);
  }

  // ---- runways
  const names = runwayNames(layout);
  const edgeWhite: Place[] = [];
  const thresholdGreen: Place[] = [];
  const approach: Place[] = [];
  layout.runways.forEach((r, i) => {
    const b = box3(r);
    const vertical = r.h > r.w;
    const len = vertical ? b.d : b.w;
    const wid = vertical ? b.w : b.d;
    const name: RunwayName = names[i] ?? { forward: '09', reverse: '27' };
    const ground = MeshBuilder.CreateGround(`runway${i}`, { width: len, height: wid }, scene);
    ground.position.set(b.cx, Y.runway, b.cz);
    // the texture's length axis runs from the forward threshold (west / north) to the other end
    if (vertical) ground.rotation.y = Math.PI / 2;
    ground.material = textured(`runway${i}`, paintRunway(scene, `runway${i}`, len, wid, name, r.surface === 'grass'), 0.82);
    ground.receiveShadows = true;
    ground.isPickable = false;
    if (r.surface !== 'lit' && r.surface !== 'ils') return;
    const along = (d: number, across: number): [number, number] => (vertical ? [b.x0 + across, b.z1 - d] : [b.x0 + d, b.z1 - across]);
    for (let d = 4; d < len; d += 8) {
      for (const a of [-0.6, wid + 0.6]) {
        const [x, z] = along(d, a);
        edgeWhite.push([x, 0.5, z]);
      }
    }
    for (let c = 1.5; c < wid; c += 2.5) {
      for (const d of [-0.6, len + 0.6]) {
        const [x, z] = along(d, c);
        thresholdGreen.push([x, 0.5, z]);
      }
    }
    if (r.surface !== 'ils') return;
    for (let k = 1; k <= 8; k++) {
      for (const d of [-3 - k * 3, len + 3 + k * 3]) {
        for (const c of k === 4 ? [-6, -3, 0, 3, 6] : [-1.2, 0, 1.2]) {
          const [x, z] = along(d, wid / 2 + c);
          approach.push([x, 0.6, z]);
        }
      }
    }
  });
  lightBoxes('rwy-edge', '#fff4d6', edgeWhite);
  lightBoxes('rwy-threshold', '#3dff7a', thresholdGreen);
  lightBoxes('rwy-approach', '#ffb347', approach, 0.8);

  // ---- taxiways: one paved surface, inset half a tile from open ground, with rounded inside corners
  const taxi = layout.structures.filter((s) => s.kind === 'taxiway');
  const paved = new Set<string>();
  for (const s of taxi) for (let x = s.x; x < s.x + s.w; x++) for (let y = s.y; y < s.y + s.h; y++) paved.add(`${x},${y}`);
  const others = new Set<string>();
  for (const s of layout.structures) {
    if (s.kind === 'runway' || s.kind === 'stand' || s.kind === 'holdingBay') for (let x = s.x; x < s.x + s.w; x++) for (let y = s.y; y < s.y + s.h; y++) others.add(`${x},${y}`);
  }
  const open = (x: number, y: number) => !paved.has(`${x},${y}`) && !others.has(`${x},${y}`);
  const I = TAXIWAY_INSET * T;
  const pos: number[] = [];
  const idx: number[] = [];
  const uv: number[] = [];
  const vert = (x: number, y: number) => {
    pos.push(x, Y.taxi, -y);
    uv.push(x / 64, -y / 64);
    return pos.length / 3 - 1;
  };
  for (const k of paved) {
    const [tx, ty] = k.split(',').map(Number) as [number, number];
    const l = open(tx - 1, ty) ? I : 0;
    const rr = open(tx + 1, ty) ? I : 0;
    const t = open(tx, ty - 1) ? I : 0;
    const bb = open(tx, ty + 1) ? I : 0;
    const a = vert(tx * T + l, ty * T + t);
    const b = vert((tx + 1) * T - rr, ty * T + t);
    const c = vert((tx + 1) * T - rr, (ty + 1) * T - bb);
    const d = vert(tx * T + l, (ty + 1) * T - bb);
    idx.push(a, b, c, a, c, d);
    // fillet in every inside corner (both neighbours paved, the diagonal open)
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      if (open(tx + dx, ty) || open(tx, ty + dy) || !open(tx + dx, ty + dy)) continue;
      if (!paved.has(`${tx + dx},${ty}`) && !others.has(`${tx + dx},${ty}`)) continue;
      const cx = (dx > 0 ? (tx + 1) * T : tx * T) - dx * I;
      const cy = (dy > 0 ? (ty + 1) * T : ty * T) - dy * I;
      const corner = vert(cx, cy);
      let prev = vert(cx + dx * T, cy);
      for (let i = 1; i <= 6; i++) {
        const s = i / 6;
        const px = (1 - s) ** 2 * (cx + dx * T) + 2 * s * (1 - s) * cx + s * s * cx;
        const py = (1 - s) ** 2 * cy + 2 * s * (1 - s) * cy + s * s * (cy + dy * T);
        const next = vert(px, py);
        idx.push(corner, prev, next);
        prev = next;
      }
    }
  }
  if (idx.length) {
    const taxiMesh = orient(meshFrom(scene, 'taxiways', pos, idx, uv), (x, _y, z) => [x, Y.taxi - 1, z]);
    taxiMesh.material = textured('taxiway', canvasTexture(scene, 'taxiway', 512, 512, (g, W, H) => {
      g.fillStyle = '#3d3f43';
      g.fillRect(0, 0, W, H);
      speckle(g, W, H, 26000, 0.22, 1.5, 4);
      blots(g, W, H, 30, 0.08, 18, 6);
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i <= W; i += 64) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, H);
        g.moveTo(0, i);
        g.lineTo(W, i);
        g.stroke();
      }
    }));
    taxiMesh.receiveShadows = true;
    taxiMesh.isPickable = false;
  }
  const centre = centreLinePaths(layout).map((line) => line.map(([x, y]) => [x, -y] as [number, number]));
  groundLines(scene, 'centre-lines', centre, 0.6, Y.taxi + Y.paint).material = yellow;

  // hold-short lines (two solid, two dashed) and red "09-27" signs
  const holdBars: Array<Array<[number, number]>> = [];
  for (const h of holdShortLines(layout)) {
    const across = h.side === 'north' || h.side === 'south';
    const towardRunway = h.side === 'north' || h.side === 'west' ? 1 : -1;
    const base = across ? (h.side === 'north' ? h.y * T : (h.y + 1) * T) : h.side === 'west' ? h.x * T : (h.x + 1) * T;
    [1.6, 2.6, 4.2, 5.2].forEach((o, i) => {
      const at = base + towardRunway * o;
      const len = ((across ? h.w : h.h) - 2 * TAXIWAY_INSET) * T;
      const start = ((across ? h.x : h.y) + TAXIWAY_INSET) * T;
      for (let p = 0; p < len; p += i >= 2 ? 2.4 : len) {
        const seg = i >= 2 ? 1.4 : len;
        holdBars.push(across ? [[start + p, -at], [start + p + seg, -at]] : [[at, -(start + p)], [at, -(start + p + seg)]]);
      }
    });
    const sw = 1.6 + h.sign.length * 1.45;
    const sx = across ? h.x * T - sw - 0.5 : h.side === 'west' ? h.x * T - sw - 0.5 : (h.x + 1) * T + 0.5;
    const sy = across ? (h.side === 'north' ? h.y * T + 1 : h.y * T + 3) : h.y * T - 4;
    const sign = MeshBuilder.CreateBox('sign', { width: sw, height: 0.9, depth: 3.4 }, scene);
    sign.position.set(sx + sw / 2, 0.45, -(sy + 1.7));
    sign.material = pbr(scene, 'sign', '#b3261e', 0.5);
    ctx.caster(sign);
    decal(scene, h.sign, sx + sw / 2, sy + 1.7, sw, 3.4, 0.95, '#f2f2f2', null);
  }
  groundLines(scene, 'hold-short', holdBars, 0.5, Y.taxi + Y.paint).material = yellow;
  lightBoxes('taxi-edge', '#3d7bff', taxiwayEdgeLights(layout).map((l) => [l.x * T, 0.35, -l.y * T] as Place), 0.5);

  // ---- stands and holding bays
  const concrete = textured('concrete', canvasTexture(scene, 'concrete', 512, 512, (g, W, H) => {
    g.fillStyle = '#a2a39e';
    g.fillRect(0, 0, W, H);
    speckle(g, W, H, 20000, 0.12, 1.5, 9);
    blots(g, W, H, 16, 0.06, 26, 3);
    g.strokeStyle = 'rgba(40,40,40,0.3)';
    for (let i = 0; i <= W; i += 128) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, H);
      g.moveTo(0, i);
      g.lineTo(W, i);
      g.stroke();
    }
  }));
  const pads: number[] = [];
  const padIdx: number[] = [];
  const padUv: number[] = [];
  const yellowLines: Array<Array<[number, number]>> = [];
  const redDashes: Array<Array<[number, number]>> = [];
  const spots = layout.structures.filter((s): s is Extract<Structure, { kind: 'stand' | 'holdingBay' }> => s.kind === 'stand' || s.kind === 'holdingBay');
  for (const s of spots) {
    const b = box3(s);
    const i = pads.length / 3;
    pads.push(b.x0, Y.apron, b.z0, b.x1, Y.apron, b.z0, b.x1, Y.apron, b.z1, b.x0, Y.apron, b.z1);
    padUv.push(b.x0 / 32, b.z0 / 32, b.x1 / 32, b.z0 / 32, b.x1 / 32, b.z1 / 32, b.x0 / 32, b.z1 / 32);
    padIdx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    const f = frame(s);
    const c = f.across / 2;
    const lane = f.depth + 1.5 * T;
    const stopAt = s.kind === 'stand' ? 3 : 4;
    yellowLines.push([f.p(c, stopAt), f.p(c, lane - 6)]);
    for (const side of [-6, 6]) {
      const curve: Array<[number, number]> = [];
      const a = f.p(c + side, lane);
      const m = f.p(c, lane);
      const e = f.p(c, lane - 6);
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        curve.push([(1 - t) ** 2 * a[0] + 2 * t * (1 - t) * m[0] + t * t * e[0], (1 - t) ** 2 * a[1] + 2 * t * (1 - t) * m[1] + t * t * e[1]]);
      }
      yellowLines.push(curve);
    }
    yellowLines.push([f.p(c - 3.5, stopAt), f.p(c + 3.5, stopAt)]);
    if (s.kind === 'stand') {
      const [ou, ov, ow, oh] = [1.5, 1, f.across - 3, f.depth - 2];
      const dash = (u0: number, v0: number, u1: number, v1: number) => {
        const len = Math.hypot(u1 - u0, v1 - v0);
        for (let q = 0; q < len; q += 2.2) {
          const t0 = q / len;
          const t1 = Math.min(1, (q + 1.2) / len);
          redDashes.push([f.p(u0 + (u1 - u0) * t0, v0 + (v1 - v0) * t0), f.p(u0 + (u1 - u0) * t1, v0 + (v1 - v0) * t1)]);
        }
      };
      dash(ou, ov, ou + ow, ov);
      dash(ou + ow, ov, ou + ow, ov + oh);
      dash(ou, ov + oh, ou + ow, ov + oh);
      dash(ou, ov, ou, ov + oh);
      // jet bridge from the Terminal to Contact Stands
      if (s.placement === 'contact' && layout.structures.some((o) => o.kind === 'terminal' && sharesEdge(o, s))) {
        const [ax, az] = f.p(c + 3.1, -0.5);
        const [bx, bz] = f.p(c + 3.1, 4.5);
        const tunnel = MeshBuilder.CreateBox('jet-bridge', { width: 1.6, height: 1.5, depth: 1.6 }, scene);
        const lenB = Math.hypot(bx - ax, bz - az);
        tunnel.scaling.set(1, 1, lenB / 1.6);
        tunnel.position.set((ax + bx) / 2, 2.6, (az + bz) / 2);
        tunnel.rotation.y = Math.atan2(bx - ax, bz - az);
        tunnel.material = bridgeMat;
        ctx.caster(tunnel);
        const [cx2, cz2] = f.p(c + 3.1, 4.8);
        const cab = MeshBuilder.CreateBox('jet-bridge-cab', { width: 2.2, height: 1.8, depth: 2.2 }, scene);
        cab.position.set(cx2, 2.6, cz2);
        cab.material = bridgeMat;
        ctx.caster(cab);
        const legPost = MeshBuilder.CreateCylinder('jet-bridge-leg', { height: 2.2, diameter: 0.35 }, scene);
        legPost.position.set((ax + 3 * bx) / 4, 1.1, (az + 3 * bz) / 4);
        legPost.material = bridgeMat;
      }
    } else {
      const corners = [f.p(1, 1), f.p(f.across - 1, 1), f.p(f.across - 1, f.depth - 1), f.p(1, f.depth - 1)];
      yellowLines.push([...corners, corners[0]!]);
    }
    // number at the open side, left of the lead-in line
    const [nx, nz] = f.p(Math.max(2.4, Math.min(3, f.across / 2 - 3)), f.depth - 2.8);
    decal(scene, s.id, nx, -nz, 5, 3, Y.apron + Y.paint + 0.01, '#f2c230', '#14161a');
  }
  if (padIdx.length) {
    const padMesh = orient(meshFrom(scene, 'stands', pads, padIdx, padUv), (x, _y, z) => [x, Y.apron - 1, z]);
    padMesh.material = concrete;
    padMesh.receiveShadows = true;
    padMesh.isPickable = false;
  }
  groundLines(scene, 'stand-lines', yellowLines, 0.6, Y.apron + Y.paint).material = yellow;
  groundLines(scene, 'stand-outlines', redDashes, 0.35, Y.apron + Y.paint).material = red;

  // ---- buildings
  const facade = facadeMaterial(scene, litGlass);
  const ribbed = textured('ribbed', canvasTexture(scene, 'ribbed', 256, 64, (g, W, H) => {
    g.fillStyle = '#b9c0c7';
    g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 6) {
      g.fillStyle = 'rgba(0,0,0,0.13)';
      g.fillRect(x, 0, 2, H);
    }
  }), 0.5, 0.4);
  const roof = textured('roof', canvasTexture(scene, 'roof', 256, 256, (g, W, H) => {
    g.fillStyle = '#8e9196';
    g.fillRect(0, 0, W, H);
    speckle(g, W, H, 4000, 0.15, 2, 9);
    g.strokeStyle = 'rgba(0,0,0,0.15)';
    for (let i = 0; i < W; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, H);
      g.stroke();
    }
  }), 0.8);
  const concreteWall = pbr(scene, 'concrete-wall', '#b5b3ad', 0.85);
  const metal = pbr(scene, 'metal', '#b9bec5', 0.32, 0.8);
  const dark = pbr(scene, 'dark', '#1a1c20', 0.65);
  const glass = pbr(scene, 'glass', '#10161e', 0.06, 0.1);

  for (const s of layout.structures) {
    const b = box3(s);
    if (s.kind === 'terminal' || s.kind === 'cargoHub') {
      const h = s.kind === 'terminal' ? 7 : 9;
      walls(scene, b, h, s.kind === 'terminal' ? facade : ribbed, 15).forEach(ctx.caster);
      const top = MeshBuilder.CreateBox('roof', { width: b.w - 0.2, height: 0.6, depth: b.d - 0.2 }, scene);
      top.position.set(b.cx, h + 0.3, b.cz);
      top.material = roof;
      top.receiveShadows = true;
      ctx.caster(top);
      if (s.kind === 'terminal') {
        const sky = MeshBuilder.CreateBox('skylight', { width: Math.max(1, b.w - 6), height: 0.2, depth: 1.4 }, scene);
        sky.position.set(b.cx, h + 0.7, b.cz);
        sky.material = glass;
      }
      for (let k = 0; k < Math.floor(b.w / 24); k++) {
        const unit = MeshBuilder.CreateBox('hvac', { width: 3, height: 1.2, depth: 2 }, scene);
        unit.position.set(b.x0 + 8 + k * 24, h + 1.2, b.z1 - 4);
        unit.material = metal;
        ctx.caster(unit);
      }
      if (s.w >= 5) decal(scene, s.kind === 'terminal' ? 'TERMINAL' : 'CARGO', b.cx, -b.cz, Math.min(b.w * 0.6, 30), 4, h + 0.62, '#e8eef0', null);
    } else if (s.kind === 'atcTower') {
      tower(scene, b, { concrete: concreteWall, metal, dark, glass: towerGlass(scene, litGlass) }).forEach(ctx.caster);
      decal(scene, 'TWR', b.cx, -(b.z0) + 3, 8, 3, Y.apron, '#cfd8d4', null);
    } else if (s.kind === 'supportBuilding') {
      const label = { rampAgentStation: 'RAMP', adminOffice: 'ADMIN', airlineOffice: 'AIRLINE', fireRescueStation: 'FIRE & RESCUE', fuelFarm: 'FUEL', deIcingPad: 'DE-ICING' }[s.role];
      if (s.role === 'fuelFarm') {
        const n = Math.max(1, Math.floor(s.w / 1.2));
        for (let k = 0; k < n; k++) {
          const tank = MeshBuilder.CreateCylinder('tank', { diameter: Math.min(b.d * 0.7, (b.w / n) * 0.85), height: 4, tessellation: 24 }, scene);
          tank.position.set(b.x0 + (k + 0.5) * (b.w / n), 2, b.cz);
          tank.material = pbr(scene, 'tank', '#e9ebe8', 0.45, 0.2);
          ctx.caster(tank);
        }
      } else if (s.role === 'deIcingPad') {
        const pad = MeshBuilder.CreateGround('de-icing', { width: b.w, height: b.d }, scene);
        pad.position.set(b.cx, Y.apron, b.cz);
        pad.material = concrete;
        pad.receiveShadows = true;
        groundLines(scene, 'de-icing-lines', [[[b.x0 + 1, b.z0 + 1], [b.x1 - 1, b.z0 + 1], [b.x1 - 1, b.z1 - 1], [b.x0 + 1, b.z1 - 1], [b.x0 + 1, b.z0 + 1]]], 0.5, Y.apron + Y.paint).material = paint('paint-blue', '#7fc4ff');
      } else {
        const fire = s.role === 'fireRescueStation';
        const depth = fire ? Math.max(T, b.d - 9) : b.d;
        const body = MeshBuilder.CreateBox('support', { width: b.w, height: fire ? 4 : 3.5, depth }, scene);
        body.position.set(b.cx, fire ? 2 : 1.75, b.z1 - depth / 2);
        body.material = fire ? fireStationMaterial(scene) : concreteWall;
        ctx.caster(body);
        const lid = MeshBuilder.CreateBox('support-roof', { width: b.w + 0.3, height: 0.3, depth: depth + 0.3 }, scene);
        lid.position.set(b.cx, (fire ? 4 : 3.5) + 0.15, b.z1 - depth / 2);
        lid.material = fire ? pbr(scene, 'fire-roof', '#7a2a22', 0.7) : roof;
        if (fire) {
          for (const dx of [4, 11]) {
            const truck = MeshBuilder.CreateBox('fire-truck', { width: 2.6, height: 1.6, depth: 5 }, scene);
            truck.position.set(b.x0 + dx, 0.95, b.z0 + 4);
            truck.material = pbr(scene, 'fire-truck', '#c62828', 0.4, 0, true);
            ctx.caster(truck);
          }
        }
      }
      decal(scene, label, b.cx, -(b.z1) - 1.6, Math.min(b.w, 18), 2.4, Y.apron, '#cfd8d4', null);
    }
  }
  return { lights, litGlass };
}

/** Maps points in a Stand's own frame — u across its open side, v from the back (0) to the open side — onto the ground (x, z). */
function frame(s: TileRect & { facing?: Facing }) {
  const x = s.x * T;
  const y = s.y * T;
  const w = s.w * T;
  const h = s.h * T;
  const facing = s.facing ?? 'south';
  const across = facing === 'south' || facing === 'north' ? w : h;
  const depth = facing === 'south' || facing === 'north' ? h : w;
  const p = (u: number, v: number): [number, number] => {
    switch (facing) {
      case 'north': return [x + w - u, -(y + h - v)];
      case 'east': return [x + v, -(y + u)];
      case 'west': return [x + w - v, -(y + u)];
      default: return [x + u, -(y + v)];
    }
  };
  return { across, depth, p };
}

/** Painted Runway: length along the texture's u (from the forward threshold), width along v. Sizes in world units (2 m). */
function paintRunway(scene: Scene, name: string, len: number, wid: number, n: RunwayName, grass: boolean): Texture {
  const W = 4096;
  const H = Math.max(128, Math.min(512, Math.round((W * wid) / len) * 2));
  const kx = W / len;
  const kz = H / wid;
  const PX = (d: number) => d * kx;
  const PZ = (a: number) => (1 - a / wid) * H;
  return canvasTexture(scene, name, W, H, (g) => {
    const bar = (d: number, a: number, l: number, w: number, colour: string) => {
      g.fillStyle = colour;
      g.fillRect(PX(d), PZ(a + w), l * kx, w * kz);
    };
    const designator = (text: string, d: number, rot: number, size: number, colour: string) => {
      g.save();
      g.translate(PX(d), PZ(wid / 2));
      g.rotate(rot);
      g.scale(kz, kx);
      g.font = `bold ${size}px Arial`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = colour;
      const lines = text.length > 2 ? [text.slice(0, 2), text.slice(2)] : [text];
      lines.forEach((l, i) => g.fillText(l, 0, (i - (lines.length - 1) / 2) * size * 1.05));
      g.restore();
    };
    if (grass) {
      g.fillStyle = '#4f7f3f';
      g.fillRect(0, 0, W, H);
      for (let d = 0; d < len; d += 12) bar(d, 0, 6, wid, 'rgba(255,255,255,0.07)');
      speckle(g, W, H, 30000, 0.15, 2, 3);
      for (let d = 4; d < len - 2; d += 16) {
        bar(d, 0.3, 2.4, 1, '#f2f2ea');
        bar(d, wid - 1.3, 2.4, 1, '#f2f2ea');
      }
      for (let c = 2; c < wid - 1; c += 6) {
        bar(2, c, 1.2, 2, '#f2f2ea');
        bar(len - 3.2, c, 1.2, 2, '#f2f2ea');
      }
      designator(n.forward, 12, Math.PI / 2, 4, '#f2f2ea');
      designator(n.reverse, len - 12, -Math.PI / 2, 4, '#f2f2ea');
      return;
    }
    g.fillStyle = '#3a3c3f';
    g.fillRect(0, 0, W, H);
    speckle(g, W, H, 50000, 0.22, 1.5, 2);
    blots(g, W, H, 100, 0.06, 20, 4);
    const r = rng(3);
    for (const [a, b] of [[10, 70], [len - 70, len - 10]] as const) {
      for (let i = 0; i < 700; i++) {
        g.fillStyle = `rgba(10,10,10,${0.08 + r() * 0.12})`;
        g.fillRect(PX(a + r() * (b - a)), PZ(wid / 2 + (r() - 0.5) * 8), (1 + r() * 6) * kx, Math.max(1, 0.25 * kz));
      }
    }
    const mark = '#efefea';
    bar(0, 0.5, len, 0.4, mark);
    bar(0, wid - 0.9, len, 0.4, mark);
    for (let d = 22; d < len - 22; d += 13) bar(d, wid / 2 - 0.4, 7.5, 0.8, mark);
    for (let k = 0; k < 8; k++) {
      const a = 2 + k * ((wid - 4) / 8);
      bar(1.5, a, 7, 1.4, mark);
      bar(len - 8.5, a, 7, 1.4, mark);
    }
    const aim = Math.min(48, len * 0.2);
    for (const d of [aim, len - aim - 9]) {
      bar(d, wid * 0.22, 9, 2.2, mark);
      bar(d, wid * 0.78 - 2.2, 9, 2.2, mark);
    }
    designator(n.forward, 14, Math.PI / 2, 5, mark);
    designator(n.reverse, len - 14, -Math.PI / 2, 5, mark);
  }, { clamp: true });
}

/** Text painted flat on the ground or a roof (world units), optionally on a plate. */
function decal(scene: Scene, text: string, x: number, y: number, w: number, h: number, height: number, colour: string, plate: string | null): Mesh {
  const W = 256;
  const H = Math.max(32, Math.round((W * h) / w / 8) * 8);
  const tex = canvasTexture(scene, `decal-${text}`, W, H, (g) => {
    g.clearRect(0, 0, W, H);
    if (plate) {
      g.fillStyle = plate;
      g.fillRect(0, 0, W, H);
    }
    g.fillStyle = colour;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = H * 0.78;
    g.font = `700 ${size}px "JetBrains Mono", monospace`;
    while (g.measureText(text).width > W * 0.92 && size > 6) {
      size -= 2;
      g.font = `700 ${size}px "JetBrains Mono", monospace`;
    }
    g.fillText(text, W / 2, H / 2 + 1);
  }, { clamp: true, alpha: !plate });
  const mat = new StandardMaterial(`decal-${text}`, scene);
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = !plate;
  mat.specularColor = Color3.Black();
  mat.emissiveColor = new Color3(0.2, 0.2, 0.2);
  mat.zOffset = -3;
  const m = MeshBuilder.CreateGround(`decal-${text}`, { width: w, height: h }, scene);
  m.position.set(x, height, -y);
  m.material = mat;
  m.receiveShadows = true;
  m.isPickable = false;
  return m;
}

/** Four walls round a rectangle, textured in `uEvery`-unit panels, facing outward. */
function walls(scene: Scene, b: ReturnType<typeof box3>, height: number, mat: PBRMaterial, uEvery: number): Mesh[] {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const side = (ax: number, az: number, bx: number, bz: number) => {
    const i = positions.length / 3;
    const len = Math.hypot(bx - ax, bz - az);
    positions.push(ax, 0, az, bx, 0, bz, bx, height, bz, ax, height, az);
    uvs.push(0, 0, len / uEvery, 0, len / uEvery, 1, 0, 1);
    indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  side(b.x0, b.z0, b.x1, b.z0);
  side(b.x1, b.z0, b.x1, b.z1);
  side(b.x1, b.z1, b.x0, b.z1);
  side(b.x0, b.z1, b.x0, b.z0);
  // each wall faces away from the building's centre
  const m = meshFrom(scene, 'walls', positions, indices, uvs);
  orient(m, (x, y, z) => [b.cx + (x - b.cx) * 0.001, y, b.cz + (z - b.cz) * 0.001]);
  m.material = mat;
  m.receiveShadows = true;
  m.isPickable = false;
  return [m];
}

function facadeMaterial(scene: Scene, lit: PBRMaterial[]): PBRMaterial {
  const draw = (glow: boolean) => (g: CanvasRenderingContext2D, W: number, H: number) => {
    const r = rng(glow ? 21 : 20);
    const mw = W / 12;
    for (let i = 0; i < 12; i++) {
      const x = i * mw;
      if (glow) {
        g.fillStyle = r() < 0.8 ? '#ffd9a0' : '#000';
        g.fillRect(x + 2, 4, mw - 4, H * 0.5 - 8);
        g.fillStyle = r() < 0.85 ? '#ffd9a0' : '#000';
        g.fillRect(x + 2, H * 0.5 + 4, mw - 4, H * 0.5 - 8);
      } else {
        const gr = g.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, '#8fa6bd');
        gr.addColorStop(0.45, '#3d566f');
        gr.addColorStop(0.5, '#2a3340');
        gr.addColorStop(0.55, '#2f4a63');
        gr.addColorStop(1, '#1d2a38');
        g.fillStyle = gr;
        g.fillRect(x, 0, mw, H);
      }
    }
    if (!glow) {
      g.fillStyle = '#d9dcdf';
      for (let i = 0; i <= 12; i++) g.fillRect(i * mw - 1.5, 0, 3, H);
      g.fillRect(0, 0, W, 5);
      g.fillRect(0, H * 0.5 - 3, W, 6);
      g.fillRect(0, H - 4, W, 4);
    }
  };
  const m = pbr(scene, 'facade', '#ffffff', 0.08, 0.25);
  m.albedoTexture = canvasTexture(scene, 'facade', 512, 128, draw(false));
  m.emissiveTexture = canvasTexture(scene, 'facade-lit', 512, 128, draw(true));
  m.emissiveColor = Color3.Black();
  lit.push(m);
  return m;
}

function towerGlass(scene: Scene, lit: PBRMaterial[]): PBRMaterial {
  const m = pbr(scene, 'tower-glass', '#ffffff', 0.05, 0.3);
  m.albedoTexture = canvasTexture(scene, 'tower-glass', 256, 64, (g, W, H) => {
    g.fillStyle = '#1d3346';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#4a6d8a';
    g.fillRect(0, 0, W, H * 0.35);
    g.fillStyle = '#d7dadd';
    for (let i = 0; i <= 8; i++) g.fillRect((i * W) / 8 - 2, 0, 4, H);
  });
  m.emissiveTexture = canvasTexture(scene, 'tower-lit', 16, 16, (g, W, H) => {
    g.fillStyle = '#9fe0b0';
    g.fillRect(0, 0, W, H);
  });
  m.emissiveColor = Color3.Black();
  lit.push(m);
  return m;
}

function fireStationMaterial(scene: Scene): PBRMaterial {
  const m = pbr(scene, 'fire-station', '#ffffff', 0.6);
  m.albedoTexture = canvasTexture(scene, 'fire-station', 512, 128, (g, W, H) => {
    g.fillStyle = '#e7e3dc';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 4; i++) {
      const x = 20 + i * 122;
      g.fillStyle = '#c62828';
      g.fillRect(x, 30, 100, H - 30);
      for (let y = 34; y < H; y += 8) {
        g.fillStyle = 'rgba(0,0,0,0.2)';
        g.fillRect(x, y, 100, 1.5);
      }
    }
  });
  return m;
}

/** The ATC Tower: base building, tapered concrete shaft, catwalk, glass cab, roof and antennas. */
function tower(scene: Scene, b: ReturnType<typeof box3>, m: { concrete: PBRMaterial; metal: PBRMaterial; dark: PBRMaterial; glass: PBRMaterial }): Mesh[] {
  const out: Mesh[] = [];
  const at = (mesh: Mesh, y: number, mat: PBRMaterial) => {
    mesh.position.set(b.cx, y, b.cz);
    mesh.material = mat;
    out.push(mesh);
    return mesh;
  };
  const base = MeshBuilder.CreateBox('tower-base', { width: b.w + 2, height: 4, depth: b.d * 0.6 }, scene);
  base.position.set(b.cx, 2, b.z0 + b.d * 0.3);
  base.material = m.concrete;
  out.push(base);
  at(MeshBuilder.CreateCylinder('tower-shaft', { diameterTop: 3, diameterBottom: 4.2, height: 22, tessellation: 20 }, scene), 11, m.concrete);
  at(MeshBuilder.CreateCylinder('tower-floor', { diameterTop: 5.4, diameterBottom: 3.4, height: 1.5, tessellation: 16 }, scene), 22.6, m.concrete);
  at(MeshBuilder.CreateCylinder('tower-catwalk', { diameter: 7.4, height: 0.25, tessellation: 8 }, scene), 23.5, m.metal);
  at(MeshBuilder.CreateCylinder('tower-cab', { diameterTop: 6.7, diameterBottom: 6, height: 2.6, tessellation: 8 }, scene), 24.9, m.glass);
  at(MeshBuilder.CreateCylinder('tower-roof', { diameter: 7.6, height: 0.5, tessellation: 8 }, scene), 26.45, m.metal);
  const mast = MeshBuilder.CreateCylinder('tower-mast', { diameter: 0.15, height: 4, tessellation: 6 }, scene);
  mast.position.set(b.cx + 1, 28.6, b.cz);
  mast.material = m.metal;
  out.push(mast);
  const dome = MeshBuilder.CreateSphere('tower-dome', { diameter: 1.4, segments: 8 }, scene);
  dome.position.set(b.cx - 1.2, 27.1, b.cz);
  dome.material = m.concrete;
  out.push(dome);
  return out;
}

