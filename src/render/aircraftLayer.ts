import { Color3, MeshBuilder, StandardMaterial, TransformNode, type InstancedMesh, type Mesh, type Scene } from '@babylonjs/core';
import type { AircraftTypeId } from '../sim/aircraft';
import type { Flight } from '../sim/simulation';
import { aircraftMaterials, buildMaster, CARGO_LIVERY, MODELS, type AircraftMaterials, type Master } from './aircraftModels';
import { METRE, mapPoint } from './units';

/**
 * How much an aircraft is drawn at, so it fits the Stands of its size class (1 tile = 16 m): a Stand is 3 tiles deep
 * and 2 / 3 / 4 tiles wide. Small and Medium aircraft fit at real size; Large ones are drawn at about 60%.
 */
export function drawScale(type: AircraftTypeId): number {
  const m = MODELS[type];
  const width = { small: 2, medium: 3, large: 4 }[m.size] * 16;
  return Math.min(1, (3 * 16 * 0.95) / m.L, width / m.span);
}

/** Highest point of a landing or takeoff on the map, in world units (altitude 1). */
const CLIMB = 45;

interface Pose { x: number; y: number; heading: number }

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
  private minute = -1;
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
  }

  private master(type: AircraftTypeId, livery: number): Master {
    const key = `${type}:${livery}`;
    let m = this.masters.get(key);
    if (!m) {
      m = buildMaster(this.scene, type, livery, this.mats);
      for (const mesh of [...m.meshes, ...m.gear]) this.caster(mesh);
      this.masters.set(key, m);
    }
    return m;
  }

  private acquire(f: Flight): Visual {
    const livery = liveryFor(f);
    const key = `${f.type}:${livery}`;
    const pooled = this.free.get(key)?.pop();
    const at = { x: f.position?.x ?? 0, y: f.position?.y ?? 0, heading: f.heading };
    const phaseMs = [...f.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7);
    if (pooled) {
      pooled.root.setEnabled(true);
      return Object.assign(pooled, { from: at, to: { ...at }, altFrom: f.altitude, altTo: f.altitude, phaseMs });
    }
    const m = this.master(f.type, livery);
    const s = drawScale(f.type) * METRE;
    const root = new TransformNode(`ac-${f.id}`, this.scene);
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
    return { key, root, gear, nav, beacons, strobes, beam, props, discs, from: at, to: { ...at }, altFrom: f.altitude, altTo: f.altitude, phaseMs };
  }

  private release(v: Visual): void {
    v.root.setEnabled(false);
    this.free.set(v.key, [...(this.free.get(v.key) ?? []), v]);
  }

  /**
   * `darkness` 0 (day) … 0.6 (night) from the daylight curve; lights show as it gets dark. `minute` and `fraction` (how
   * far the Day is towards its next step) let aircraft glide between steps instead of jumping.
   */
  update(flights: readonly Flight[], darkness: number, nowMs: number, minute: number, fraction: number, litWindows: number): void {
    const stepped = minute !== this.minute;
    this.minute = minute;
    const present = new Set(flights.filter((f) => f.position).map((f) => f.id));
    for (const [id, v] of this.visuals) {
      if (!present.has(id)) {
        this.release(v);
        this.visuals.delete(id);
      }
    }
    for (const m of this.masters.values()) if (m.lit) m.lit.emissiveColor = Color3.White().scale(litWindows);
    const lightsOn = darkness > 0.1;
    let ringed = false;
    for (const f of flights) {
      if (!f.position) continue;
      let v = this.visuals.get(f.id);
      if (!v) {
        v = this.acquire(f);
        this.visuals.set(f.id, v);
      }
      if (stepped) {
        v.from = v.to;
        v.to = { x: f.position.x, y: f.position.y, heading: f.heading };
        v.altFrom = v.altTo;
        v.altTo = f.altitude;
        // a long jump (onto a Stand, a new phase) is not a glide
        if (Math.hypot(v.to.x - v.from.x, v.to.y - v.from.y) > 120) {
          v.from = { ...v.to };
          v.altFrom = v.altTo;
        }
      }
      const k = minute < 0 ? 1 : fraction;
      const turn = ((((v.to.heading - v.from.heading) % 360) + 540) % 360) - 180;
      const x = v.from.x + (v.to.x - v.from.x) * k;
      const y = v.from.y + (v.to.y - v.from.y) * k;
      const heading = ((v.from.heading + turn * k) * Math.PI) / 180;
      const alt = v.altFrom + (v.altTo - v.altFrom) * k;
      const p = mapPoint(x, y, alt * CLIMB);
      v.root.position.copyFrom(p);
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
  }

  /**
   * Builds one more of the masters a Day may need; called while nothing is flying (Plan Mode), so the first
   * appearance of a type during a Day doesn't stutter. False once all are built.
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
    return false;
  }
}
