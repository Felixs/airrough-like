/**
 * Pools of light on the ground at night: painted, not real lights, so they cost almost nothing. A wide pool under
 * every flood mast, a softer one on every Stand, and a row of small warm pools along each side of a building that
 * meets paving (doors, canopies and lit windows spilling onto the apron). They are flat on the ground, so aircraft,
 * vehicles and buildings standing on them hide them as usual.
 */
import { Color3, Engine, Material, Mesh, MeshBuilder, StandardMaterial, type Scene, type Vector3 } from '@babylonjs/core';
import { TILE_SIZE, type AirportLayout, type TileRect } from '../sim/layout';
import { thinInstances, type Place } from './geometry';
import { canvasTexture } from './textures';

const T = TILE_SIZE;
/** Just above the paint on the aprons. */
const HEIGHT = 0.26;

/** One kind of pool: its colour (with how strong it is at full night) and where it lies (x, z, radius in world units). */
interface PoolKind {
  readonly name: string;
  readonly colour: string;
  readonly strength: number;
  readonly at: ReadonlyArray<readonly [number, number, number]>;
}

export interface LightPools {
  /** 0 by day (hidden) … 1 at full night. */
  setStrength(k: number): void;
}

const BUILDINGS = new Set(['terminal', 'cargoHub', 'atcTower', 'supportBuilding']);
const PAVED = new Set(['stand', 'holdingBay', 'taxiway']);

/** Pools along every side of a building that touches a Stand, Holding Bay or Taxiway: one about every 2 tiles. */
function frontPools(b: TileRect, layout: AirportLayout): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const overlap = (a0: number, a1: number, b0: number, b1: number) => [Math.max(a0, b0), Math.min(a1, b1)] as const;
  const row = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / (2 * T)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      out.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 1.4 * T]);
    }
  };
  const out0 = 0.7 * T; // pools lie just in front of the wall
  for (const o of layout.structures) {
    if (!PAVED.has(o.kind)) continue;
    const [x0, x1] = overlap(b.x, b.x + b.w, o.x, o.x + o.w);
    const [y0, y1] = overlap(b.y, b.y + b.h, o.y, o.y + o.h);
    if (x1 > x0 && o.y === b.y + b.h) row(x0 * T, -(b.y + b.h) * T - out0, x1 * T, -(b.y + b.h) * T - out0);
    if (x1 > x0 && o.y + o.h === b.y) row(x0 * T, -b.y * T + out0, x1 * T, -b.y * T + out0);
    if (y1 > y0 && o.x === b.x + b.w) row((b.x + b.w) * T + out0, -y0 * T, (b.x + b.w) * T + out0, -y1 * T);
    if (y1 > y0 && o.x + o.w === b.x) row(b.x * T - out0, -y0 * T, b.x * T - out0, -y1 * T);
  }
  return out;
}

export function buildLightPools(scene: Scene, layout: AirportLayout, floods: readonly Vector3[]): LightPools {
  // a soft round pool in its colour: bright in the middle, fading smoothly to nothing at the rim (the colour is
  // painted in, as a material's own emissive colour would be added evenly over the whole square)
  const poolTexture = (name: string, hex: string) =>
    canvasTexture(scene, `light-pool-${name}`, 128, 128, (g, W, H) => {
      const c = Color3.FromHexString(hex);
      const rgb = (k: number) => `rgb(${Math.round(c.r * 255 * k)},${Math.round(c.g * 255 * k)},${Math.round(c.b * 255 * k)})`;
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      const grd = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2 - 1);
      grd.addColorStop(0, rgb(1));
      grd.addColorStop(0.25, rgb(0.8));
      grd.addColorStop(0.55, rgb(0.4));
      grd.addColorStop(0.8, rgb(0.12));
      grd.addColorStop(1, rgb(0));
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
    }, { clamp: true });
  const kinds: PoolKind[] = [
    { name: 'flood', colour: '#ffe6bd', strength: 0.55, at: floods.map((p) => [p.x, p.z, 28] as const) },
    {
      name: 'stand',
      colour: '#ffe9c8',
      strength: 0.3,
      at: layout.stands.map((s) => [(s.x + s.w / 2) * T, -(s.y + s.h / 2) * T, 0.6 * Math.max(s.w, s.h) * T] as const),
    },
    {
      name: 'front',
      colour: '#ffcf8f',
      strength: 0.45,
      at: layout.structures.filter((s) => BUILDINGS.has(s.kind)).flatMap((b) => frontPools(b, layout)),
    },
  ];
  const parts: Array<{ mat: StandardMaterial; mesh: Mesh; strength: number }> = [];
  for (const k of kinds) {
    if (!k.at.length) continue;
    const mat = new StandardMaterial(`pool-${k.name}`, scene);
    mat.disableLighting = true;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveTexture = poolTexture(k.name, k.colour);
    mat.emissiveColor = Color3.Black();
    // added on top of what is already drawn (light, never a dark edge); fog would add its own colour
    mat.alphaMode = Engine.ALPHA_ADD;
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    mat.disableDepthWrite = true;
    mat.fogEnabled = false;
    mat.alpha = 0;
    const disc = MeshBuilder.CreateGround(`pool-${k.name}`, { width: 2, height: 2 }, scene);
    disc.material = mat;
    disc.isPickable = false;
    const mesh = thinInstances(disc, k.at.map(([x, z, r]) => [x, HEIGHT, z, r, 1, r] as Place));
    mesh.setEnabled(false);
    parts.push({ mat, mesh, strength: k.strength });
  }
  return {
    setStrength(k: number) {
      for (const p of parts) {
        p.mat.alpha = p.strength * k;
        p.mesh.setEnabled(k > 0.01);
      }
    },
  };
}
