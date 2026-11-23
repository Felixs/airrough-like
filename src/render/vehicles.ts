/**
 * Ground support vehicles round a parked aircraft, modelled in metres: each points its front along +x, stands on y = 0
 * and is centred on its footprint. Every kind is built once and merged into one mesh per paint, so a vehicle on the
 * apron is a handful of instances.
 */
import { Mesh, MeshBuilder, TransformNode, type Scene } from '@babylonjs/core';
import { pbr } from './aircraftModels';

export type VehicleKind = 'tug' | 'cart' | 'belt' | 'fuel' | 'cater' | 'push' | 'gpu';
type Paint = 'yellow' | 'orange' | 'white' | 'grey' | 'alu' | 'dark' | 'glass';

/** GSE paints: colour, roughness, metalness, clear coat. */
const PAINTS: Record<Paint, readonly [string, number, number, boolean]> = {
  yellow: ['#f2b705', 0.42, 0, true],
  orange: ['#e8711c', 0.42, 0, true],
  white: ['#eef0f1', 0.42, 0, true],
  grey: ['#7d848c', 0.5, 0.35, false],
  alu: ['#c6cacf', 0.3, 0.75, false],
  dark: ['#1b1d21', 0.75, 0, false],
  glass: ['#141c26', 0.06, 0.2, false],
};

/** Collects a vehicle's parts by paint while it is built. */
class Parts {
  readonly byPaint = new Map<Paint, Mesh[]>();
  private readonly nodes: TransformNode[] = [];
  constructor(private readonly scene: Scene) {}
  private add(m: Mesh, paint: Paint, parent?: TransformNode): Mesh {
    if (parent) m.parent = parent;
    const list = this.byPaint.get(paint);
    if (list) list.push(m);
    else this.byPaint.set(paint, [m]);
    return m;
  }
  /** A frame turned by `rz` (nose up) round (x, y, z), for parts that tilt together. */
  pivot(x: number, y: number, z: number, rz: number): TransformNode {
    const n = new TransformNode('pivot', this.scene);
    n.position.set(x, y, z);
    n.rotation.z = rz;
    this.nodes.push(n);
    return n;
  }
  /** A box w (along x) × h × d (across, z) centred on (x, y, z). */
  box(paint: Paint, w: number, h: number, d: number, x: number, y: number, z: number, o: { rz?: number; rx?: number; parent?: TransformNode } = {}): Mesh {
    const m = MeshBuilder.CreateBox('vp', { width: w, height: h, depth: d }, this.scene);
    m.position.set(x, y, z);
    if (o.rz) m.rotation.z = o.rz;
    if (o.rx) m.rotation.x = o.rx;
    return this.add(m, paint, o.parent);
  }
  /** A cylinder lying along x (a tank), centred on (x, y, z). */
  tube(paint: Paint, dia: number, len: number, x: number, y: number, z: number): Mesh {
    const m = MeshBuilder.CreateCylinder('vp', { diameter: dia, height: len, tessellation: 18 }, this.scene);
    m.rotation.z = Math.PI / 2;
    m.position.set(x, y, z);
    return this.add(m, paint);
  }
  /** A pair of wheels (tyre and hub) on an axle at x, `track` apart. */
  axle(x: number, r: number, width: number, track: number): void {
    for (const z of [-track / 2, track / 2]) {
      const tyre = MeshBuilder.CreateCylinder('vp', { diameter: 2 * r, height: width, tessellation: 14 }, this.scene);
      tyre.rotation.x = Math.PI / 2;
      tyre.position.set(x, r, z);
      this.add(tyre, 'dark');
      const hub = MeshBuilder.CreateCylinder('vp', { diameter: r * 1.1, height: width + 0.04, tessellation: 10 }, this.scene);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(x, r, z);
      this.add(hub, 'grey');
    }
  }
  /** A cab: painted shell below a window band all round, corner posts and a roof; its floor at y0, centred on (x, z). */
  cab(paint: Paint, w: number, h: number, d: number, x: number, y0: number, glassFrom = 0.45, z = 0): void {
    this.box(paint, w, h * glassFrom, d, x, y0 + (h * glassFrom) / 2, z);
    this.box('glass', w - 0.08, h * (1 - glassFrom) - 0.12, d - 0.08, x, y0 + h * glassFrom + (h * (1 - glassFrom) - 0.12) / 2, z);
    for (const sx of [-w / 2 + 0.05, w / 2 - 0.05]) for (const sz of [-d / 2 + 0.05, d / 2 - 0.05]) this.box(paint, 0.1, h * (1 - glassFrom), 0.1, x + sx, y0 + h * (1 + glassFrom) / 2 - 0.06, z + sz);
    this.box(paint, w + 0.06, 0.12, d + 0.06, x, y0 + h - 0.06, z);
  }
  /** Merges the parts into one mesh per paint (the pivots go). */
  done(): Map<Paint, Mesh> {
    const out = new Map<Paint, Mesh>();
    for (const [paint, list] of this.byPaint) {
      const merged = list.length > 1 ? Mesh.MergeMeshes(list, true, true) : list[0]!;
      if (merged) out.set(paint, merged);
    }
    for (const n of this.nodes) n.dispose();
    return out;
  }
}

/** Baggage tractor: low yellow body with the engine in front, an open cab with a roof and a beacon. */
function tug(p: Parts): void {
  p.box('dark', 2.9, 0.3, 1.4, 0, 0.42, 0);
  p.box('yellow', 2.9, 0.55, 1.5, 0, 0.82, 0);
  p.box('yellow', 1.2, 0.3, 1.4, 0.75, 1.22, 0); // bonnet
  p.cab('yellow', 1.2, 1.15, 1.45, -0.65, 1.1, 0.2);
  p.box('orange', 0.18, 0.14, 0.18, -0.65, 2.32, 0);
  p.box('dark', 0.3, 0.12, 0.12, -1.55, 0.5, 0); // hitch
  p.axle(0.9, 0.33, 0.28, 1.45);
  p.axle(-0.9, 0.33, 0.28, 1.45);
}

/** Baggage cart with an aluminium container (LD3 outline: square, one corner cut) and a dark net door. */
function cart(p: Parts): void {
  p.box('grey', 3.0, 0.14, 1.6, 0, 0.55, 0);
  p.box('dark', 1.1, 0.08, 0.08, 2.0, 0.45, 0); // drawbar
  p.axle(1.05, 0.22, 0.2, 1.4);
  p.axle(-1.05, 0.22, 0.2, 1.4);
  p.box('alu', 2.3, 1.05, 1.5, 0, 1.15, 0);
  p.box('alu', 2.3, 0.55, 1.05, 0, 1.95, 0.22);
  p.box('alu', 2.3, 0.71, 0.05, 0, 1.95, -0.53, { rx: 0.68 }); // the cut corner
  p.box('dark', 2.0, 1.25, 0.03, 0, 1.35, 0.76);
  p.box('orange', 2.32, 0.08, 1.52, 0, 0.66, 0); // base rail
}

/** Belt loader: white chassis, low cab at the back, an inclined conveyor with rails on struts. */
function belt(p: Parts): void {
  p.box('dark', 6.0, 0.25, 1.8, 0, 0.42, 0);
  p.box('white', 6.0, 0.6, 2.0, 0, 0.82, 0);
  // the cab sits beside the conveyor's low end
  p.cab('white', 1.5, 1.3, 0.85, -2.3, 1.12, 0.25, -0.55);
  p.box('orange', 0.18, 0.14, 0.18, -2.3, 2.5, -0.55);
  const c = p.pivot(0.6, 2.15, 0.45, 0.3);
  p.box('grey', 8.0, 0.28, 1.0, 0, 0, 0, { parent: c });
  p.box('dark', 7.9, 0.05, 0.82, 0, 0.16, 0, { parent: c });
  for (const z of [-0.52, 0.52]) p.box('yellow', 8.0, 0.22, 0.06, 0, 0.32, z, { parent: c });
  for (const z of [0.1, 0.8]) {
    p.box('grey', 0.14, 1.7, 0.14, 2.3, 1.75, z);
    p.box('grey', 0.14, 1.1, 0.14, -0.6, 1.4, z);
  }
  p.axle(2.1, 0.38, 0.3, 1.9);
  p.axle(-2.1, 0.38, 0.3, 1.9);
}

/** Fuel truck: white cab, aluminium tank with ribs and a walkway rail, hose cabinet at the back. */
function fuel(p: Parts): void {
  p.box('dark', 11, 0.4, 2.1, 0, 0.75, 0);
  p.cab('white', 2.3, 2.2, 2.45, 4.55, 0.85, 0.45);
  p.box('dark', 0.2, 0.45, 2.45, 5.75, 0.95, 0); // bumper
  p.box('orange', 0.2, 0.15, 0.6, 4.55, 3.12, 0);
  p.tube('alu', 2.3, 7.4, -0.9, 2.25, 0);
  for (const x of [-4.4, -0.9, 2.6]) p.tube('white', 2.36, 0.35, x, 2.25, 0);
  for (const z of [-0.55, 0.55]) {
    p.box('grey', 7.0, 0.07, 0.07, -0.9, 3.75, z);
    for (const x of [-4, -0.9, 2.2]) p.box('grey', 0.06, 0.5, 0.06, x, 3.5, z);
  }
  p.box('grey', 1.0, 1.6, 2.3, -5.0, 1.75, 0);
  p.box('dark', 0.05, 1.1, 1.8, -5.52, 1.75, 0);
  p.axle(4.3, 0.5, 0.4, 2.0);
  p.axle(-2.0, 0.5, 0.4, 2.0);
  p.axle(-3.2, 0.5, 0.4, 2.0);
}

/** Catering truck: white cab, a white box raised on a scissor lift to the rear door, a platform in front of the box. */
function cater(p: Parts): void {
  p.box('dark', 8, 0.4, 2.2, 0, 0.75, 0);
  p.cab('white', 2.2, 2.1, 2.4, 3.5, 0.85, 0.45);
  p.box('dark', 0.2, 0.45, 2.4, 4.65, 0.95, 0);
  p.box('orange', 0.2, 0.15, 0.6, 3.5, 3.0, 0);
  p.box('grey', 5.6, 0.3, 2.1, -1.0, 1.1, 0);
  for (const z of [-0.95, 0.95]) for (const rz of [-0.5, 0.5]) p.box('grey', 5.6, 0.16, 0.12, -1.0, 2.15, z, { rz });
  p.box('white', 6.4, 2.6, 2.5, -1.0, 4.55, 0);
  p.box('orange', 6.42, 0.25, 2.52, -1.0, 3.55, 0);
  p.box('grey', 1.0, 0.1, 2.3, 2.7, 3.25, 0); // platform
  for (const z of [-1.1, 1.1]) {
    p.box('yellow', 1.0, 0.06, 0.06, 2.7, 4.2, z);
    p.box('yellow', 0.06, 0.95, 0.06, 3.17, 3.75, z);
  }
  p.axle(3.1, 0.45, 0.38, 2.0);
  p.axle(-2.4, 0.45, 0.38, 2.0);
}

/** Towbar pushback tractor: a long, low, heavy yellow body, cab at the back end, towbar out to the nose gear. */
function push(p: Parts): void {
  p.box('dark', 6.0, 0.45, 2.8, 0, 0.5, 0);
  p.box('yellow', 5.8, 0.75, 3.0, 0, 1.05, 0);
  p.box('yellow', 2.4, 0.2, 2.6, 1.4, 1.52, 0);
  p.cab('yellow', 1.4, 1.2, 1.9, -2.05, 1.42, 0.2);
  p.box('orange', 0.2, 0.15, 0.2, -2.05, 2.7, 0);
  p.box('dark', 0.15, 0.25, 3.0, 2.95, 0.8, 0); // bumper
  p.box('grey', 3.0, 0.14, 0.14, 4.4, 0.6, 0); // towbar
  p.axle(1.9, 0.55, 0.5, 2.6);
  p.axle(-1.9, 0.55, 0.5, 2.6);
}

/** Ground power unit: a small trailer with a louvred white housing and a cable reel. */
function gpu(p: Parts): void {
  p.box('dark', 2.4, 0.18, 1.3, 0, 0.45, 0);
  p.box('dark', 1.0, 0.08, 0.08, 1.65, 0.45, 0);
  p.box('white', 2.2, 1.25, 1.4, 0, 1.17, 0);
  for (const y of [0.85, 1.05, 1.25]) p.box('dark', 1.4, 0.06, 1.42, -0.2, y, 0);
  p.box('grey', 0.6, 0.45, 0.5, 0.6, 2.0, 0);
  p.axle(-0.1, 0.3, 0.2, 1.45);
}

const BUILD: Record<VehicleKind, (p: Parts) => void> = { tug, cart, belt, fuel, cater, push, gpu };

/** One hidden master mesh per kind and paint, to be instanced; `caster` lets them cast shadows. */
export function vehicleMasters(scene: Scene, caster: (m: Mesh) => void): Record<VehicleKind, Mesh[]> {
  const mats = new Map(Object.entries(PAINTS).map(([name, [hex, rough, metal, clear]]) => [name, pbr(scene, `vehicle-${name}`, hex, rough, metal, clear)]));
  const out = {} as Record<VehicleKind, Mesh[]>;
  for (const kind of Object.keys(BUILD) as VehicleKind[]) {
    const parts = new Parts(scene);
    BUILD[kind](parts);
    out[kind] = [...parts.done()].map(([paint, mesh]) => {
      mesh.name = `vehicle-${kind}-${paint}`;
      mesh.material = mats.get(paint)!;
      mesh.isVisible = false;
      mesh.isPickable = false;
      caster(mesh);
      return mesh;
    });
  }
  return out;
}
