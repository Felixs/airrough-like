/**
 * Terminals, Cargo Hubs, the ATC Tower and Support Buildings in 3D, after the "Deck" prototype (inspired by Berlin
 * Brandenburg Terminal 1, Frankfurt's cargo centres and the German standard control tower). Each building is built in
 * metres in its own frame: its length runs along local x, its airside (the side facing its Stands, else a Taxiway) is
 * local −z, and everything stays inside its footprint except a 2 m roof edge on the airside. The frame is turned to the
 * airside, scaled to world units and placed on the footprint; static parts are then merged per material.
 */
import { Color3, Matrix, Mesh, MeshBuilder, PBRMaterial, StandardMaterial, TransformNode, Vector3, type Scene } from '@babylonjs/core';
import { TILE_SIZE, type Facing, type TileRect } from '../sim/layout';
import { pbr } from './aircraftModels';
import { nameAspect, paintName } from './lettering';
import { canvasTexture, rng, speckle } from './textures';
import { METRE } from './units';

const T = TILE_SIZE;
const TILE_M = 16; // metres per tile

/** What a building needs from the airfield. */
export interface BuildingKit {
  readonly scene: Scene;
  readonly caster: (m: Mesh) => void;
  readonly glow: (m: Mesh) => void;
  /** Glass lit from inside at night (the view sets its emissive strength). */
  readonly litGlass: PBRMaterial[];
  /** A light material: `day` of its colour by day, full at night. */
  readonly lamp: (name: string, hex: string, day?: number) => StandardMaterial;
  /** Flood masts (world units); the view turns the first few into real lights. */
  readonly floods: Vector3[];
  /** A building name painted flat at `height` (world units) over sim point (x, y), turned by `yaw` (radians). */
  readonly label: (text: string, x: number, y: number, w: number, h: number, height: number, colour: string, yaw?: number) => void;
}

/** Materials shared by every building of one airfield. */
interface Mats {
  stone: PBRMaterial;
  darkSteel: PBRMaterial;
  steel: PBRMaterial;
  fascia: PBRMaterial;
  roof: PBRMaterial;
  white: PBRMaterial;
  offWhite: PBRMaterial;
  hvac: PBRMaterial;
  cladSilver: PBRMaterial;
  cladBlue: PBRMaterial;
  accent: PBRMaterial;
  yellow: PBRMaterial;
  red: PBRMaterial;
  rubber: PBRMaterial;
  bronze: PBRMaterial;
  orange: PBRMaterial;
  skylight: PBRMaterial;
  warmLamp: StandardMaterial;
  sodium: StandardMaterial;
  whiteLamp: StandardMaterial;
}

const cache = new WeakMap<BuildingKit, Mats>();
const textured = (scene: Scene, name: string, paint: (g: CanvasRenderingContext2D, W: number, H: number) => void, rough: number, metal: number, u = 1, v = 1) => {
  const m = pbr(scene, name, '#ffffff', rough, metal);
  m.albedoTexture = canvasTexture(scene, name, 256, 256, paint, { u, v });
  return m;
};

function mats(kit: BuildingKit): Mats {
  const { scene } = kit;
  // one set per airfield (a rebuilt airfield makes its own, as the old one's are disposed with it)
  const had = cache.get(kit);
  if (had) return had;
  const ribsH = (hex: string) => (g: CanvasRenderingContext2D, W: number, H: number) => {
    g.fillStyle = hex;
    g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 16) {
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(0, y, W, 3);
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.fillRect(0, y + 9, W, 4);
    }
    speckle(g, W, H, 1500, 0.05, 2, 3);
  };
  const m: Mats = {
    stone: textured(scene, 'bld-stone', (g, W, H) => {
      g.fillStyle = '#d9d2c3';
      g.fillRect(0, 0, W, H);
      speckle(g, W, H, 5000, 0.08, 2, 9);
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      g.lineWidth = 1.5;
      for (let y = 0; y <= H; y += 64) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
        for (let x = ((y / 64) % 2) * 64; x <= W; x += 128) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x, y + 64);
          g.stroke();
        }
      }
    }, 0.75, 0),
    darkSteel: pbr(scene, 'bld-dark-steel', '#3a3f45', 0.6, 0.2),
    steel: pbr(scene, 'bld-steel', '#b4b9be', 0.45, 0.3),
    fascia: pbr(scene, 'bld-fascia', '#dfe2e2', 0.4, 0.15),
    roof: textured(scene, 'bld-roof', (g, W, H) => {
      g.fillStyle = '#b9bcbc';
      g.fillRect(0, 0, W, H);
      speckle(g, W, H, 6000, 0.08, 2, 11);
      g.strokeStyle = 'rgba(0,0,0,0.08)';
      for (let x = 0; x <= W; x += 32) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, H);
        g.stroke();
      }
    }, 0.8, 0, 8, 3),
    white: pbr(scene, 'bld-white', '#e9eaea', 0.55),
    offWhite: pbr(scene, 'bld-off-white', '#d8d6d0', 0.7),
    hvac: pbr(scene, 'bld-hvac', '#9aa0a4', 0.5, 0.4),
    cladSilver: textured(scene, 'bld-clad-silver', ribsH('#b9bec4'), 0.45, 0.55, 12, 3),
    cladBlue: textured(scene, 'bld-clad-blue', (g, W, H) => {
      g.fillStyle = '#3e4c5e';
      g.fillRect(0, 0, W, H);
      for (let x = 0; x < W; x += 12) {
        g.fillStyle = 'rgba(255,255,255,0.09)';
        g.fillRect(x, 0, 3, H);
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(x + 7, 0, 3, H);
      }
    }, 0.5, 0.45, 8, 3),
    accent: pbr(scene, 'bld-accent', '#1f8a8a', 0.5, 0.2),
    yellow: pbr(scene, 'bld-yellow', '#f2c230', 0.6),
    red: pbr(scene, 'bld-red', '#b3261e', 0.4, 0.1, true),
    rubber: pbr(scene, 'bld-rubber', '#16181b', 0.8),
    bronze: pbr(scene, 'bld-bronze', '#6b5641', 0.45, 0.7),
    orange: pbr(scene, 'bld-orange', '#e07b1f', 0.5, 0.1, true),
    skylight: glowing(kit, 'bld-skylight', '#3d5163', '#a8875f'),
    warmLamp: kit.lamp('bld-warm-lamp', '#ffd9a0', 0.05),
    sodium: kit.lamp('bld-sodium', '#ffb050', 0.05),
    whiteLamp: kit.lamp('bld-white-lamp', '#eef4ff', 0.05),
  };
  cache.set(kit, m);
  return m;
}

interface GlassSpec {
  bay: number; // metres the texture repeats over
  h: number; // metres tall
  hstep?: number; // horizontal glazing bars every … m
  vstep?: number; // vertical bars every … m
  floors?: number[]; // floor slab heights (m)
  slab?: string;
  seed?: number;
  warm?: readonly [number, number, number];
  top?: string;
  bottom?: string;
}

/** A glass curtain wall `w` metres long: reflective tinted glass with bars, and a lit interior behind it at night. */
function glass(kit: BuildingKit, name: string, w: number, o: GlassSpec): PBRMaterial {
  const PX = 8;
  const bw = Math.max(8, Math.round(o.bay * PX));
  const bh = Math.max(8, Math.round(o.h * PX));
  const bars = (g: CanvasRenderingContext2D, W: number, H: number, colour: string) => {
    g.fillStyle = colour;
    const hs = o.hstep ?? 1.5;
    for (let y = 0; y <= o.h + 0.01; y += hs) g.fillRect(0, H - Math.round(y * PX) - 1, W, 2);
    if (o.vstep) for (let x = 0; x <= o.bay + 0.01; x += o.vstep) g.fillRect(Math.round(x * PX) - 1, 0, 2, H);
  };
  const slabs = (g: CanvasRenderingContext2D, W: number, H: number, colour: string) => {
    g.fillStyle = colour;
    for (const f of o.floors ?? []) g.fillRect(0, H - Math.round(f * PX) - Math.round(0.9 * PX), W, Math.round(0.9 * PX));
  };
  const m = pbr(kit.scene, `glass-${name}`, '#ffffff', 0.06, 0.35);
  m.albedoTexture = canvasTexture(kit.scene, `glass-${name}`, bw, bh, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, o.top ?? '#5a7389');
    grd.addColorStop(1, o.bottom ?? '#2a3a48');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    bars(g, W, H, '#2b3138');
    slabs(g, W, H, o.slab ?? '#c9c4b8');
  }, { u: w / o.bay });
  const r = rng(o.seed ?? 7);
  const [wr, wg, wb] = o.warm ?? [255, 214, 160];
  m.emissiveTexture = canvasTexture(kit.scene, `glass-${name}-lit`, bw, bh, (g, W, H) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const levels = [0, ...(o.floors ?? [])];
    for (let i = 0; i < levels.length; i++) {
      const y0 = levels[i]!;
      const y1 = (levels[i + 1] ?? o.h) - (i < levels.length - 1 ? 0.9 : 0);
      const k = 0.45 + 0.35 * r();
      const grd = g.createLinearGradient(0, H - y1 * PX, 0, H - y0 * PX);
      grd.addColorStop(0, `rgba(${wr},${wg},${wb},${0.95 * k})`);
      grd.addColorStop(0.5, `rgba(${wr},${wg},${wb},${0.55 * k})`);
      grd.addColorStop(1, `rgba(${wr * 0.8},${wg * 0.7},${wb * 0.6},${0.7 * k})`);
      g.fillStyle = grd;
      g.fillRect(0, H - y1 * PX, W, (y1 - y0) * PX);
      g.fillStyle = `rgba(255,240,215,${0.8 * k})`;
      g.fillRect(0, H - y1 * PX + 2, W, 2);
      // people, shops and seats as darker shapes
      for (let s = 0; s < o.bay / 3; s++) {
        if (r() < 0.5) continue;
        const sx = r() * W;
        const sh = (1 + r() * (y1 - y0) * 0.35) * PX;
        g.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.35})`;
        g.fillRect(sx, H - y0 * PX - sh, (0.4 + r() * 2.2) * PX, sh);
      }
    }
    bars(g, W, H, '#000');
    slabs(g, W, H, '#000');
  }, { u: w / o.bay });
  m.emissiveColor = Color3.Black();
  kit.litGlass.push(m);
  return m;
}

/** A solid that glows from inside at night (lit door openings, stair slits): albedo dark, emissive a flat colour. */
function glowing(kit: BuildingKit, name: string, albedo: string, light: string): PBRMaterial {
  const m = pbr(kit.scene, name, albedo, 0.3, 0.2);
  m.emissiveTexture = canvasTexture(kit.scene, `${name}-lit`, 4, 4, (g, W, H) => {
    g.fillStyle = light;
    g.fillRect(0, 0, W, H);
  });
  m.emissiveColor = Color3.Black();
  kit.litGlass.push(m);
  return m;
}

const TURN: Record<Facing, number> = { south: 0, north: Math.PI, east: -Math.PI / 2, west: Math.PI / 2 };
const FACE = { s: 0, n: Math.PI, w: Math.PI / 2, e: -Math.PI / 2 } as const;

/**
 * One building's frame and parts: length L along local x (−L/2…L/2), depth D along z with the airside at −D/2, in
 * metres. Parts added with box/cyl/face are merged per material by finish().
 */
class Frame {
  readonly root: TransformNode;
  readonly L: number;
  readonly D: number;
  readonly zS: number;
  readonly zN: number;
  private parts: Mesh[] = [];
  constructor(
    readonly kit: BuildingKit,
    readonly s: TileRect,
    readonly side: Facing,
  ) {
    const along = side === 'south' || side === 'north';
    this.L = (along ? s.w : s.h) * TILE_M;
    this.D = (along ? s.h : s.w) * TILE_M;
    this.zS = -this.D / 2;
    this.zN = this.D / 2;
    this.root = new TransformNode('building', kit.scene);
    this.root.position.set((s.x + s.w / 2) * T, 0, -(s.y + s.h / 2) * T);
    this.root.rotation.y = TURN[side];
    this.root.scaling.setAll(METRE);
  }
  private add(m: Mesh, mat: PBRMaterial | StandardMaterial): Mesh {
    m.material = mat;
    m.parent = this.root;
    m.isPickable = false;
    this.parts.push(m);
    return m;
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, mat: PBRMaterial | StandardMaterial, ry = 0): Mesh {
    const m = MeshBuilder.CreateBox('part', { width: w, height: h, depth: d }, this.kit.scene);
    m.position.set(x, y + h / 2, z);
    m.rotation.y = ry;
    return this.add(m, mat);
  }
  cyl(d: number, h: number, x: number, y: number, z: number, mat: PBRMaterial | StandardMaterial, o: { top?: number; bottom?: number; tess?: number; lying?: boolean } = {}): Mesh {
    const m = MeshBuilder.CreateCylinder('part', { diameter: d, diameterTop: o.top, diameterBottom: o.bottom, height: h, tessellation: o.tess ?? 16 }, this.kit.scene);
    if (o.lying) {
      m.rotation.z = Math.PI / 2;
      m.position.set(x, y, z);
    } else m.position.set(x, y + h / 2, z);
    return this.add(m, mat);
  }
  /** A facade plane w × h with its bottom centre at (x, y, z), facing s (airside), n, e or w. */
  face(w: number, h: number, x: number, y: number, z: number, dir: keyof typeof FACE, mat: PBRMaterial | StandardMaterial): Mesh {
    const m = MeshBuilder.CreatePlane('face', { width: w, height: h }, this.kit.scene);
    m.position.set(x, y + h / 2, z);
    m.rotation.y = FACE[dir];
    return this.add(m, mat);
  }
  /** Many copies of a small mesh (columns, fins, lamps): one draw call, kept apart from the merge. */
  copies(mesh: Mesh, mat: PBRMaterial | StandardMaterial, at: ReadonlyArray<readonly [number, number, number]>, cast = true, glowing = false): void {
    mesh.material = mat;
    mesh.parent = this.root;
    mesh.isPickable = false;
    if (!at.length) {
      mesh.dispose();
      return;
    }
    mesh.thinInstanceAdd(at.map(([x, y, z]) => Matrix.Translation(x, y, z)));
    if (cast) this.kit.caster(mesh);
    if (glowing) this.kit.glow(mesh);
  }
  lamps(mat: StandardMaterial, at: ReadonlyArray<readonly [number, number, number]>, size: number): void {
    this.copies(MeshBuilder.CreateBox('lamp', { width: size, height: size * 0.3, depth: size }, this.kit.scene), mat, at, false, false);
  }
  /** A world point (world units) from a local one (metres). */
  world(x: number, y: number, z: number): Vector3 {
    return Vector3.TransformCoordinates(new Vector3(x, y, z), this.root.computeWorldMatrix(true));
  }
  /**
   * A name painted flat along the building's length, centred on a local point. It reads left to right from the south
   * (buildings facing north or south) or bottom to top (facing east or west), never upside down.
   */
  label(text: string, x: number, y: number, z: number, w: number, h: number, colour = '#4a4f55'): void {
    const p = this.world(x, y, z);
    const yaw = this.side === 'east' || this.side === 'west' ? -Math.PI / 2 : 0;
    this.kit.label(text, p.x, -p.z, w * METRE, h * METRE, p.y + 0.03, colour, yaw);
  }
  /**
   * A name sign on short posts on a roof edge, facing the airside: white capitals on a dark plate `h` m tall (as wide
   * as the name needs), centred over the local point on the roof; the letters glow at night.
   */
  sign(text: string, x: number, y: number, z: number, h: number, plateMat: PBRMaterial): void {
    const style = { weight: 600, spacing: 0.18, fill: 0.62 };
    const w = h * nameAspect(text, style, 0.45);
    const name = `sign-${text}-${this.s.x}-${this.s.y}`;
    const W = 1024;
    const H = Math.max(32, Math.round((W * h) / w / 8) * 8);
    const draw = (bg: string, fg: string) => (g: CanvasRenderingContext2D) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      paintName(g, text, W, H, fg, style);
    };
    const mat = pbr(this.kit.scene, name, '#ffffff', 0.35, 0.1);
    mat.albedoTexture = canvasTexture(this.kit.scene, name, W, H, draw('#22272d', '#f4f5f2'), { clamp: true });
    mat.emissiveTexture = canvasTexture(this.kit.scene, `${name}-lit`, W, H, draw('#000000', '#fff6e4'), { clamp: true });
    mat.emissiveColor = Color3.Black();
    this.kit.litGlass.push(mat);
    const lift = 0.7;
    for (const sx of [-w / 3, 0, w / 3]) this.box(0.3, lift + 0.2, 0.3, x + sx, y - 0.1, z + 0.25, plateMat);
    this.box(w + 0.3, h + 0.3, 0.35, x, y + lift, z + 0.2, plateMat);
    const face = MeshBuilder.CreatePlane('sign', { width: w, height: h }, this.kit.scene);
    face.position.set(x, y + lift + 0.15 + h / 2, z - 0.02);
    face.parent = this.root;
    face.material = mat;
    face.isPickable = false;
  }
  finish(): void {
    const groups = new Map<number, Mesh[]>();
    for (const m of this.parts) {
      const id = m.material!.uniqueId;
      const g = groups.get(id);
      if (g) g.push(m);
      else groups.set(id, [m]);
    }
    for (const g of groups.values()) {
      const merged = g.length > 1 ? Mesh.MergeMeshes(g, true, true) : g[0]!;
      if (!merged) continue;
      merged.isPickable = false;
      this.kit.caster(merged);
    }
  }
}

/** Glass façade materials of one airfield, by kind and length (the texture repeats along it). */
const GLASS: Record<string, GlassSpec> = {
  hall: { bay: 9, h: 12.5, hstep: 1.6, vstep: 9, seed: 3, top: '#5a7389', bottom: '#2a3a48' },
  gate: { bay: 6, h: 6, hstep: 6, vstep: 1.5, seed: 5, top: '#4a5d6e', bottom: '#243039' },
  land: { bay: 9, h: 19, hstep: 1.6, vstep: 9, seed: 8, floors: [6.5], top: '#5a7389', bottom: '#283642' },
  slot: { bay: 1.6, h: 15, hstep: 1.6, seed: 9, top: '#5a7389', bottom: '#283642' },
};

/**
 * A Terminal, "Deck" style: gate lounges behind glass at apron level, a stone floor band, a tall hall glazed with
 * horizontal bars, stone end walls with slot windows, and one flat roof deck over all of it on slender steel columns,
 * with skylight bands, roof plant and downlights in its underside. The landside has a canopy for the drop-off.
 */
export function buildTerminal(kit: BuildingKit, s: TileRect, airside: Facing): void {
  const M = mats(kit);
  const f = new Frame(kit, s, airside);
  const { L, zS, zN } = f;
  const zg = zS + 4; // gate glass
  const zh = zS + 9; // hall glass, above the gate lounges
  const zl = zN - 12; // landside glass; the canopy runs on to the edge
  const ry = 19.5; // underside of the roof deck
  const inner = L - 6; // between the stone end walls
  const g = (kind: string, w: number) => glass(kit, `${kind}-${s.x}-${s.y}`, w, GLASS[kind]!);
  f.box(inner, 6.6, zh - zg, 0, 0, (zg + zh) / 2, M.darkSteel);
  f.face(inner, 6, 0, 0, zg - 0.02, 's', g('gate', inner));
  f.box(inner + 0.4, 1, zh - zg + 0.4, 0, 6, (zg + zh) / 2, M.stone);
  f.box(inner, 13, zl - zh, 0, 6.5, (zh + zl) / 2, M.darkSteel);
  f.face(inner, 12.5, 0, 7, zh - 0.02, 's', g('hall', inner));
  f.face(inner, 19, 0, 0, zl + 0.02, 'n', g('land', inner));
  // stone end walls with tall slot windows
  const slot = g('slot', 1.6);
  for (const [ex, dir] of [[-inner / 2, 'w'], [inner / 2, 'e']] as const) {
    f.box(1.2, ry, zl - zg, ex + (dir === 'w' ? 0.6 : -0.6), 0, (zg + zl) / 2, M.stone);
    const n = Math.max(1, Math.floor((zl - zg - 8) / 9));
    for (let k = 0; k < n; k++) f.face(1.6, 15, ex + (dir === 'w' ? -0.05 : 0.05), 2.5, zg + 4 + ((k + 0.5) * (zl - zg - 8)) / n, dir, slot);
  }
  // the roof deck: 1.8 m slab from 2 m past the airside edge to the landside edge, membrane and skylights on top
  const d0 = zS - 2;
  f.box(L, 1.8, zN - d0, 0, ry, (zN + d0) / 2, M.fascia);
  f.box(L - 1.2, 0.2, zN - d0 - 1.2, 0, ry + 1.8, (zN + d0) / 2, M.roof);
  if (L > 30) for (const z of [zh + 8, (zh + zl) / 2, zl - 6]) f.box(L - 24, 0.3, 3, 0, ry + 1.85, z, M.skylight);
  for (let k = 0; k < Math.floor(L / 40); k++) f.box(6, 2, 4, -L / 2 + 20 + k * 40, ry + 2, zN - 5, M.hvac);
  // colonnades under the deck, landside and airside
  const cols: Array<[number, number, number]> = [];
  for (let x = -L / 2 + 4; x <= L / 2 - 3; x += 13) cols.push([x, ry / 2, zN - 1.5], [x, ry / 2, zS + 1.5]);
  f.copies(MeshBuilder.CreateCylinder('column', { diameter: 0.9, height: ry, tessellation: 10 }, kit.scene), M.steel, cols);
  // downlights in the deck's underside
  const dl: Array<[number, number, number]> = [];
  for (let x = -L / 2 + 3; x < L / 2 - 2; x += 6.5) {
    for (let z = zl + 3; z < zN - 1; z += 6) dl.push([x, ry - 0.05, z]);
    dl.push([x, ry - 0.05, (d0 + zg) / 2]);
  }
  f.lamps(M.warmLamp, dl, 0.5);
  f.box(L, 0.25, 3, 0, 0, zN - 5, M.offWhite); // drop-off kerb
  if (L >= 80) {
    // the roof name between the middle and landside skylight bands, and a name sign on the airside roof edge
    const za = (zh + zl) / 2 + 1.5;
    const zb = zl - 7.5;
    f.label('TERMINAL', 0, ry + 2.02, (za + zb) / 2, Math.min(L * 0.6, 110), Math.min(11, zb - za - 1));
    f.sign('TERMINAL', 0, ry + 2, d0 + 1.2, 4.2, M.darkSteel);
  }
  for (const x of [-L / 2 - 6, L / 2 + 6]) kit.floods.push(f.world(x, 28, zS - 6));
  f.finish();
}

/**
 * A Cargo Hub: a hall in silver ribbed cladding with a teal band, a dark high-bay warehouse at the back on long hubs,
 * a three-storey office head at one end, and roller doors on the airside (open ones lit orange) under a canopy.
 */
export function buildCargoHub(kit: BuildingKit, s: TileRect, airside: Facing): void {
  const M = mats(kit);
  const f = new Frame(kit, s, airside);
  const { L, zS, zN } = f;
  const hh = 15;
  const office = Math.min(18, L * 0.35);
  const hallL = L - office;
  const hx = -L / 2 + hallL / 2;
  const zf = zS + 6; // the hall's airside wall
  f.box(hallL, hh, zN - zf, hx, 0, (zf + zN) / 2, M.cladSilver);
  f.box(hallL + 0.2, 1.2, zN - zf + 0.2, hx, hh - 1.6, (zf + zN) / 2, M.accent);
  f.box(hallL - 1, 0.2, zN - zf - 1, hx, hh, (zf + zN) / 2, M.roof);
  if (L >= 96) {
    f.box(40, 30, 26, -L / 2 + 22, 0, zN - 14, M.cladBlue);
    f.box(40.4, 0.6, 26.4, -L / 2 + 22, 30, zN - 14, M.fascia);
  }
  // office head
  const ox = L / 2 - office / 2;
  f.box(office, 13.2, zN - zf, ox, 0, (zf + zN) / 2, M.white);
  const og = { bay: office, h: 13, hstep: 4.3, vstep: 1.8, floors: [4.3, 8.6], slab: '#e8e6e0', seed: 21 };
  f.face(office, 13, ox, 0, zf - 0.03, 's', glass(kit, `cargo-office-${s.x}-${s.y}`, office, og));
  f.face(zN - zf, 13, L / 2 + 0.03, 0, (zf + zN) / 2, 'e', glass(kit, `cargo-office-end-${s.x}-${s.y}`, zN - zf, { ...og, bay: zN - zf, seed: 22 }));
  // roller doors: open ones lit inside, closed ones ribbed steel; yellow lintels and bollards
  const open = glowing(kit, `cargo-door-${s.x}-${s.y}`, '#2a2622', '#c98a48');
  const shut = textured(kit.scene, `cargo-door-shut-${s.x}-${s.y}`, (g, W, H) => {
    g.fillStyle = '#9aa3ab';
    g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 10) {
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(0, y, W, 3);
    }
  }, 0.5, 0.5);
  const n = Math.max(1, Math.floor((hallL - 4) / 15.5));
  for (let k = 0; k < n; k++) {
    const dx = -L / 2 + 2 + (k + 0.5) * ((hallL - 4) / n);
    f.face(9, 7.5, dx, 0, zf - 0.04, 's', k % 2 ? shut : open);
    f.box(10, 0.5, 0.6, dx, 7.5, zf - 0.3, M.yellow);
    for (const sx of [-5.2, 5.2]) f.box(1, 1.2, 1.2, dx + sx, 0, zf - 1.2, M.yellow);
  }
  f.box(hallL, 0.6, zf - zS, hx, 9.5, (zS + zf) / 2, M.fascia);
  const cl: Array<[number, number, number]> = [];
  for (let x = -L / 2 + 3; x < -L / 2 + hallL - 2; x += 6) cl.push([x, 9.45, (zS + zf) / 2]);
  f.lamps(M.sodium, cl, 0.9);
  const wp: Array<[number, number, number]> = [];
  for (let x = -L / 2 + 4; x < -L / 2 + hallL - 2; x += 8) wp.push([x, 12.5, zf - 0.4]);
  f.lamps(M.sodium, wp, 0.8);
  if (hallL > 30) for (const z of [zf + 12, (zf + zN) / 2 + 4, zN - 8]) f.box(hallL - 14, 0.4, 2.4, hx - 3, hh, z, M.skylight);
  for (let k = 0; k < Math.floor(hallL / 30); k++) f.box(4, 1.6, 3, -L / 2 + 12 + k * 30, hh, zN - 4, M.hvac);
  if (L >= 80) {
    // the roof name between the first two skylight bands (clear of the high-bay), and a sign on the airside roof edge
    const za = zf + 13.2;
    const zb = (zf + zN) / 2 + 2.8;
    f.label('CARGO', hx, hh + 0.45, (za + zb) / 2, Math.min(hallL * 0.55, 60), Math.min(11, zb - za - 1), '#3a3f45');
    f.sign('CARGO', hx, hh + 0.2, zf + 0.6, 3.6, M.darkSteel);
  }
  for (const x of [-L / 2 - 6, L / 2 + 6]) kit.floods.push(f.world(x, 28, zS - 6));
  f.finish();
}

/**
 * The ATC Tower: a white two-storey base with ribbon windows, a slim round shaft with a lit stair slit, flared
 * equipment floors, a cab of outward-sloping green-tinted glass, a roof disc with antennas, a radar dome and red lights.
 */
export function buildTower(kit: BuildingKit, s: TileRect, front: Facing): void {
  const M = mats(kit);
  const f = new Frame(kit, s, front);
  const { L, zS, zN } = f;
  const bw = Math.min(36, L - 8);
  const bd = 22;
  const bz = zS + 4 + bd / 2;
  f.box(bw, 8.4, bd, 0, 0, bz, M.white);
  f.face(bw, 7, 0, 0.6, bz - bd / 2 - 0.03, 's', glass(kit, `tower-base-${s.x}-${s.y}`, bw, { bay: 12, h: 7, hstep: 3.5, vstep: 2, floors: [3.5], slab: '#e9eaea', seed: 31 }));
  f.box(bw + 0.6, 0.6, bd + 0.6, 0, 8.4, bz, M.fascia);
  const sx = L / 6;
  const sz = Math.min(zN - 10, bz + bd / 2 + 6);
  const H = 44;
  f.cyl(7.5, H, sx, 0, sz, M.white, { tess: 32 });
  f.box(0.9, H - 12, 0.4, sx, 8, sz - 3.7, glowing(kit, `tower-slit-${s.x}-${s.y}`, '#1a2028', '#d8cdb8'));
  f.cyl(1, 6, sx, H, sz, M.offWhite, { top: 15, bottom: 7.5, tess: 32 });
  f.cyl(15.2, 1.4, sx, H + 6, sz, glowing(kit, `tower-ring-${s.x}-${s.y}`, '#1d262f', '#c8b496'), { tess: 32 });
  f.cyl(15.4, 0.6, sx, H + 7.4, sz, M.fascia, { tess: 32 });
  const cab = pbr(kit.scene, `tower-cab-${s.x}-${s.y}`, '#ffffff', 0.05, 0.4);
  cab.albedoTexture = canvasTexture(kit.scene, `tower-cab-${s.x}-${s.y}`, 192, 32, (g, W, H2) => {
    const grd = g.createLinearGradient(0, 0, 0, H2);
    grd.addColorStop(0, '#5f8f84');
    grd.addColorStop(1, '#1c3a34');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H2);
    g.fillStyle = '#2b3138';
    for (let i = 0; i <= 12; i++) g.fillRect((i * W) / 12 - 1, 0, 3, H2);
  });
  cab.emissiveTexture = canvasTexture(kit.scene, `tower-cab-lit-${s.x}-${s.y}`, 4, 4, (g, W, H2) => {
    g.fillStyle = '#2f7a66';
    g.fillRect(0, 0, W, H2);
  });
  cab.emissiveColor = Color3.Black();
  kit.litGlass.push(cab);
  f.cyl(1, 5.2, sx, H + 8, sz, cab, { top: 17.2, bottom: 14.6, tess: 12 });
  f.cyl(19, 1.1, sx, H + 13.2, sz, M.fascia, { tess: 32 });
  f.cyl(3.2, 2.5, sx, H + 14.3, sz, M.offWhite, { tess: 16 });
  const dome = MeshBuilder.CreateSphere('dome', { diameter: 3.6, segments: 12 }, kit.scene);
  dome.position.set(sx, H + 18, sz);
  dome.parent = f.root;
  dome.material = M.white;
  kit.caster(dome);
  for (const [dx, dz, h] of [[5, 2, 6], [-5, -2, 8], [3, -6, 5]] as const) f.cyl(0.3, h, sx + dx, H + 14.3, sz + dz, M.steel, { tess: 6 });
  f.lamps(kit.lamp(`tower-red-${s.x}-${s.y}`, '#ff2a1a', 0.5), [[sx + 5, H + 20.6, sz + 2], [sx - 5, H + 22.6, sz - 2]], 1);
  f.label('TWR', -L / 4, 0.12, zS + 2, 10, 4, '#cfd8d4');
  f.finish();
}

type SupportRole = 'rampAgentStation' | 'adminOffice' | 'airlineOffice' | 'fireRescueStation' | 'fuelFarm' | 'deIcingPad';
const NAMES: Record<SupportRole, string> = { rampAgentStation: 'RAMP AGENT STATION', adminOffice: 'ADMIN OFFICE', airlineOffice: 'AIRLINE OFFICE', fireRescueStation: 'FIRE & RESCUE', fuelFarm: 'FUEL FARM', deIcingPad: 'DE-ICING PAD' };

/** A Support Building, by role; each has its name painted on the ground in front. */
export function buildSupport(kit: BuildingKit, s: TileRect, role: SupportRole, front: Facing): void {
  const M = mats(kit);
  const f = new Frame(kit, s, front);
  const { L, D, zS, zN } = f;
  const id = `${s.x}-${s.y}`;
  if (role === 'adminOffice' || role === 'airlineOffice') {
    const admin = role === 'adminOffice';
    const floors = admin ? 4 : 3;
    const W = L - 8;
    const d = D - 10;
    const H = floors * 4.2;
    const cz = (zS + zN) / 2 + 1;
    f.box(W, H, d, 0, 0, cz, M.darkSteel);
    const fl = Array.from({ length: floors - 1 }, (_, k) => (k + 1) * 4.2);
    const spec = { bay: 9, h: H, hstep: 4.2, vstep: 1.8, floors: fl, slab: admin ? '#e6e2da' : '#7a644d', seed: admin ? 51 : 52, top: '#4d6377', bottom: '#25313c' };
    const sn = glass(kit, `office-${id}`, W, spec);
    const ew = glass(kit, `office-end-${id}`, d, spec);
    f.face(W, H, 0, 0, cz - d / 2 - 0.03, 's', sn);
    f.face(W, H, 0, 0, cz + d / 2 + 0.03, 'n', sn);
    f.face(d, H, -W / 2 - 0.03, 0, cz, 'w', ew);
    f.face(d, H, W / 2 + 0.03, 0, cz, 'e', ew);
    if (admin) {
      const at: Array<[number, number, number]> = [];
      for (let x = -W / 2 + 0.9; x <= W / 2 - 0.9; x += 1.8) at.push([x, H / 2, cz - d / 2 - 0.5], [x, H / 2, cz + d / 2 + 0.5]);
      f.copies(MeshBuilder.CreateBox('fin', { width: 0.3, height: H, depth: 0.9 }, kit.scene), M.stone, at);
    }
    f.box(W + 1.2, 0.8, d + 1.2, 0, H, cz, admin ? M.fascia : M.bronze);
    f.box(8, 2.2, 6, W / 4, H + 0.8, cz, M.hvac);
  } else if (role === 'rampAgentStation') {
    const bw = Math.min(20, L * 0.42);
    const bx = -L / 2 + 2 + bw / 2;
    f.box(bw, 5, 14, bx, 0, zS + 6 + 7, M.offWhite);
    f.face(bw, 3.6, bx, 0.6, zS + 6 - 0.03, 's', glass(kit, `ramp-${id}`, bw, { bay: bw, h: 3.6, hstep: 3.6, vstep: 2, seed: 61 }));
    f.box(bw + 0.6, 0.5, 14.6, bx, 5, zS + 13, M.orange);
    // the vehicle shed
    const x0 = bx + bw / 2 + 4;
    const x1 = L / 2 - 2;
    for (const x of [x0, x1]) for (const z of [zS + 4, zN - 4]) f.cyl(0.5, 6, x, 0, z, M.steel, { tess: 8 });
    f.box(x1 - x0 + 2, 0.4, zN - zS - 6, (x0 + x1) / 2, 6, (zS + zN) / 2, pbr(kit.scene, `shed-roof-${id}`, '#cfd6da', 0.3, 0.5));
    const tug = pbr(kit.scene, `tug-${id}`, '#e0a21c', 0.5, 0.2, true);
    const cart = pbr(kit.scene, `cart-${id}`, '#5d6a78', 0.6, 0.3);
    for (let k = 0; k < Math.floor((x1 - x0) / 6); k++) {
      f.box(2.2, 1.6, 3.4, x0 + 3 + k * 6, 0.3, zS + 8, tug);
      for (let c = 0; c < 3; c++) f.box(1.8, 1.6, 2.6, x0 + 3 + k * 6, 0.3, zS + 13 + c * 3.2, cart);
    }
  } else if (role === 'fireRescueStation') {
    const bw = L - 14;
    const zf = zS + 14; // forecourt in front for the crash tenders
    const bx = -7;
    f.box(bw, 9, zN - 2 - zf, bx, 0, (zf + zN - 2) / 2, M.offWhite);
    f.box(bw + 0.4, 1.4, zN - 2 - zf + 0.4, bx, 9, (zf + zN - 2) / 2, M.red);
    f.box(bw - 0.6, 0.2, zN - 2 - zf - 0.6, bx, 10.2, (zf + zN - 2) / 2, M.roof);
    const bay = glass(kit, `fire-bay-${id}`, 7, { bay: 7, h: 7, hstep: 0.9, vstep: 7, seed: 41, top: '#56606a', bottom: '#2a3038', warm: [235, 240, 255] });
    const n = Math.max(1, Math.floor(bw / 8.2));
    for (let k = 0; k < n; k++) {
      const dx = bx - bw / 2 + (k + 0.5) * (bw / n);
      f.face(7, 7, dx, 0, zf - 0.03, 's', bay);
      f.box(0.6, 7.4, 0.5, dx - 3.8, 0, zf - 0.2, M.red);
    }
    // drill tower
    const tx = L / 2 - 5;
    f.box(6, 20, 6, tx, 0, zN - 8, M.offWhite);
    f.box(6.4, 1.2, 6.4, tx, 20, zN - 8, M.red);
    f.face(2, 15, tx, 3, zN - 11.03, 's', glass(kit, `drill-${id}`, 2, { bay: 2, h: 15, hstep: 3, seed: 44 }));
    // crash tenders
    const truck = pbr(kit.scene, `tender-${id}`, '#c0281c', 0.35, 0.2, true);
    const nT = Math.min(2, n);
    for (let k = 0; k < nT; k++) {
      const x = bx - bw / 2 + (k + 0.5) * (bw / n);
      const z = zS + 7;
      f.box(4, 3.6, 12, x, 0.9, z, truck);
      f.box(4.1, 0.5, 12.1, x, 2.2, z, M.white);
      f.box(3.6, 2.2, 2.6, x, 1.4, z - 6.4, truck);
      for (const wz of [-4, -0.5, 3.5]) for (const sxx of [-2, 2]) f.cyl(1.4, 0.8, x + sxx, 0.7, z + wz, M.rubber, { lying: true, tess: 12 });
    }
    f.lamps(kit.lamp(`fire-blue-${id}`, '#2a6bff', 0.3), [[bx - bw / 2 + 0.5 * (bw / n), 4.8, zS + 0.8]], 0.6);
  } else if (role === 'fuelFarm') {
    for (const [w, d, x, z] of [[L - 4, 0.6, 0, zN - 2], [L - 4, 0.6, 0, zS + 2], [0.6, D - 4, -L / 2 + 2, 0], [0.6, D - 4, L / 2 - 2, 0]] as const) f.box(w, 1.4, d, x, 0, z, M.offWhite);
    const tank = pbr(kit.scene, `tank-${id}`, '#e8e9e8', 0.45, 0.3);
    const band = pbr(kit.scene, `tank-band-${id}`, '#2f6f8f', 0.5, 0.3);
    const n = Math.max(1, Math.floor((L - 6) / 14));
    const dia = Math.min(11, (L - 6) / n - 2, D - 12);
    for (let k = 0; k < n; k++) {
      const x = -L / 2 + 3 + (k + 0.5) * ((L - 6) / n);
      const z = zN - 4 - dia / 2;
      f.cyl(dia, 9.5, x, 0, z, tank, { tess: 32 });
      f.cyl(dia + 0.1, 1, x, 7, z, band, { tess: 32 });
      f.cyl(1, 1.6, x, 9.5, z, M.offWhite, { top: 2, bottom: dia, tess: 32 });
    }
    for (let k = 0; k < 3; k++) f.cyl(0.6, L - 8, 0, 1.6 + k * 0.8, zS + 5, k === 1 ? M.hvac : M.yellow, { lying: true, tess: 10 });
    f.box(8, 4, 6, L / 2 - 8, 0, zS + 6, M.white);
    f.lamps(M.whiteLamp, [[-L / 2 + 3, 6, zS + 3], [L / 2 - 3, 6, zS + 3]], 0.7);
  } else {
    // de-icing pad: concrete with blue lines, two boom trucks, glycol tanks
    const pad = MeshBuilder.CreateGround('de-icing', { width: L - 2, height: D - 2 }, kit.scene);
    pad.parent = f.root;
    pad.position.y = 0.3;
    pad.material = pbr(kit.scene, `de-icing-${id}`, '#a6a7a2', 0.9);
    pad.receiveShadows = true;
    const blue = pbr(kit.scene, `de-icing-blue-${id}`, '#7fc4ff', 0.6);
    for (const [w, d, x, z] of [[L - 4, 0.5, 0, zN - 2], [L - 4, 0.5, 0, zS + 2], [0.5, D - 4, -L / 2 + 2, 0], [0.5, D - 4, L / 2 - 2, 0]] as const) f.box(w, 0.06, d, x, 0.3, z, blue);
    const body = pbr(kit.scene, `de-ice-truck-${id}`, '#e9a320', 0.45, 0.2, true);
    for (const [x, ry] of [[-L / 4, 0.4], [L / 4 - 4, -0.5]] as const) {
      const r = new TransformNode('de-ice-truck', kit.scene);
      r.parent = f.root;
      r.position.set(x, 0, 0);
      r.rotation.y = ry;
      const part = (w: number, h: number, d: number, px: number, py: number, pz: number, mat: PBRMaterial, rx = 0) => {
        const m = MeshBuilder.CreateBox('de-ice', { width: w, height: h, depth: d }, kit.scene);
        m.parent = r;
        m.position.set(px, py, pz);
        m.rotation.x = rx;
        m.material = mat;
        kit.caster(m);
      };
      part(2.6, 2.6, 8, 0, 1.9, 0, body);
      part(2.6, 2.2, 2.2, 0, 1.7, 5, M.white);
      part(0.6, 0.6, 11, 0, 7, -1, M.offWhite, -0.75);
      part(1.8, 1.6, 1.8, 0, 10.8, 3.2, body);
    }
    for (const x of [L / 2 - 5, L / 2 - 9]) f.cyl(3, 6, x, 0, zN - 5, M.white, { tess: 16 });
  }
  f.label(NAMES[role], 0, 0.12, zS + 1.6, Math.min(L - 4, 34), 3.2, '#cfd8d4');
  f.finish();
}
