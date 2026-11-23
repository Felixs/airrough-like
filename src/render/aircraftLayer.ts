import { Color3, MeshBuilder, StandardMaterial, TransformNode, Vector3, type InstancedMesh, type Mesh, type Scene } from '@babylonjs/core';
import type { AircraftTypeId } from '../sim/aircraft';
import type { Flight } from '../sim/simulation';
import { aircraftMaterials, buildMaster, CARGO_LIVERY, frontDoor, MODELS, pbr, type AircraftMaterials, type Master } from './aircraftModels';
import type { JetBridge } from './airfield';
import { METRE } from './units';

/**
 * How much an aircraft is drawn at, so it fits the Stands of its size class (1 tile = 16 m): a Stand is 3 tiles deep
 * and 2 / 3 / 4 tiles wide. Small and Medium aircraft fit at real size; Large ones are drawn at about 70%, overhanging their Stand a little.
 */
export function drawScale(type: AircraftTypeId): number {
  const m = MODELS[type];
  const width = { small: 2, medium: 3, large: 4 }[m.size] * 16;
  // wide-bodies may overhang their Stand a little (nose over the apron edge, wingtips over the lane)
  const give = m.size === 'large' ? 1.2 : 1;
  return Math.min(1, (3 * 16 * 0.95 * give) / m.L, (width * give) / m.span);
}

type VehicleMat = 'yellow' | 'white' | 'red' | 'grey' | 'uld' | 'dark' | 'glass';
type VehicleKind = 'tug' | 'cart' | 'belt' | 'fuel' | 'cater' | 'push' | 'gpu';
/** Ground vehicles as boxes: width (along the vehicle), height, depth, position, paint and an optional tilt (metres). */
const VEHICLES: Record<VehicleKind, ReadonlyArray<readonly [number, number, number, number, number, number, VehicleMat, number?]>> = {
  tug: [[2.8, 1.0, 1.7, 0, 0.75, 0, 'yellow'], [1.1, 0.9, 1.5, -0.6, 1.7, 0, 'glass'], [0.7, 0.55, 1.9, 0.9, 0.35, 0, 'dark'], [0.7, 0.55, 1.9, -0.9, 0.35, 0, 'dark']],
  cart: [[3.0, 0.3, 1.6, 0, 0.55, 0, 'grey'], [2.6, 1.6, 1.5, 0, 1.5, 0, 'uld'], [0.6, 0.45, 1.7, 1, 0.25, 0, 'dark'], [0.6, 0.45, 1.7, -1, 0.25, 0, 'dark']],
  belt: [[6.5, 0.9, 2.0, 0, 0.8, 0, 'white'], [8, 0.25, 0.9, 0.6, 2.3, 0, 'dark', 0.32], [1.4, 1.2, 1.7, -2.4, 1.8, 0, 'glass'], [0.8, 0.6, 2.1, 2, 0.3, 0, 'dark'], [0.8, 0.6, 2.1, -2, 0.3, 0, 'dark']],
  fuel: [[2.6, 2.4, 2.5, 4.4, 1.7, 0, 'red'], [1.2, 0.9, 2.4, 4.9, 2.2, 0, 'glass'], [8, 2.4, 2.4, -1, 2.0, 0, 'white'], [12, 0.7, 2.4, 0, 0.6, 0, 'dark']],
  cater: [[2.4, 2.4, 2.4, 3.4, 1.6, 0, 'white'], [1.0, 0.9, 2.3, 4.0, 2.1, 0, 'glass'], [6.5, 2.8, 2.5, -1, 4.2, 0, 'white'], [7, 0.8, 2.4, 0, 0.7, 0, 'dark'], [4, 2.2, 2.2, -1, 2.1, 0, 'grey']],
  push: [[6, 1.3, 3.0, 0, 0.9, 0, 'yellow'], [1.3, 1.0, 1.6, -2.2, 2.0, 0, 'glass'], [6.2, 0.6, 3.1, 0, 0.35, 0, 'dark']],
  gpu: [[2.2, 1.4, 1.4, 0, 1.0, 0, 'white'], [2.2, 0.4, 1.4, 0, 0.2, 0, 'dark']],
};

/** Highest point of a landing or takeoff on the map, in world units (altitude 1). */
const CLIMB = 45;

/** Where an aircraft is at a step: sim world units, heading in degrees, and whether it is parked (Stand or Bay). */
interface Pose { x: number; y: number; heading: number; parked: boolean }

const PARKED = new Set<Flight['phase']>(['onStand', 'inBay']);
const poseOf = (f: Flight): Pose => ({ x: f.position?.x ?? 0, y: f.position?.y ?? 0, heading: f.heading, parked: PARKED.has(f.phase) });
const headingOf = (dx: number, dy: number, fallback: number) => (dx * dx + dy * dy < 1e-9 ? fallback : (Math.atan2(dx, -dy) * 180) / Math.PI);
const turnTo = (from: number, to: number, k: number) => from + (((((to - from) % 360) + 540) % 360) - 180) * k;

/** A point on the map with a heading (degrees); `between` writes into one, so the frame loop allocates nothing. */
interface Spot { x: number; y: number; heading: number }
const place = (out: Spot, x: number, y: number, heading: number): Spot => {
  out.x = x;
  out.y = y;
  out.heading = heading;
  return out;
};

/**
 * Where an aircraft is `k` (0…1) of the way between two steps. Into a Stand or Bay it follows the lead-in: a smooth turn
 * off the taxilane onto the centre line, then straight in, nose first. Out of one it is pushed back straight along the
 * centre line, tail first, then turns onto the taxilane. Elsewhere it glides in a straight line.
 */
function between(a: Pose, b: Pose, k: number, out: Spot): Spot {
  if (b.parked && !a.parked) {
    // the centre line runs through the Stand's middle (b) along its parked heading; P is where the lane meets it
    const dx = Math.sin((b.heading * Math.PI) / 180);
    const dy = -Math.cos((b.heading * Math.PI) / 180);
    const along = (a.x - b.x) * dx + (a.y - b.y) * dy;
    const px = b.x + dx * along;
    const py = b.y + dy * along;
    const u = 1 - k;
    const x = u * u * a.x + 2 * u * k * px + k * k * b.x;
    const y = u * u * a.y + 2 * u * k * py + k * k * b.y;
    const tx = u * (px - a.x) + k * (b.x - px);
    const ty = u * (py - a.y) + k * (b.y - py);
    return place(out, x, y, headingOf(tx, ty, b.heading));
  }
  if (a.parked && !b.parked) {
    const dx = Math.sin((a.heading * Math.PI) / 180);
    const dy = -Math.cos((a.heading * Math.PI) / 180);
    const along = (b.x - a.x) * dx + (b.y - a.y) * dy;
    const px = a.x + dx * along;
    const py = a.y + dy * along;
    if (k < 0.6) {
      const q = k / 0.6;
      return place(out, a.x + (px - a.x) * q, a.y + (py - a.y) * q, a.heading);
    }
    const q = (k - 0.6) / 0.4;
    return place(out, px + (b.x - px) * q, py + (b.y - py) * q, turnTo(a.heading, b.heading, q));
  }
  return place(out, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, turnTo(a.heading, b.heading, k));
}

interface Visual {
  readonly key: string;
  readonly root: TransformNode;
  readonly gear: TransformNode;
  readonly nav: InstancedMesh[];
  readonly beacons: Array<{ m: InstancedMesh; phase: number }>;
  readonly strobes: InstancedMesh[];
  readonly beam: InstancedMesh;
  readonly props: TransformNode[];
  readonly discs: InstancedMesh[];
  /** Ground vehicles round the aircraft while it is on its Stand. */
  readonly service: TransformNode;
  /** The fuselage, and its front left door in the fuselage's frame (for jet bridges). */
  readonly body: TransformNode;
  readonly door: Vector3;
  from: Pose;
  to: Pose;
  altFrom: number;
  altTo: number;
  phaseMs: number;
}

const ON_RUNWAY = new Set<Flight['phase']>(['landing', 'takeoff']);
const MOVING = new Set<Flight['phase']>(['landing', 'takeoff', 'taxiIn', 'taxiOut', 'holdShort']);

/** The two made-up liveries each passenger type flies in (cargo types fly the cargo livery). */
const LIVERIES_OF: Record<AircraftTypeId, readonly number[]> = {
  C208: [1, 2], C208F: [CARGO_LIVERY], Q400: [3, 1], A320: [0, 1], B738: [2, 3], B738F: [CARGO_LIVERY], A350: [0, 2], B77W: [1, 3], B748F: [CARGO_LIVERY],
};

/** One livery per airline (by its callsign prefix), so an airline's aircraft look alike. */
function liveryFor(f: Flight): number {
  const options = LIVERIES_OF[f.type];
  const airline = (f.callsign ?? f.id).split(' ')[0] ?? '';
  let h = 7;
  for (const ch of airline) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return options[h % options.length] ?? CARGO_LIVERY;
}

/**
 * Compiles a master's shaders for drawing through instances now, rather than on the frame the first instance shows up.
 */
function compileForInstances(mesh: Mesh): void {
  mesh.material?.forceCompilation(mesh, undefined, { useInstances: true });
}

/**
 * Keeps one 3D aircraft per flight on the airfield in sync with the simulation (Holding aircraft are not drawn). Each
 * aircraft is a set of instances of its type's master, so all aircraft of a type and livery cost one draw call per part.
 */
export class AircraftLayer {
  private readonly mats: AircraftMaterials;
  private readonly masters = new Map<string, Master>();
  private readonly lightMasters: Record<'red' | 'green' | 'white', Mesh>;
  private readonly beamMaster: Mesh;
  private readonly bladeMaster: Mesh;
  private readonly discMaster: Mesh;
  private readonly visuals = new Map<string, Visual>();
  private readonly free = new Map<string, Visual[]>();
  private readonly ring: Mesh;
  private readonly vehicleParts: Record<VehicleMat, Mesh>;
  private minute = -1;
  private litWindows = -1;
  /** Scratch space reused every frame (no allocations while drawing). */
  private readonly present = new Set<string>();
  private readonly docked = new Set<JetBridge>();
  private readonly spot: Spot = { x: 0, y: 0, heading: 0 };
  private readonly doorAt = new Vector3();
  private readonly doorOut = new Vector3();
  /** The airfield's jet bridges by Stand id; parked jets dock them. */
  bridges: ReadonlyMap<string, JetBridge> = new Map();
  /** Reduce motion: the beacon glows steadily and the strobes stay off instead of flashing. */
  calm = false;
  /** The aircraft picked in the flight strips or alerts: drawn with a ring round it. */
  highlight: string | undefined;

  constructor(private readonly scene: Scene, glow: (m: Mesh) => void, private readonly caster: (m: Mesh) => void) {
    this.mats = aircraftMaterials(scene);
    const light = (name: string, hex: string) => {
      const mat = new StandardMaterial(name, scene);
      mat.disableLighting = true;
      mat.emissiveColor = Color3.FromHexString(hex);
      const s = MeshBuilder.CreateSphere(name, { diameter: 1, segments: 4 }, scene);
      s.material = mat;
      s.isVisible = false;
      s.isPickable = false;
      glow(s);
      return s;
    };
    this.lightMasters = { red: light('nav-red', '#ff2020'), green: light('nav-green', '#20ff60'), white: light('nav-white', '#ffffff') };
    const beamMat = new StandardMaterial('beam', scene);
    beamMat.disableLighting = true;
    beamMat.emissiveColor = Color3.FromHexString('#fff1d0');
    beamMat.alpha = 0.08;
    beamMat.backFaceCulling = false;
    this.beamMaster = MeshBuilder.CreateCylinder('beam', { height: 1, diameterTop: 0.3, diameterBottom: 0.005, tessellation: 14 }, scene);
    this.beamMaster.rotation.z = -Math.PI / 2;
    this.beamMaster.bakeCurrentTransformIntoVertices();
    this.beamMaster.material = beamMat;
    this.beamMaster.isVisible = false;
    this.bladeMaster = MeshBuilder.CreateBox('blade', { size: 1 }, scene);
    this.bladeMaster.material = this.mats.metal;
    this.bladeMaster.isVisible = false;
    caster(this.bladeMaster);
    const discMat = new StandardMaterial('prop-disc', scene);
    discMat.diffuseColor = new Color3(0.12, 0.12, 0.14);
    discMat.alpha = 0.13;
    discMat.backFaceCulling = false;
    this.discMaster = MeshBuilder.CreateDisc('prop-disc', { radius: 0.5, tessellation: 28 }, scene);
    this.discMaster.rotation.y = -Math.PI / 2;
    this.discMaster.bakeCurrentTransformIntoVertices();
    this.discMaster.material = discMat;
    this.discMaster.isVisible = false;
    const ringMat = new StandardMaterial('highlight', scene);
    ringMat.disableLighting = true;
    ringMat.emissiveColor = Color3.FromHexString('#f0d24a');
    this.ring = MeshBuilder.CreateTorus('highlight', { diameter: 1, thickness: 0.06, tessellation: 48 }, scene);
    this.ring.material = ringMat;
    this.ring.isPickable = false;
    this.ring.setEnabled(false);
    glow(this.ring);
    const paint = (name: string, hex: string, rough = 0.45, metal = 0) => {
      const box = MeshBuilder.CreateBox(`vehicle-${name}`, { size: 1 }, scene);
      box.material = pbr(scene, `vehicle-${name}`, hex, rough, metal, rough < 0.5);
      box.isVisible = false;
      box.isPickable = false;
      caster(box);
      return box;
    };
    this.vehicleParts = {
      yellow: paint('yellow', '#f2b705'), white: paint('white', '#f1f2f3'), red: paint('red', '#c62828'), grey: paint('grey', '#8b9199', 0.5, 0.3),
      uld: paint('uld', '#c4c8cc', 0.3, 0.75), dark: paint('dark', '#1a1c20', 0.7), glass: paint('glass', '#10161e', 0.08, 0.1),
    };
    for (const m of [...Object.values(this.lightMasters), this.beamMaster, this.bladeMaster, this.discMaster, ...Object.values(this.vehicleParts)]) compileForInstances(m);
  }

  /** Pushback tug, ground power, belt loaders with baggage trains, a fuel truck and a catering truck round an aircraft. */
  private buildService(root: TransformNode, type: AircraftTypeId, scale: number, seed: number): TransformNode {
    const m = MODELS[type];
    const service = new TransformNode('service', this.scene);
    service.parent = root;
    service.scaling.setAll(1 / scale); // vehicles at real size, placed round the (possibly shrunk) aircraft
    const nose = (m.L / 2) * scale;
    const side = -(m.R * scale + 1); // the right-hand side (−z), where the holds and service doors are
    const put = (kind: VehicleKind, x: number, z: number, yaw: number) => {
      const v = new TransformNode(kind, this.scene);
      v.parent = service;
      v.position.set(x, 0, z);
      v.rotation.y = yaw;
      for (const [w, h, d, px, py, pz, mat, pitch] of VEHICLES[kind]) {
        const part = this.vehicleParts[mat].createInstance('part');
        part.parent = v;
        part.scaling.set(w, h, d);
        part.position.set(px, py, pz);
        if (pitch) part.rotation.z = pitch;
      }
    };
    const r = (k: number) => ((seed * 9301 + k * 49297) % 233280) / 233280;
    put('push', nose + 5.5, 0, Math.PI);
    if (r(1) < 0.7) put('gpu', nose - 6, side - 1.6, 0);
    const holds = m.size === 'large' ? [nose * 0.4, -nose * 0.45] : [-nose * 0.45];
    for (const hx of holds) {
      put('belt', hx, side - 2.6, 0.22);
      put('tug', hx - 6, side - 8, 0);
      const carts = 2 + Math.floor(r(2) * 3);
      for (let i = 0; i < carts; i++) put('cart', hx - 10 - i * 4.2, side - 8, 0);
    }
    if (m.size !== 'small' && r(3) < 0.65) put('fuel', nose - (m.wing.pos * m.L + m.wing.root * 0.2) * scale, -(m.span / 2) * scale * 0.42, Math.PI);
    if (m.size !== 'small' && !m.cargo && r(4) < 0.7) put('cater', nose - (m.tc - 0.02) * m.L * scale, side - 4.2, -Math.PI / 2);
    service.setEnabled(false);
    return service;
  }

  private master(type: AircraftTypeId, livery: number): Master {
    const key = `${type}:${livery}`;
    let m = this.masters.get(key);
    if (!m) {
      m = buildMaster(this.scene, type, livery, this.mats);
      for (const mesh of [...m.meshes, ...m.gear]) {
        this.caster(mesh);
        compileForInstances(mesh);
      }
      if (this.litWindows >= 0) m.lit?.emissiveColor.set(this.litWindows, this.litWindows, this.litWindows);
      this.masters.set(key, m);
    }
    return m;
  }

  private acquire(f: Flight): Visual {
    const livery = liveryFor(f);
    const key = `${f.type}:${livery}`;
    const at = poseOf(f);
    let phaseMs = 7;
    for (let i = 0; i < f.id.length; i++) phaseMs = (phaseMs * 31 + f.id.charCodeAt(i)) % 997;
    const v = this.free.get(key)?.pop() ?? this.build(f.type, livery, phaseMs);
    v.root.setEnabled(true);
    return Object.assign(v, { from: at, to: { ...at }, altFrom: f.altitude, altTo: f.altitude, phaseMs });
  }

  /** A new aircraft of a type and livery (disabled until acquired); `seed` picks its ground vehicles. */
  private build(type: AircraftTypeId, livery: number, seed: number): Visual {
    const key = `${type}:${livery}`;
    const m = this.master(type, livery);
    const s = drawScale(type) * METRE;
    const root = new TransformNode(`ac-${key}`, this.scene);
    root.setEnabled(false);
    root.scaling.setAll(s);
    const body = new TransformNode('body', this.scene);
    body.parent = root;
    body.position.y = m.bodyY;
    const gear = new TransformNode('gear', this.scene);
    gear.parent = body;
    for (const mesh of m.meshes) mesh.createInstance('part').parent = body;
    for (const mesh of m.gear) mesh.createInstance('gear').parent = gear;
    const size = 0.35 + m.model.R * 0.07;
    const nav: InstancedMesh[] = [];
    const beacons: Array<{ m: InstancedMesh; phase: number }> = [];
    const strobes: InstancedMesh[] = [];
    for (const l of m.lights) {
      const i = this.lightMasters[l.colour].createInstance('light');
      i.parent = body;
      i.position.copyFrom(l.at);
      i.scaling.setAll(size * (l.role === 'strobe' ? 1.2 : 1));
      if (l.role === 'nav') nav.push(i);
      else if (l.role === 'beacon') beacons.push({ m: i, phase: l.phase });
      else strobes.push(i);
    }
    const beam = this.beamMaster.createInstance('beam');
    beam.parent = body;
    beam.scaling.set(110, 90, 90);
    beam.position.set(m.model.L / 2 + 55, -m.model.R * 0.6, 0);
    const props: TransformNode[] = [];
    const discs: InstancedMesh[] = [];
    for (const p of m.props) {
      const hub = new TransformNode('hub', this.scene);
      hub.parent = body;
      hub.position.copyFrom(p.at);
      for (let i = 0; i < p.blades; i++) {
        const arm = new TransformNode('arm', this.scene);
        arm.parent = hub;
        arm.rotation.x = (i / p.blades) * Math.PI * 2;
        const blade = this.bladeMaster.createInstance('blade');
        blade.parent = arm;
        blade.scaling.set(0.1, p.dia * 0.47, p.dia * 0.07);
        blade.position.y = p.dia * 0.25;
        blade.rotation.y = 0.35;
      }
      const disc = this.discMaster.createInstance('disc');
      disc.parent = hub;
      disc.scaling.setAll(p.dia);
      discs.push(disc);
      props.push(hub);
    }
    const service = this.buildService(root, type, drawScale(type), seed);
    const at: Pose = { x: 0, y: 0, heading: 0, parked: false };
    return { key, root, gear, nav, beacons, strobes, beam, props, discs, service, body, door: frontDoor(type), from: at, to: { ...at }, altFrom: 0, altTo: 0, phaseMs: seed };
  }

  private release(v: Visual): void {
    v.root.setEnabled(false);
    const pool = this.free.get(v.key);
    if (pool) pool.push(v);
    else this.free.set(v.key, [v]);
  }

  /**
   * `darkness` 0 (day) … 0.6 (night) from the daylight curve; lights show as it gets dark. `minute` and `fraction` (how
   * far the Day is towards its next step) let aircraft glide between steps instead of jumping.
   */
  update(flights: readonly Flight[], darkness: number, nowMs: number, minute: number, fraction: number, litWindows: number): void {
    const stepped = minute !== this.minute;
    this.minute = minute;
    const present = this.present;
    present.clear();
    for (const f of flights) if (f.position) present.add(f.id);
    for (const [id, v] of this.visuals) {
      if (!present.has(id)) {
        this.release(v);
        this.visuals.delete(id);
      }
    }
    if (litWindows !== this.litWindows) {
      this.litWindows = litWindows;
      for (const m of this.masters.values()) m.lit?.emissiveColor.set(litWindows, litWindows, litWindows);
    }
    const lightsOn = darkness > 0.1;
    let ringed = false;
    const docked = this.docked;
    docked.clear();
    for (const f of flights) {
      if (!f.position) continue;
      let v = this.visuals.get(f.id);
      if (!v) {
        v = this.acquire(f);
        this.visuals.set(f.id, v);
      }
      if (stepped) {
        v.from = v.to;
        v.to = poseOf(f);
        v.altFrom = v.altTo;
        v.altTo = f.altitude;
        // a long jump (onto a Stand, a new phase) is not a glide
        if (Math.hypot(v.to.x - v.from.x, v.to.y - v.from.y) > 120) {
          v.from = { ...v.to };
          v.altFrom = v.altTo;
        }
      }
      const k = minute < 0 ? 1 : fraction;
      const pose = between(v.from, v.to, k, this.spot);
      const heading = (pose.heading * Math.PI) / 180;
      const alt = v.altFrom + (v.altTo - v.altFrom) * k;
      // on the map (see units.ts: sim (x, y) is drawn at (x, height, −y))
      const p = v.root.position.set(pose.x, alt * CLIMB, -pose.y);
      // heading 0 = north (+z), 90 = east (+x); the model's nose points along +x
      v.root.rotation.y = Math.atan2(-Math.cos(heading), Math.sin(heading));
      const climbing = v.altTo > v.altFrom;
      v.root.rotation.z = alt > 0.01 ? (climbing ? 0.14 : -0.03) : 0;
      v.gear.setEnabled(alt < 0.35);
      const runway = ON_RUNWAY.has(f.phase);
      const moving = MOVING.has(f.phase);
      const t = (nowMs + v.phaseMs) % 1200;
      for (const n of v.nav) n.isVisible = lightsOn && f.phase !== 'onStand' && f.phase !== 'inBay';
      for (const b of v.beacons) b.m.isVisible = moving && (this.calm || (t + b.phase * 500) % 1000 < 130);
      for (const s of v.strobes) s.isVisible = !this.calm && runway && (t < 60 || (t > 160 && t < 220));
      v.beam.isVisible = lightsOn && (runway || alt > 0.01);
      // ground vehicles and the jet bridge once the aircraft has come to a stop on its Stand
      const settled = f.phase === 'onStand' && v.from.parked;
      v.service.setEnabled(settled);
      const bridge = settled && f.standId && MODELS[f.type].size !== 'small' ? this.bridges.get(f.standId) : undefined;
      if (bridge) {
        v.root.computeWorldMatrix(true);
        const world = v.body.computeWorldMatrix(true);
        Vector3.TransformCoordinatesToRef(v.door, world, this.doorAt);
        Vector3.TransformNormalFromFloatsToRef(0, 0, 1, world, this.doorOut);
        bridge.dock(this.doorAt, this.doorOut.normalize());
        docked.add(bridge);
      }
      const spinning = moving || f.phase === 'holdShort';
      for (const h of v.props) if (spinning) h.rotation.x += 0.9;
      for (const d of v.discs) d.isVisible = spinning;
      if (f.id === this.highlight) {
        ringed = true;
        const radius = (MODELS[f.type].L * drawScale(f.type) * METRE) * 0.75 + 4;
        const pulse = this.calm ? 1 : 0.75 + 0.25 * Math.sin(nowMs / 250);
        this.ring.setEnabled(true);
        this.ring.position.set(p.x, p.y + 1.5, p.z);
        this.ring.scaling.setAll(radius * 2 * pulse);
      }
    }
    if (!ringed) this.ring.setEnabled(false);
    for (const b of this.bridges.values()) if (!docked.has(b)) b.dock(null);
  }

  /**
   * Builds one more thing a Day may need: first the master of every type and livery, then one spare aircraft of each
   * (kept hidden for the first flight that needs it). Called while nothing is flying (menus, Plan Mode), so the first
   * appearance of a type during a Day doesn't stutter. False once everything is built.
   */
  prewarmStep(): boolean {
    for (const type of Object.keys(LIVERIES_OF) as AircraftTypeId[]) {
      for (const l of LIVERIES_OF[type]) {
        if (!this.masters.has(`${type}:${l}`)) {
          this.master(type, l);
          return true;
        }
      }
    }
    for (const type of Object.keys(LIVERIES_OF) as AircraftTypeId[]) {
      for (const l of LIVERIES_OF[type]) {
        const key = `${type}:${l}`;
        if (this.spared.has(key)) continue;
        this.spared.add(key);
        if (!this.free.get(key)?.length) this.release(this.build(type, l, this.spared.size * 131));
        return true;
      }
    }
    return false;
  }

  /** Types and liveries that already have a spare aircraft (or had one in use). */
  private readonly spared = new Set<string>();
}
