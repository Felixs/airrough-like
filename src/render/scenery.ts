/**
 * The countryside round the airfield: the grass (mown in bands inside the fence, a patchwork of fields outside it, with
 * fine grass detail on top) and the trees (several species, in hedgerows along field edges, in copses and alone).
 * Purely decorative: built from the fence line and the areas the landside dressing covers.
 */
import { Color3, Mesh, MeshBuilder, Texture, VertexData, type Scene } from '@babylonjs/core';
import { pbr } from './aircraftModels';
import { thinInstances, type Place } from './geometry';
import { canvasTexture, rng } from './textures';

/** A rectangle on the ground in world x / z (x0 < x1, z0 < z1). */
export interface Area {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

export type Species = 'oak' | 'lime' | 'birch' | 'pine' | 'poplar' | 'bush';

/** One tree or bush: where, which species and how big (1 = the species' usual size). */
export interface Planting {
  readonly x: number;
  readonly z: number;
  readonly species: Species;
  readonly size: number;
  /** Stretch along `yaw` (hedge bushes run together along the hedge). */
  readonly stretch?: number;
  readonly yaw?: number;
}

/** Field boundaries: the farmland outside the fence is cut into fields along these lines. */
export interface Fields {
  readonly xs: readonly number[];
  readonly zs: readonly number[];
}

const inside = (a: Area, x: number, z: number, pad = 0) => x > a.x0 - pad && x < a.x1 + pad && z > a.z0 - pad && z < a.z1 + pad;

export function fieldGrid(ground: Area, seed = 5): Fields {
  const r = rng(seed);
  const cut = (a: number, b: number) => {
    const out: number[] = [];
    for (let v = a + 30 + r() * 40; v < b - 30; v += 50 + r() * 70) out.push(v);
    return out;
  };
  return { xs: cut(ground.x0, ground.x1), zs: cut(ground.z0, ground.z1) };
}

/**
 * The grass: one large painted map over the whole ground (fields of slightly different greens, soft patches, the
 * airfield's mown bands inside the fence) with a fine repeating grass detail laid over it, so nothing repeats visibly.
 */
export function buildGrass(scene: Scene, ground: Area, airfield: Area, fields: Fields): Mesh {
  const GW = ground.x1 - ground.x0;
  const GD = ground.z1 - ground.z0;
  const S = 2048;
  // canvas x = east, canvas y = south (the top of the canvas is the north edge of the ground)
  const px = (x: number) => ((x - ground.x0) / GW) * S;
  const py = (z: number) => ((ground.z1 - z) / GD) * S;
  const map = canvasTexture(scene, 'grass-map', S, S, (g) => {
    const r = rng(17);
    g.fillStyle = '#5b7838';
    g.fillRect(0, 0, S, S);
    // fields: each its own green (a few hay-coloured), some with faint rows along one axis
    const tones = ['#5b7838', '#62803c', '#557236', '#6a843f', '#4f6c33', '#71883f', '#5f7a3a', '#7d8a46'];
    const xs = [ground.x0, ...fields.xs, ground.x1];
    const zs = [ground.z0, ...fields.zs, ground.z1];
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < zs.length - 1; j++) {
        const [x0, x1, z0, z1] = [xs[i]!, xs[i + 1]!, zs[j]!, zs[j + 1]!];
        g.globalAlpha = 0.75;
        g.fillStyle = r() < 0.06 ? '#8f8c4e' : tones[Math.floor(r() * tones.length)]!;
        g.fillRect(px(x0), py(z1), px(x1) - px(x0), py(z0) - py(z1));
        if (r() < 0.45) {
          const along = r() < 0.5;
          const step = 3 + r() * 3;
          g.globalAlpha = 0.07;
          for (let k = 0, v = along ? x0 : z0; v < (along ? x1 : z1); v += step, k++) {
            g.fillStyle = k % 2 ? '#ffffff' : '#000000';
            if (along) g.fillRect(px(v), py(z1), Math.max(1, px(v + step / 2) - px(v)), py(z0) - py(z1));
            else g.fillRect(px(x0), py(v + step / 2), px(x1) - px(x0), Math.max(1, py(v) - py(v + step / 2)));
          }
        }
      }
    }
    // soft patches across everything: lusher, drier and darker ground at several scales
    for (let i = 0; i < 700; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = (i < 120 ? 60 : i < 400 ? 25 : 8) * (0.5 + r());
      const tint = r();
      const c = tint < 0.4 ? '40,60,20' : tint < 0.7 ? '150,150,80' : '20,35,10';
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, `rgba(${c},${0.05 + r() * 0.09})`);
      grd.addColorStop(1, `rgba(${c},0)`);
      g.globalAlpha = 1;
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // the airfield inside the fence: kept short, mown in wide light and dark bands running east–west
    g.globalAlpha = 0.85;
    g.fillStyle = '#5e7c39';
    g.fillRect(px(airfield.x0), py(airfield.z1), px(airfield.x1) - px(airfield.x0), py(airfield.z0) - py(airfield.z1));
    g.globalAlpha = 1;
    for (let k = 0, z = airfield.z0; z < airfield.z1; z += 7, k++) {
      g.fillStyle = k % 2 ? 'rgba(255,255,230,0.06)' : 'rgba(0,20,0,0.06)';
      g.fillRect(px(airfield.x0), py(Math.min(z + 7, airfield.z1)), px(airfield.x1) - px(airfield.x0), py(z) - py(Math.min(z + 7, airfield.z1)));
    }
    g.globalAlpha = 1;
  }, { clamp: true });
  // fine detail: grey around mid-grey (neutral), repeated every 10 world units over the map
  const detail = canvasTexture(scene, 'grass-detail', 256, 256, (g, W, H) => {
    g.fillStyle = 'rgb(128,128,128)';
    g.fillRect(0, 0, W, H);
    const r = rng(23);
    for (let i = 0; i < 9000; i++) {
      const v = Math.round(128 + (r() - 0.5) * 70);
      g.strokeStyle = `rgba(${v},${v},${v},0.6)`;
      g.lineWidth = 1 + r();
      const x = r() * W;
      const y = r() * H;
      const a = -Math.PI / 2 + (r() - 0.5) * 1.2;
      const l = 2 + r() * 5;
      for (const [ox, oy] of [[0, 0], [W, 0], [-W, 0], [0, H], [0, -H]] as const) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
        g.stroke();
      }
    }
  }, { u: GW / 10, v: GD / 10 });
  const grass = MeshBuilder.CreateGround('grass', { width: GW, height: GD }, scene);
  grass.position.set((ground.x0 + ground.x1) / 2, 0, (ground.z0 + ground.z1) / 2);
  const mat = pbr(scene, 'grass', '#ffffff', 0.95);
  mat.albedoTexture = map;
  map.wrapU = Texture.CLAMP_ADDRESSMODE;
  map.wrapV = Texture.CLAMP_ADDRESSMODE;
  mat.detailMap.isEnabled = true;
  mat.detailMap.texture = detail;
  mat.detailMap.diffuseBlendLevel = 0.9;
  mat.detailMap.roughnessBlendLevel = 0;
  mat.detailMap.bumpLevel = 0;
  grass.material = mat;
  grass.receiveShadows = true;
  grass.isPickable = false;
  return grass;
}

/**
 * Trees outside the fence: hedgerows along some field edges (dense bushes with a tree now and then), copses of
 * broadleaves and pines, and single trees. `clear(x, z, r)` is true where nothing may grow (the airfield, the roads).
 */
export function plantCountryside(ground: Area, fields: Fields, centre: readonly [number, number], clear: (x: number, z: number, r: number) => boolean): Planting[] {
  const r = rng(42);
  const out: Planting[] = [];
  const edge = 12;
  const ok = (x: number, z: number, rad: number) => inside(ground, x, z, -edge) && !clear(x, z, rad);
  const near = (x: number, z: number) => Math.hypot(x - centre[0], z - centre[1]);
  const broadleaf = (): Species => {
    const k = r();
    return k < 0.45 ? 'oak' : k < 0.75 ? 'lime' : k < 0.9 ? 'birch' : 'poplar';
  };
  const add = (x: number, z: number, species: Species, size: number, extra: Partial<Planting> = {}) => {
    if (ok(x, z, 2.5 * size)) out.push({ x, z, species, size, ...extra });
  };
  // hedgerows along field edges near the airfield
  const xs = [ground.x0, ...fields.xs, ground.x1];
  const zs = [ground.z0, ...fields.zs, ground.z1];
  const hedge = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(bx - ax, bz - az);
    const poplars = r() < 0.2;
    let nextTree = 4 + r() * 10;
    for (let d = 0; d < len; d += 2.6 + r() * 0.8) {
      const t = d / len;
      const x = ax + (bx - ax) * t + (r() - 0.5) * 0.8;
      const z = az + (bz - az) * t + (r() - 0.5) * 0.8;
      if (near(x, z) > 520) continue;
      if (r() < 0.08) continue; // gaps
      add(x, z, 'bush', 0.8 + r() * 0.5, { stretch: 1.5, yaw: yaw + (r() - 0.5) * 0.3 });
      if (d >= nextTree) {
        add(x + (r() - 0.5) * 1.5, z + (r() - 0.5) * 1.5, poplars ? 'poplar' : broadleaf(), 0.8 + r() * 0.5);
        nextTree = d + (poplars ? 5 : 8 + r() * 16);
      }
    }
  };
  for (let i = 1; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) if (r() < 0.45) hedge(xs[i]!, zs[j]!, xs[i]!, zs[j + 1]!);
  }
  for (let j = 1; j < zs.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) if (r() < 0.45) hedge(xs[i]!, zs[j]!, xs[i + 1]!, zs[j]!);
  }
  // copses: a dense middle and a ragged edge, broadleaves with some pines, bushes round the rim
  for (let c = 0; c < 22; c++) {
    const cx = ground.x0 + r() * (ground.x1 - ground.x0);
    const cz = ground.z0 + r() * (ground.z1 - ground.z0);
    if (clear(cx, cz, 25)) continue;
    const rad = 14 + r() * 26;
    const pines = r() < 0.35 ? 0.7 : 0.15;
    const n = Math.round(rad * (0.9 + r() * 0.6));
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2;
      const d = rad * Math.sqrt(r());
      const rim = d > rad * 0.8;
      add(cx + Math.cos(a) * d * 1.3, cz + Math.sin(a) * d, rim && r() < 0.5 ? 'bush' : r() < pines ? 'pine' : broadleaf(), 0.8 + r() * 0.6);
    }
  }
  // single trees in the fields
  for (let k = 0; k < 160; k++) {
    add(ground.x0 + r() * (ground.x1 - ground.x0), ground.z0 + r() * (ground.z1 - ground.z0), r() < 0.15 ? 'pine' : broadleaf(), 0.9 + r() * 0.6);
  }
  return out;
}

/** Smooth noise for lumpy crowns (a function of position, so shared vertices move together). */
const lump = (x: number, y: number, z: number, k: number) =>
  Math.sin(x * 2.3 * k + 1.3) * Math.sin(y * 2.9 * k + 0.7) * Math.sin(z * 2.1 * k + 2.1) + 0.5 * Math.sin((x + z) * 4.7 * k) * Math.sin(y * 5.3 * k + x);

/** A crown from overlapping lumpy spheres (cx, cy, cz, rx, ry, rz), shaded darker underneath. */
function crown(scene: Scene, name: string, lobes: ReadonlyArray<readonly [number, number, number, number, number?, number?]>, subdivisions: number, bump = 0.16): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  let top = 0;
  let bottom = Infinity;
  for (const [cx, cy, cz, rx, ry = rx, rz = rx] of lobes) {
    const s = MeshBuilder.CreateIcoSphere('lobe', { radius: 1, subdivisions, flat: false }, scene);
    const p = s.getVerticesData('position')!;
    const idx = s.getIndices()!;
    const base = positions.length / 3;
    for (let i = 0; i < p.length; i += 3) {
      const [ux, uy, uz] = [p[i]!, p[i + 1]!, p[i + 2]!];
      const f = 1 + bump * lump(ux + cx, uy + cy, uz + cz, 1.6);
      const y = cy + uy * ry * f;
      positions.push(cx + ux * rx * f, y, cz + uz * rz * f);
      top = Math.max(top, y);
      bottom = Math.min(bottom, y);
    }
    for (const i of idx) indices.push(base + i);
    s.dispose();
  }
  const colours: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const t = (positions[i + 1]! - bottom) / (top - bottom || 1);
    const v = 0.55 + 0.45 * Math.min(1, t * 1.3) + 0.06 * lump(positions[i]!, positions[i + 1]!, positions[i + 2]!, 3);
    colours.push(v, v, v, 1);
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.colors = colours;
  const m = new Mesh(name, scene);
  vd.applyToMesh(m, false);
  return m;
}

/** A spruce: stacked drooping cones. */
function spruce(scene: Scene): Mesh {
  const parts: Mesh[] = [];
  const tiers = [[0.9, 3.4, 1.7], [2.4, 3.0, 1.35], [3.8, 2.6, 1.0], [5.0, 2.0, 0.6]] as const;
  for (const [y, h, rad] of tiers) {
    const c = MeshBuilder.CreateCylinder('tier', { height: h, diameterTop: 0, diameterBottom: rad * 2, tessellation: 9, subdivisions: 2 }, scene);
    c.position.y = y + h / 2;
    c.rotation.y = y;
    c.bakeCurrentTransformIntoVertices();
    parts.push(c);
  }
  const m = Mesh.MergeMeshes(parts, true, true)!;
  const p = m.getVerticesData('position')!;
  const colours: number[] = [];
  for (let i = 0; i < p.length; i += 3) {
    const v = 0.6 + 0.4 * Math.min(1, p[i + 1]! / 6) + 0.08 * lump(p[i]!, p[i + 1]!, p[i + 2]!, 2);
    colours.push(v, v, v, 1);
  }
  m.setVerticesData('color', colours, false, 4);
  m.name = 'tree-pine';
  return m;
}

interface Kind {
  readonly mesh: (scene: Scene) => Mesh[];
  /** Trunk height and thickness (0 = no trunk), for size 1. */
  readonly trunk: readonly [number, number];
  readonly colours: readonly string[];
}

/** Each species: crown meshes (a tree picks one), trunk and leaf colours. Sizes in world units (2 m) for size 1. */
const KINDS: Record<Species, Kind> = {
  oak: {
    mesh: (s) => [
      crown(s, 'tree-oak-a', [[0, 3.6, 0, 2.0, 1.7], [1.2, 3.1, 0.5, 1.4], [-1.1, 3.2, -0.6, 1.5, 1.3], [0.2, 4.6, -0.3, 1.3]], 3),
      crown(s, 'tree-oak-b', [[0, 3.4, 0, 2.2, 1.6], [-1.3, 3.0, 0.6, 1.3], [0.9, 4.3, 0.2, 1.4], [0.5, 3.0, -1.2, 1.2]], 3),
    ],
    trunk: [3.0, 0.45],
    colours: ['#3e5c28', '#46652c', '#365324', '#4c6a2e', '#3a5a2e', '#6b6a2c'],
  },
  lime: {
    mesh: (s) => [crown(s, 'tree-lime', [[0, 3.8, 0, 1.7, 2.2], [0.6, 5.0, 0.3, 1.2], [-0.7, 3.2, 0.2, 1.3]], 3)],
    trunk: [3.0, 0.4],
    colours: ['#4f6e2f', '#56762f', '#4a6a34', '#5c7a36'],
  },
  birch: {
    mesh: (s) => [crown(s, 'tree-birch', [[0, 3.6, 0, 1.0, 1.4], [0.2, 4.8, -0.1, 0.8, 1.1], [-0.3, 3.0, 0.3, 0.8]], 3, 0.22)],
    trunk: [3.4, 0.25],
    colours: ['#6d8a3a', '#7a9444', '#647f39', '#8a9348'],
  },
  poplar: {
    mesh: (s) => [crown(s, 'tree-poplar', [[0, 5.0, 0, 0.9, 3.2], [0.1, 3.0, 0.1, 1.05, 1.6]], 3, 0.12)],
    trunk: [2.2, 0.35],
    colours: ['#4d6c2e', '#56752f', '#4a6630'],
  },
  pine: {
    mesh: (s) => [spruce(s)],
    trunk: [1.4, 0.35],
    colours: ['#2b4528', '#30492c', '#263e26', '#34502f'],
  },
  bush: {
    mesh: (s) => [crown(s, 'tree-bush', [[0, 0.8, 0, 1.2, 0.95], [0.7, 0.6, 0.3, 0.8], [-0.6, 0.7, -0.2, 0.9]], 2, 0.2)],
    trunk: [0, 0],
    colours: ['#3c5926', '#44622b', '#4e6a2d', '#38532a'],
  },
};

/** Draws the plantings: one draw call per crown shape, one for all trunks; every crown casts a shadow. */
export function buildTrees(scene: Scene, caster: (m: Mesh) => void, plantings: readonly Planting[]): void {
  const r = rng(7);
  const trunks: Place[] = [];
  const leaves = pbr(scene, 'leaves', '#ffffff', 0.92);
  for (const [species, kind] of Object.entries(KINDS) as Array<[Species, Kind]>) {
    const mine = plantings.filter((p) => p.species === species);
    if (!mine.length) continue;
    const meshes = kind.mesh(scene);
    const places: Place[][] = meshes.map(() => []);
    const colours: number[][] = meshes.map(() => []);
    for (const p of mine) {
      const v = Math.floor(r() * meshes.length);
      const s = p.size;
      const yaw = p.yaw ?? r() * Math.PI * 2;
      places[v]!.push([p.x, 0, p.z, s * (0.9 + r() * 0.2), s * (0.85 + r() * 0.3), s * (p.stretch ?? 1) * (0.9 + r() * 0.2), yaw]);
      const c = Color3.FromHexString(kind.colours[Math.floor(r() * kind.colours.length)]!).scale(0.9 + r() * 0.2);
      colours[v]!.push(c.r, c.g, c.b, 1);
      if (kind.trunk[0]) trunks.push([p.x, (kind.trunk[0] * s) / 2, p.z, kind.trunk[1] * s, kind.trunk[0] * s, kind.trunk[1] * s]);
    }
    meshes.forEach((m, i) => {
      m.material = leaves;
      m.isPickable = false;
      m.receiveShadows = true;
      if (!places[i]!.length) {
        m.dispose();
        return;
      }
      caster(thinInstances(m, places[i]!, new Float32Array(colours[i]!)));
    });
  }
  if (trunks.length) {
    const trunk = MeshBuilder.CreateCylinder('trunk', { height: 1, diameterTop: 0.7, diameterBottom: 1, tessellation: 6 }, scene);
    trunk.material = pbr(scene, 'trunk', '#4a3d30', 0.9);
    trunk.isPickable = false;
    caster(thinInstances(trunk, trunks));
  }
}
