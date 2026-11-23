/**
 * Decorative dressing that follows the layout (nothing here touches the simulation): on the landside of every
 * Terminal and Cargo Hub an access road with kerbs, a footpath and street lamps, a car park (or a lorry yard at a Cargo
 * Hub) behind it and one road leading off the map; at both ends of the building a service road from the access road
 * past the building to the apron, with ground equipment parked beside it. Everything keeps to free tiles (clear of
 * structures and Runway end zones) and is skipped where there is no room; it is rebuilt with the airfield.
 */
import { Color3, MeshBuilder, type Mesh, type PBRMaterial, type Scene } from '@babylonjs/core';
import { runwayEndZones, TILE_SIZE, WORLD, type AirportLayout, type Facing, type Structure, type TileRect } from '../sim/layout';
import { TAXIWAY_INSET } from '../sim/markings';
import { pbr } from './aircraftModels';
import { groundLines, groundQuads, thinInstances, type Place } from './geometry';
import type { Area, Planting } from './scenery';
import { blots, canvasTexture, rng, speckle } from './textures';

const T = TILE_SIZE;
const OPPOSITE: Record<Facing, Facing> = { north: 'south', south: 'north', east: 'west', west: 'east' };
/** Heights of the dressing's surfaces above the grass (below the aprons at 0.15). */
const Y = { park: 0.06, road: 0.09, walk: 0.11, service: 0.12, lane: 0.13, paint: 0.025 } as const;

/** What the rest of the airfield needs to know about the dressing. */
export interface Landside {
  /** Ground the dressing covers: the perimeter fence goes round it and no trees grow on it. */
  readonly areas: readonly Area[];
  /** Access roads leading off the map: the fence opens where they cross it. */
  readonly roads: readonly Area[];
  /** Street lamp heads (they glow at night). */
  readonly lamps: readonly Place[];
  /** Verge trees and car park hedges. */
  readonly trees: readonly Planting[];
}

/** One side of a building, by the tile line it lies on: u counts tiles along it, k tiles away from it (0 touches it). */
interface Side {
  readonly side: Facing;
  readonly edge: number;
}

const tileAt = (f: Side, u: number, k: number): [number, number] => {
  switch (f.side) {
    case 'north': return [u, f.edge - 1 - k];
    case 'south': return [u, f.edge + k];
    case 'west': return [f.edge - 1 - k, u];
    default: return [f.edge + k, u];
  }
};
/** World (x, z) of the point `a` world units along the side and `d` away from it. */
const pointAt = (f: Side, a: number, d: number): [number, number] => {
  const e = f.edge * T;
  switch (f.side) {
    case 'north': return [a, -(e - d)];
    case 'south': return [a, -(e + d)];
    case 'west': return [e - d, -a];
    default: return [e + d, -a];
  }
};
const areaAt = (f: Side, a0: number, a1: number, d0: number, d1: number): Area => {
  const [xa, za] = pointAt(f, a0, d0);
  const [xb, zb] = pointAt(f, a1, d1);
  return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb) };
};
/** A line on the ground from (a0, d0) to (a1, d1) in the side's terms. */
const lineAt = (f: Side, a0: number, d0: number, a1: number, d1: number) => [pointAt(f, a0, d0), pointAt(f, a1, d1)];
/** A box `across` wide (along the side), `length` long (away from it) and `height` tall standing at (a, d, y). */
const boxAt = (f: Side, a: number, d: number, y: number, across: number, height: number, length: number): Place => {
  const [x, z] = pointAt(f, a, d);
  const ns = f.side === 'north' || f.side === 'south';
  return [x, y + height / 2, z, ns ? across : length, height, ns ? length : across];
};
const spanOf = (s: TileRect, side: Facing): [number, number] => (side === 'north' || side === 'south' ? [s.x, s.x + s.w] : [s.y, s.y + s.h]);
const depthOf = (s: TileRect, side: Facing) => (side === 'north' || side === 'south' ? s.h : s.w);
const edgeOf = (s: TileRect, side: Facing) => ({ north: s.y, south: s.y + s.h, west: s.x, east: s.x + s.w })[side];

interface Strip {
  readonly f: Side;
  u0: number;
  u1: number;
  feeder?: { u: number; depth: number };
  /** Where the outer kerb and edge line open (entries, the road off the map) and the inner ones (service roads). */
  gaps: Array<[number, number]>;
  inner: Array<[number, number]>;
}

export function buildLandside(scene: Scene, caster: (m: Mesh) => void, layout: AirportLayout, airsideOf: (s: TileRect) => Facing, concrete: PBRMaterial, ground: Area): Landside {
  const r = rng(29);
  const key = (x: number, y: number) => `${x},${y}`;
  const taken = new Set<string>();
  const apron = new Map<string, Structure['kind']>();
  const mark = (t: TileRect, pad = 0) => {
    for (let x = t.x - pad; x < t.x + t.w + pad; x++) for (let y = t.y - pad; y < t.y + t.h + pad; y++) taken.add(key(x, y));
  };
  for (const s of layout.structures) {
    mark(s);
    if (s.kind === 'taxiway' || s.kind === 'stand' || s.kind === 'holdingBay') for (let x = s.x; x < s.x + s.w; x++) for (let y = s.y; y < s.y + s.h; y++) apron.set(key(x, y), s.kind);
  }
  for (const rw of layout.runways) {
    mark(rw, 1);
    for (const z of runwayEndZones(rw)) mark(z, 1);
  }
  const inWorld = (x: number, y: number) => x >= WORLD.x0 && x < WORLD.x0 + WORLD.width && y >= WORLD.y0 && y < WORLD.y0 + WORLD.height;
  const freeAt = (f: Side, u: number, k: number) => {
    const [x, y] = tileAt(f, u, k);
    return inWorld(x, y) && !taken.has(key(x, y));
  };
  const claim = (f: Side, u: number, k: number) => taken.add(key(...tileAt(f, u, k)));
  const runs = (from: number, to: number, ok: (u: number) => boolean, min: number) => {
    const out: Array<[number, number]> = [];
    let start: number | null = null;
    for (let u = from; u <= to; u++) {
      const good = u < to && ok(u);
      if (good && start === null) start = u;
      if (!good && start !== null) {
        if (u - start >= min) out.push([start, u]);
        start = null;
      }
    }
    return out;
  };

  const buildings = layout.structures
    .filter((s) => s.kind === 'terminal' || s.kind === 'cargoHub')
    .map((s) => {
      const side = OPPOSITE[airsideOf(s)];
      const [u0, u1] = spanOf(s, side);
      return { s, cargo: s.kind === 'cargoHub', f: { side, edge: edgeOf(s, side) } as Side, u0, u1, depth: depthOf(s, side) };
    });

  // access roads: two tiles deep along the landside, a little past the building's ends where there is room
  const strips: Strip[] = [];
  const roadOk = (f: Side, u: number) => freeAt(f, u, 0) && freeAt(f, u, 1);
  for (const b of buildings) {
    const best = runs(b.u0 - 3, b.u1 + 3, (u) => roadOk(b.f, u), 3)
      .filter(([a, c]) => c > b.u0 && a < b.u1)
      .sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0];
    if (!best) continue;
    for (let u = best[0]; u < best[1]; u++) claim(b.f, u, 0), claim(b.f, u, 1);
    strips.push({ f: b.f, u0: best[0], u1: best[1], gaps: [], inner: [] });
  }
  // roads on the same line join up across short free gaps
  strips.sort((p, q) => (p.f.side + p.f.edge).localeCompare(q.f.side + q.f.edge) || p.u0 - q.u0);
  for (let i = 0; i < strips.length - 1; i++) {
    const a = strips[i]!;
    const b = strips[i + 1]!;
    if (a.f.side !== b.f.side || a.f.edge !== b.f.edge || b.u0 - a.u1 > 16) continue;
    let ok = true;
    for (let u = a.u1; u < b.u0; u++) ok &&= roadOk(a.f, u);
    if (!ok) continue;
    for (let u = a.u1; u < b.u0; u++) claim(a.f, u, 0), claim(a.f, u, 1);
    a.u1 = Math.max(a.u1, b.u1);
    strips.splice(i + 1, 1);
    i--;
  }
  const stripAt = (f: Side, u: number) => strips.find((s) => s.f.side === f.side && s.f.edge === f.edge && u >= s.u0 && u < s.u1);

  // car parks (lorry yards at Cargo Hubs) behind the access road, in front of the building
  const parks: Array<{ f: Side; u0: number; u1: number; cargo: boolean; strip: Strip }> = [];
  for (const b of buildings) {
    const strip = stripAt(b.f, Math.max(b.u0, Math.min(b.u1 - 1, (b.u0 + b.u1) >> 1))) ?? strips.find((s) => s.f.side === b.f.side && s.f.edge === b.f.edge && s.u1 > b.u0 && s.u0 < b.u1);
    if (!strip) continue;
    const deep = b.cargo ? 2 : 3;
    const okPark = (u: number) => {
      for (let k = 2; k < 2 + deep; k++) if (!freeAt(b.f, u, k)) return false;
      return true;
    };
    for (const [u0, u1] of runs(Math.max(b.u0, strip.u0), Math.min(b.u1, strip.u1), okPark, 3)) {
      for (let u = u0; u < u1; u++) for (let k = 2; k < 2 + deep; k++) claim(b.f, u, k);
      parks.push({ f: b.f, u0, u1, cargo: b.cargo, strip });
      strip.gaps.push([u0 * T + 0.5, u0 * T + 4.5], [u1 * T - 4.5, u1 * T - 0.5]);
    }
  }

  // one road off the map from an end of each access road
  const edgeDepth = (f: Side) => {
    const e = f.edge * T;
    return ({ north: ground.z1 + -e, south: -e - ground.z0, west: e - ground.x0, east: ground.x1 - e })[f.side] - 4;
  };
  const roads: Area[] = [];
  for (const s of strips) {
    for (const u of [s.u0, s.u1 - 1]) {
      let k = 2;
      let out = false;
      for (; k < 200; k++) {
        const [x, y] = tileAt(s.f, u, k);
        if (!inWorld(x, y)) {
          out = true;
          break;
        }
        if (taken.has(key(x, y))) break;
      }
      if (!out) continue;
      for (let j = 2; j < k; j++) claim(s.f, u, j);
      s.feeder = { u, depth: edgeDepth(s.f) };
      s.gaps.push([u * T, u * T + T]);
      break;
    }
  }

  // ---- drawing
  const asphaltTex = canvasTexture(scene, 'asphalt', 512, 512, (g, W, H) => {
    g.fillStyle = '#45474a';
    g.fillRect(0, 0, W, H);
    speckle(g, W, H, 30000, 0.2, 1.5, 31);
    blots(g, W, H, 30, 0.08, 40, 32);
  });
  const asphalt = pbr(scene, 'asphalt', '#ffffff', 0.9);
  asphalt.albedoTexture = asphaltTex;
  const serviceAsphalt = pbr(scene, 'service-asphalt', '#9a9a9a', 0.85);
  serviceAsphalt.albedoTexture = asphaltTex;
  const paint = (name: string, hex: string) => {
    const m = pbr(scene, name, hex, 0.6);
    m.zOffset = -2;
    return m;
  };
  const white = paint('road-white', '#e9e9e4');
  const red = paint('equipment-red', '#b8352a');
  const quads = { park: [] as Area[], road: [] as Area[], walk: [] as Area[], service: [] as Area[], lane: [] as Area[] };
  const lines = { park: [] as Array<Array<[number, number]>>, road: [] as Array<Array<[number, number]>>, lane: [] as Array<Array<[number, number]>>, red: [] as Array<Array<[number, number]>> };
  const kerbs: Place[] = [];
  const poles: Place[] = [];
  const arms: Place[] = [];
  const lamps: Place[] = [];
  const trees: Planting[] = [];
  const areas: Area[] = [];
  const bodies: Place[] = [];
  const bodyColours: number[] = [];
  const cabins: Place[] = [];
  const kit: Place[] = [];
  const kitColours: number[] = [];
  const chassis: Place[] = [];
  const colour = (list: number[], hex: string, jitter = 0.08) => {
    const c = Color3.FromHexString(hex).scale(1 - jitter / 2 + r() * jitter);
    list.push(c.r, c.g, c.b, 1);
  };
  /** Segments of [a0, a1] outside the gaps. */
  const cut = (a0: number, a1: number, gaps: ReadonlyArray<[number, number]>) => {
    let segs: Array<[number, number]> = [[a0, a1]];
    for (const [g0, g1] of gaps) segs = segs.flatMap(([s0, s1]) => (g1 <= s0 || g0 >= s1 ? [[s0, s1]] : ([[s0, g0], [g1, s1]] as Array<[number, number]>).filter(([p, q]) => q - p > 0.3)));
    return segs;
  };
  const dashes = (f: Side, a0: number, a1: number, d: number, on: number, off: number, into: Array<Array<[number, number]>>) => {
    for (let a = a0 + off / 2; a + on <= a1; a += on + off) into.push(lineAt(f, a, d, a + on, d));
  };
  const dashesAway = (f: Side, a: number, d0: number, d1: number, on: number, off: number, into: Array<Array<[number, number]>>) => {
    for (let d = d0 + off / 2; d + on <= d1; d += on + off) into.push(lineAt(f, a, d, a, d + on));
  };

  // service roads from the access road past each end of the building to the apron, ground equipment beside them
  const equipment = ['#e8b923', '#f1f1ef', '#d9d9d6', '#2f6db3', '#e06c1f'];
  for (const b of buildings) {
    for (const end of [b.u0 - 1, b.u1]) {
      const strip = stripAt(b.f, end);
      if (!strip) continue;
      let ok = true;
      for (let k = -1; k >= -b.depth && ok; k--) ok = freeAt(b.f, end, k);
      if (!ok) continue;
      let reached: number | null = null;
      for (let k = -b.depth - 1; k >= -b.depth - 4; k--) {
        const t = tileAt(b.f, end, k);
        const kind = apron.get(key(...t));
        if (kind) {
          reached = k;
          break;
        }
        if (!freeAt(b.f, end, k)) break;
      }
      if (reached === null) continue;
      for (let k = -1; k > reached; k--) claim(b.f, end, k);
      const { f } = b;
      const kind = apron.get(key(...tileAt(f, end, reached)));
      const dEnd = (reached + 1) * T - (kind === 'taxiway' ? TAXIWAY_INSET * T + 1 : 1);
      const dFace = -b.depth * T;
      // the lane on the outer side of the column; equipment between it and the building, clear of the flood mast
      const before = end < b.u0;
      const face = before ? b.u0 * T : b.u1 * T;
      const s = before ? -1 : 1;
      const [l0, l1] = [face + s * 3.8, face + s * 7.6].sort((p, q) => p - q) as [number, number];
      const [e0, e1] = [face + s * 0.5, face + s * 2.7].sort((p, q) => p - q) as [number, number];
      const [c0, c1] = [end * T, end * T + T];
      strip.inner.push([l0, l1]);
      areas.push(areaAt(f, c0, c1, dEnd, 2));
      quads.service.push(areaAt(f, c0 + 0.2, c1 - 0.2, dEnd, dFace));
      quads.lane.push(areaAt(f, l0, l1, dEnd, 2));
      lines.lane.push(lineAt(f, l0 + 0.25, dEnd, l0 + 0.25, 1.5), lineAt(f, l1 - 0.25, dEnd, l1 - 0.25, 1.5));
      dashesAway(f, (l0 + l1) / 2, dEnd, 1.5, 1, 1.5, lines.lane);
      // equipment area: a red outline, a row of container dollies, tugs and a ground power unit
      const top = dFace - 4.6;
      const bottom = dEnd + 0.8;
      if (top - bottom < 3) continue;
      lines.red.push(lineAt(f, e0, top, e0, bottom), lineAt(f, e1, top, e1, bottom), lineAt(f, e0, top, e1, top), lineAt(f, e0, bottom, e1, bottom));
      const ec = (e0 + e1) / 2;
      for (let d = top - 0.8; d > bottom + 0.6;) {
        const pick = r();
        if (pick < 0.5) {
          // a short train of container dollies
          const cars = 2 + Math.floor(r() * 3);
          for (let i = 0; i < cars && d > bottom + 0.6; i++, d -= 1.15) {
            chassis.push(boxAt(f, ec, d - 0.5, 0.1, 1.0, 0.25, 1.0));
            if (r() < 0.8) {
              colour(kitColours, r() < 0.7 ? '#b9bcc0' : '#8f9297');
              kit.push(boxAt(f, ec, d - 0.5, 0.35, 0.8, 0.8, 0.78));
            }
          }
          d -= 0.6;
        } else if (pick < 0.8) {
          // a tug
          colour(kitColours, equipment[Math.floor(r() * equipment.length)]!);
          kit.push(boxAt(f, ec, d - 0.7, 0.15, 0.9, 0.45, 1.4));
          colour(kitColours, '#2b2d30');
          kit.push(boxAt(f, ec, d - 1.0, 0.6, 0.8, 0.35, 0.6));
          d -= 2.2;
        } else {
          // a ground power unit
          colour(kitColours, r() < 0.5 ? '#d9d9d6' : '#e8b923');
          kit.push(boxAt(f, ec, d - 0.75, 0.15, 0.85, 0.75, 1.5));
          d -= 2.4;
        }
      }
    }
  }

  for (const s of strips) {
    const { f } = s;
    const a0 = s.u0 * T;
    const a1 = s.u1 * T;
    areas.push(areaAt(f, a0, a1, 0, 2 * T));
    quads.walk.push(areaAt(f, a0, a1, 0, 1.5));
    quads.road.push(areaAt(f, a0, a1, 1.5, 9.5));
    const ns = f.side === 'north' || f.side === 'south';
    const kerb = (p0: number, p1: number, d: number) => {
      const [x, z] = pointAt(f, (p0 + p1) / 2, d);
      kerbs.push([x, Y.road + 0.06, z, ns ? p1 - p0 : 0.3, 0.12, ns ? 0.3 : p1 - p0]);
    };
    for (const [p, q] of cut(a0, a1, s.inner)) kerb(p, q, 1.5);
    for (const [p, q] of cut(a0, a1, s.gaps)) kerb(p, q, 9.5);
    for (const [p, q] of cut(a0, a1, s.inner)) lines.road.push(lineAt(f, p, 1.9, q, 1.9));
    for (const [p, q] of cut(a0, a1, s.gaps)) lines.road.push(lineAt(f, p, 9.1, q, 9.1));
    dashes(f, a0, a1, 5.5, 2, 3, lines.road);
    // street lamps on the verge, reaching over the road; verge trees between them
    for (let a = a0 + 5; a < a1 - 3; a += 14) {
      if (s.gaps.some(([g0, g1]) => a > g0 - 1.5 && a < g1 + 1.5)) continue;
      const [x, z] = pointAt(f, a, 10.4);
      poles.push([x, 3, z, 1, 6, 1]);
      arms.push(boxAt(f, a, 9.4, 5.8, 0.15, 0.15, 2.2));
      const [hx, hz] = pointAt(f, a, 8.4);
      lamps.push([hx, 5.75, hz, ns ? 0.5 : 0.9, 0.15, ns ? 0.9 : 0.5]);
      const ta = a + 7;
      if (ta < a1 - 3 && !s.gaps.some(([g0, g1]) => ta > g0 - 3 && ta < g1 + 3)) {
        const [tx, tz] = pointAt(f, ta, 13 + r() * 1.5);
        trees.push({ x: tx, z: tz, species: r() < 0.7 ? 'lime' : 'birch', size: 0.65 + r() * 0.2 });
      }
    }
    if (s.feeder) {
      const fa = s.feeder.u * T;
      const fd = s.feeder.depth;
      quads.road.push(areaAt(f, fa, fa + T, 1.5, fd));
      const road = areaAt(f, fa, fa + T, 2 * T, fd);
      roads.push(road);
      lines.road.push(lineAt(f, fa + 0.4, 9.5, fa + 0.4, fd), lineAt(f, fa + T - 0.4, 9.5, fa + T - 0.4, fd));
      dashesAway(f, fa + T / 2, 10, fd, 2, 3, lines.road);
      // lamps along the first stretch, then trees lining it now and then
      for (let d = 24; d < fd - 4; d += 16) {
        if (d < 2 * T + 64) {
          const [x, z] = pointAt(f, fa + T + 1.2, d);
          poles.push([x, 3, z, 1, 6, 1]);
          arms.push(boxAt(f, fa + T, d, 5.8, 2.2, 0.15, 0.15));
          const [hx, hz] = pointAt(f, fa + T - 1, d);
          lamps.push([hx, 5.75, hz, ns ? 0.9 : 0.5, 0.15, ns ? 0.5 : 0.9]);
        } else if (r() < 0.6) {
          for (const side of [-3.5, T + 3.5]) {
            const [x, z] = pointAt(f, fa + side, d + r() * 6);
            trees.push({ x, z, species: r() < 0.6 ? 'poplar' : 'oak', size: 0.75 + r() * 0.3 });
          }
        }
      }
    }
  }

  const carColours = ['#f1f1ef', '#f1f1ef', '#c4c7cb', '#9aa0a6', '#2b2d30', '#16181b', '#1f3f73', '#8d1f1f', '#2f4a3a', '#c9b79a', '#4b5a6b'];
  for (const p of parks) {
    const { f } = p;
    const a0 = p.u0 * T + 0.5;
    const a1 = p.u1 * T - 0.5;
    areas.push(areaAt(f, a0, a1, 2 * T, (p.cargo ? 4 : 5) * T));
    // entries from the access road at both ends
    for (const [g0, g1] of [[a0, a0 + 4], [a1 - 4, a1]] as const) quads.park.push(areaAt(f, g0, g1, 9.5, 2 * T + 1));
    if (p.cargo) {
      // a lorry yard: concrete, articulated lorries parked side by side, trailers towards the road
      const d0 = 2 * T + 1;
      const d1 = 4 * T - 1;
      quads.service.push(areaAt(f, a0, a1, d0, d1));
      for (let a = a0 + 5; a + 2 < a1 - 4; a += 3) {
        if (r() < 0.35) continue;
        lines.park.push(lineAt(f, a - 0.15, d0 + 1, a - 0.15, d0 + 9));
        const ac = a + 1.35;
        colour(bodyColours, ['#e9eaea', '#d8dadc', '#1f3f73', '#b7bcc2', '#e9eaea'][Math.floor(r() * 5)]!);
        bodies.push(boxAt(f, ac, d0 + 1 + 3.5, 0.6, 1.25, 1.95, 7));
        colour(bodyColours, ['#c8ccd0', '#8d1f1f', '#1f3f73', '#f1f1ef', '#2b2d30'][Math.floor(r() * 5)]!);
        bodies.push(boxAt(f, ac, d0 + 9.4, 0.3, 1.25, 1.55, 1.3));
        chassis.push(boxAt(f, ac, d0 + 5, 0.05, 1.1, 0.6, 9.4));
      }
      for (let a = a0 + 1; a < a1 - 1; a += 2.6) {
        const [x, z] = pointAt(f, a, d1 + 2);
        trees.push({ x, z, species: 'bush', size: 0.7 + r() * 0.2, stretch: 1.4, yaw: f.side === 'north' || f.side === 'south' ? Math.PI / 2 : 0 });
      }
      continue;
    }
    // car park: four rows of bays (two back to back in the middle) with two aisles
    const rows: Array<[number, number]> = [[17, 19.5], [23.5, 26], [26, 28.5], [32.5, 35]];
    quads.park.push(areaAt(f, a0, a1, 16.5, 35.5));
    const b0 = a0 + 4.5;
    const n = Math.floor((a1 - 4.5 - b0) / 1.3);
    for (const [d0, d1] of [[17, 19.5], [23.5, 28.5], [32.5, 35]] as const) {
      for (let i = 0; i <= n; i++) lines.park.push(lineAt(f, b0 + i * 1.3, d0, b0 + i * 1.3, d1));
    }
    lines.park.push(lineAt(f, b0, 26, b0 + n * 1.3, 26));
    rows.forEach(([d0, d1], row) => {
      for (let i = 0; i < n; i++) {
        if (r() < (row === 0 ? 0.15 : 0.3 + row * 0.08)) continue;
        const a = b0 + i * 1.3 + 0.65;
        const nose = row % 2 === 0 ? 1 : -1; // parked nose-in from the aisle
        const dc = (d0 + d1) / 2;
        colour(bodyColours, carColours[Math.floor(r() * carColours.length)]!, 0.1);
        bodies.push(boxAt(f, a, dc, 0.12, 0.9, 0.48, 2.2));
        cabins.push(boxAt(f, a, dc - nose * 0.15, 0.58, 0.8, 0.34, 1.15));
      }
    });
    // a hedge with a few trees along the back
    for (let a = a0 + 1; a < a1 - 1; a += 2.4) {
      const [x, z] = pointAt(f, a, 37.5);
      trees.push({ x, z, species: 'bush', size: 0.75 + r() * 0.2, stretch: 1.4, yaw: f.side === 'north' || f.side === 'south' ? Math.PI / 2 : 0 });
      if (r() < 0.18) trees.push({ x: x + (r() - 0.5), z: z + (r() - 0.5), species: r() < 0.5 ? 'lime' : 'oak', size: 0.7 + r() * 0.25 });
    }
  }

  const surface = (name: string, list: Area[], y: number, mat: PBRMaterial) => {
    if (!list.length) return;
    const m = groundQuads(scene, name, list.map((a) => [a.x0, a.z0, a.x1, a.z1] as const), y, 16);
    m.material = mat;
    m.receiveShadows = true;
    m.isPickable = false;
  };
  surface('car-parks', quads.park, Y.park, asphalt);
  surface('roads', quads.road, Y.road, asphalt);
  surface('footpaths', quads.walk, Y.walk, concrete);
  surface('service-paving', quads.service, Y.service, concrete);
  surface('service-roads', quads.lane, Y.lane, serviceAsphalt);
  const paintLines = (name: string, list: Array<Array<[number, number]>>, width: number, y: number, mat: PBRMaterial) => {
    if (!list.length) return;
    const m = groundLines(scene, name, list, width, y);
    m.material = mat;
    m.isPickable = false;
  };
  paintLines('park-lines', lines.park, 0.12, Y.park + Y.paint, white);
  paintLines('road-lines', lines.road, 0.15, Y.road + Y.paint, white);
  paintLines('lane-lines', lines.lane, 0.15, Y.lane + Y.paint, white);
  paintLines('equipment-lines', lines.red, 0.15, Y.service + Y.paint, red);
  const boxes = (name: string, places: Place[], mat: PBRMaterial, colours?: number[], cast = true) => {
    if (!places.length) return;
    const m = MeshBuilder.CreateBox(name, { size: 1 }, scene);
    m.material = mat;
    m.isPickable = false;
    m.receiveShadows = true;
    thinInstances(m, places, colours && new Float32Array(colours));
    if (cast) caster(m);
  };
  boxes('kerbs', kerbs, pbr(scene, 'kerb', '#c2c2bc', 0.8), undefined, false);
  boxes('vehicle-bodies', bodies, pbr(scene, 'car-paint', '#ffffff', 0.3, 0, true), bodyColours);
  boxes('vehicle-cabins', cabins, pbr(scene, 'car-glass', '#1c2229', 0.12, 0, true));
  boxes('ground-kit', kit, pbr(scene, 'ground-kit', '#ffffff', 0.5), kitColours);
  boxes('chassis', chassis, pbr(scene, 'chassis', '#26282b', 0.7));
  boxes('lamp-arms', arms, pbr(scene, 'lamp-steel', '#8d9298', 0.5, 0.2));
  if (poles.length) {
    const pole = MeshBuilder.CreateCylinder('lamp-poles', { height: 1, diameterTop: 0.12, diameterBottom: 0.22, tessellation: 8 }, scene);
    pole.material = pbr(scene, 'lamp-pole', '#8d9298', 0.5, 0.2);
    pole.isPickable = false;
    caster(thinInstances(pole, poles));
  }
  return { areas, roads, lamps, trees };
}
