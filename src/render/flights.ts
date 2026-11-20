import { Container, Graphics, GraphicsPath } from 'pixi.js';
import type { AircraftTypeId } from '../sim/aircraft';
import type { Flight } from '../sim/simulation';

/**
 * Top-down aircraft, nose up, drawn in a 40-unit frame (nose y −20, tail y +20) and scaled to the aircraft's length.
 * Each type has its own silhouette so it can be told apart at a glance: wing sweep and span, wingtip devices, nose
 * shape, engine count and size, props, T-tail, the 747's hump, the A350's dark cockpit mask, and window lines on
 * passenger aircraft (freighters have none).
 */
interface Spec {
  /** Length on the map, in world units. */
  readonly length: number;
  /** Fuselage half-width. */
  readonly body: number;
  readonly nose: 'round' | 'pointed' | 'blunt';
  readonly tailCone?: 'blade';
  readonly wing: { readonly y: number; readonly chord: number; readonly sweep: number; readonly span: number; readonly tip: number };
  readonly tipDevice?: 'sharklet' | 'scimitar' | 'raked' | 'curl';
  readonly stab: { readonly y: number; readonly span: number; readonly chord: number; readonly sweep: number };
  readonly tTail?: boolean;
  /** Engine nacelles as ellipses [x, y, rx, ry] (mirrored to both sides). */
  readonly engines: readonly (readonly [number, number, number, number])[];
  /** Propeller discs [x, y, radius]; x 0 is a single nose prop, otherwise mirrored. */
  readonly props?: readonly (readonly [number, number, number])[];
  readonly upperDeck?: boolean;
  readonly mask?: boolean;
  readonly windows: boolean;
}

const CARAVAN: Spec = {
  length: 8, body: 2.6, nose: 'blunt', windows: true,
  wing: { y: -7, chord: 4.4, sweep: 0, span: 27, tip: 3.6 },
  stab: { y: 14, span: 9, chord: 3.4, sweep: 0.6 },
  engines: [], props: [[0, -20.4, 6]],
};
const B737: Spec = {
  length: 13.5, body: 2, nose: 'pointed', windows: true,
  wing: { y: -2, chord: 7.6, sweep: 10, span: 18, tip: 1.6 }, tipDevice: 'scimitar',
  stab: { y: 13.6, span: 7.8, chord: 3.6, sweep: 3.6 },
  engines: [[5.4, -1.8, 1.3, 3.4]],
};
const SPECS: Record<AircraftTypeId, Spec> = {
  C208: CARAVAN,
  C208F: { ...CARAVAN, windows: false },
  Q400: {
    length: 11, body: 1.9, nose: 'pointed', windows: true,
    wing: { y: -3, chord: 3.4, sweep: 0.4, span: 17, tip: 2.2 },
    stab: { y: 17, span: 6.5, chord: 2, sweep: 1.2 }, tTail: true,
    engines: [[6, -4.2, 1.3, 4.2]], props: [[6, -8.6, 5.2]],
  },
  A320: {
    length: 12.5, body: 2.2, nose: 'round', windows: true,
    wing: { y: -3, chord: 7.2, sweep: 10.6, span: 18, tip: 1.7 }, tipDevice: 'sharklet',
    stab: { y: 13.4, span: 7.4, chord: 3.6, sweep: 3.8 },
    engines: [[6.8, 0.4, 1.5, 3]],
  },
  B738: B737,
  B738F: { ...B737, windows: false },
  A350: {
    length: 17, body: 2.9, nose: 'round', windows: true, mask: true,
    wing: { y: -4, chord: 8.4, sweep: 11.8, span: 19.4, tip: 1.6 }, tipDevice: 'curl',
    stab: { y: 13.4, span: 8.2, chord: 3.8, sweep: 4 },
    engines: [[8, -0.6, 2.1, 4]],
  },
  B77W: {
    length: 18.5, body: 2.7, nose: 'round', tailCone: 'blade', windows: true,
    wing: { y: -3.6, chord: 8.2, sweep: 11.4, span: 17.4, tip: 1.6 }, tipDevice: 'raked',
    stab: { y: 13.2, span: 8, chord: 3.8, sweep: 4 },
    engines: [[8, -0.6, 2.6, 4.6]],
  },
  B748F: {
    length: 19, body: 3.1, nose: 'round', upperDeck: true, windows: false,
    wing: { y: -5, chord: 9, sweep: 12.5, span: 18.4, tip: 1.8 }, tipDevice: 'raked',
    stab: { y: 13, span: 8.6, chord: 4, sweep: 4 },
    engines: [[7.2, -1.4, 1.6, 3.2], [13.2, 3.2, 1.5, 3]],
  },
};

const TAIL: Record<AircraftTypeId, number> = {
  C208: 0x7aa7ff, C208F: 0xf2a33a, Q400: 0x38d0b0, A320: 0x38d0b0, B738: 0x7aa7ff, B738F: 0xf2a33a, B77W: 0xe86f63, A350: 0x38d0b0, B748F: 0xf2a33a,
};

const C = {
  fuselage: 0xe8f0ed, wing: 0xb4c3be, engine: 0x7d8a86, cockpit: 0x0d1513, upperDeck: 0xc6d3ce, mask: 0x161d1b, window: 0x51605b, prop: 0x55625e,
} as const;

interface Part { readonly d: string; readonly fill: keyof typeof C | 'tail'; readonly alpha?: number }

const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx},${cy} A${rx},${ry} 0 1 0 ${cx + rx},${cy} A${rx},${ry} 0 1 0 ${cx - rx},${cy} Z`;
const poly = (pts: readonly (readonly [number, number])[], mirror = true): string => {
  const one = (sx: number) => `M${pts.map(([x, y]) => `${x * sx},${y}`).join(' L')} Z`;
  return mirror ? `${one(1)} ${one(-1)}` : one(1);
};

function fuselagePath(w: number, nose: Spec['nose'], tailCone?: Spec['tailCone']): string {
  // right side from the nose (0, −20) to (w, n[5]), and from (w, 12) round the tail to (0, t[5])
  const n = { round: [w * 0.85, -20, w, -18.4, w, -15.6], pointed: [w * 0.4, -19.8, w, -16.6, w, -13], blunt: [w * 0.9, -20, w, -19.2, w, -17.6] }[nose];
  const t = tailCone === 'blade' ? [w, 15, w * 0.2, 18.4, 0, 20.4] : [w, 15.5, w * 0.5, 18.5, 0, 20];
  return `M0,-20 C${n[0]},${n[1]} ${n[2]},${n[3]} ${w},${n[5]} L${w},12 C${t[0]},${t[1]} ${t[2]},${t[3]} 0,${t[5]} ` +
    `C${-t[2]!},${t[3]} ${-t[0]!},${t[1]} ${-w},12 L${-w},${n[5]} C${-n[2]!},${n[3]} ${-n[0]!},${n[1]} 0,-20 Z`;
}

/** Where the wingtips end, for the navigation and strobe lights. */
function wingtip(s: Spec): { x: number; y: number } {
  const { y, sweep, span, tip } = s.wing;
  const ext = s.tipDevice === 'raked' ? 2.4 : s.tipDevice ? 1 : 0;
  return { x: span + ext, y: y + sweep + tip / 2 + (s.tipDevice === 'raked' ? 1 : 0) };
}

function parts(s: Spec): Part[] {
  const w = s.body;
  const { y, chord, sweep, span, tip } = s.wing;
  const st = s.stab;
  const stab: Part = { d: poly([[w * 0.6, st.y], [st.span, st.y + st.sweep], [st.span, st.y + st.sweep + st.chord * 0.5], [w * 0.5, st.y + st.chord]]), fill: 'wing' };
  const ty = y + sweep;
  const tips: Record<NonNullable<Spec['tipDevice']>, Part> = {
    sharklet: { d: poly([[span, ty + 0.2], [span + 0.8, ty + 1.4], [span + 0.8, ty + tip + 0.8], [span, ty + tip]]), fill: 'tail' },
    scimitar: { d: poly([[span, ty - 0.2], [span + 0.5, ty - 1.4], [span + 1, ty + 0.8], [span + 1, ty + tip + 1], [span, ty + tip]]), fill: 'tail' },
    raked: { d: poly([[span, ty], [span + 2.4, ty + tip + 1.6], [span + 1.6, ty + tip + 1.8], [span, ty + tip]]), fill: 'wing' },
    curl: { d: `M${span},${ty} Q${span + 1.6},${ty + 0.4} ${span + 1.4},${ty + tip + 1.8} L${span},${ty + tip} Z M${-span},${ty} Q${-span - 1.6},${ty + 0.4} ${-span - 1.4},${ty + tip + 1.8} L${-span},${ty + tip} Z`, fill: 'wing' },
  };
  const cy = s.nose === 'pointed' ? -16.8 : s.nose === 'blunt' ? -17.4 : -17.8;
  const out: Part[] = [];
  if (!s.tTail) out.push(stab);
  out.push({ d: poly([[w * 0.9, y], [span, ty], [span, ty + tip], [w * 0.9, y + chord]]), fill: 'wing' });
  if (s.tipDevice) out.push(tips[s.tipDevice]);
  if (s.engines.length) out.push({ d: s.engines.map(([x, ey, rx, ry]) => `${ellipse(x, ey, rx, ry)} ${ellipse(-x, ey, rx, ry)}`).join(' '), fill: 'engine' });
  out.push({ d: fuselagePath(w, s.nose, s.tailCone), fill: 'fuselage' });
  if (s.windows) {
    const end = s.length < 10 ? 2 : 10;
    out.push({ d: poly([[w - 0.9, -13], [w - 0.45, -13], [w - 0.45, end], [w - 0.9, end]]), fill: 'window' });
  }
  if (s.upperDeck) {
    out.push({ d: `M0,-17 C${w * 0.5},-16.6 ${w * 0.65},-14 ${w * 0.65},-10 L${w * 0.45},-4 L${-w * 0.45},-4 L${-w * 0.65},-10 C${-w * 0.65},-14 ${-w * 0.5},-16.6 0,-17 Z`, fill: 'upperDeck' });
  }
  if (s.mask) out.push({ d: `M${-w * 0.8},${cy} Q0,${cy - 1.6} ${w * 0.8},${cy} L${w * 0.86},${cy + 1.8} Q0,${cy + 0.6} ${-w * 0.86},${cy + 1.8} Z`, fill: 'mask' });
  out.push({ d: `M${-w * 0.55},${cy} Q0,${cy - 0.8} ${w * 0.55},${cy} L${w * 0.5},${cy + 0.8} Q0,${cy + 0.2} ${-w * 0.5},${cy + 0.8} Z`, fill: 'cockpit' });
  out.push({ d: `M-0.65,12.5 L0.65,12.5 L0.65,${s.tTail ? 18 : 19.6} L-0.65,${s.tTail ? 18 : 19.6} Z`, fill: 'tail' });
  if (s.tTail) out.push(stab, { d: poly([[-0.65, st.y], [0.65, st.y], [0.65, st.y + st.chord], [-0.65, st.y + st.chord]], false), fill: 'tail' });
  for (const [x, py, r] of s.props ?? []) {
    out.push({ d: x === 0 ? ellipse(0, py, r, 0.6) : `${ellipse(x, py, r, 0.6)} ${ellipse(-x, py, r, 0.6)}`, fill: 'prop', alpha: 0.85 });
  }
  return out;
}

const PARTS = Object.fromEntries((Object.keys(SPECS) as AircraftTypeId[]).map((id) => [id, parts(SPECS[id])])) as Record<AircraftTypeId, Part[]>;

function drawParts(g: Graphics, list: readonly Part[], colour: (fill: Part['fill']) => number, alpha = 1): void {
  for (const part of list) g.path(new GraphicsPath(part.d)).fill({ color: colour(part.fill), alpha: alpha * (part.alpha ?? 1) });
}

/**
 * Height illusion from the flight's altitude (0 on the ground … 1 leaving the airfield): the aircraft draws larger, as
 * if nearer the camera, while its shadow stays on the ground at its true size, falls further away (the sun is to the
 * north-west) and fades.
 */
export function heightLook(altitude: number): { scale: number; shadowOffset: number; shadowAlpha: number } {
  const a = Math.min(1, Math.max(0, altitude));
  return { scale: 1 + 0.45 * a, shadowOffset: 0.6 + 22 * a, shadowAlpha: 1 - 0.6 * a };
}

const RED = 0xff3b30;
const GREEN = 0x34e07a;
const WHITE = 0xfff8e8;

/** Lights, drawn above the night tint so they glow: navigation, beacon, strobes and the landing/taxi beam. */
interface Lights {
  readonly root: Container;
  readonly nav: Graphics;
  readonly beacon: Graphics;
  readonly strobes: Graphics;
  readonly landing: Graphics;
  readonly taxi: Graphics;
}

function aircraftLights(spec: Spec, scale: number): Lights {
  const r = (world: number) => world / scale; // light sizes in world units, whatever the aircraft's size
  const tip = wingtip(spec);
  const glow = (g: Graphics, x: number, y: number, color: number, size = 1) => {
    g.circle(x, y, r(1.6 * size)).fill({ color, alpha: 0.25 });
    g.circle(x, y, r(0.75 * size)).fill({ color, alpha: 0.5 });
    g.circle(x, y, r(0.32 * size)).fill({ color: 0xffffff, alpha: 0.95 });
  };
  const nav = new Graphics();
  glow(nav, -tip.x, tip.y, RED); // port (left)
  glow(nav, tip.x, tip.y, GREEN); // starboard (right)
  glow(nav, 0, 20.6, WHITE, 0.8);
  const beacon = new Graphics();
  glow(beacon, 0, -1, RED, 1.2);
  const strobes = new Graphics();
  for (const sx of [-1, 1]) glow(strobes, sx * tip.x, tip.y + 0.6, WHITE, 1.4);
  const beam = (length: number, spread: number, alpha: number) => {
    const g = new Graphics();
    g.moveTo(-r(0.4), -20).lineTo(-r(spread), -20 - r(length)).lineTo(r(spread), -20 - r(length)).lineTo(r(0.4), -20).closePath()
      .fill({ color: WHITE, alpha });
    g.moveTo(-r(0.4), -20).lineTo(-r(spread * 0.5), -20 - r(length * 0.6)).lineTo(r(spread * 0.5), -20 - r(length * 0.6)).lineTo(r(0.4), -20).closePath()
      .fill({ color: WHITE, alpha });
    glow(g, 0, -19.6, WHITE, 0.9);
    return g;
  };
  const landing = beam(16, 4.5, 0.16);
  const taxi = beam(6, 2.4, 0.18);
  const root = new Container();
  root.addChild(landing, taxi, nav, strobes, beacon);
  for (const g of [landing, taxi, nav, strobes, beacon]) g.blendMode = 'add';
  root.scale.set(scale);
  return { root, nav, beacon, strobes, landing, taxi };
}

interface Pose { x: number; y: number; heading: number }

interface Sprite {
  /** Where it was drawn at the last step and where the simulation has it now; drawn between the two. */
  from: Pose;
  to: Pose;
  readonly root: Container;
  readonly shadow: Graphics;
  readonly body: Graphics;
  readonly lights: Lights;
  /** Offset so not every beacon flashes at once. */
  readonly phaseMs: number;
  /** Drawing scale for the aircraft's length on the ground. */
  readonly scale: number;
  /** Altitude at the last step and now; drawn between the two like the position. */
  altFrom: number;
  altTo: number;
}

function aircraftSprite(flight: Flight): Sprite {
  const spec = SPECS[flight.type];
  const scale = spec.length / 40;
  const shadow = new Graphics();
  drawParts(shadow, PARTS[flight.type], () => 0x000000, 0.45);
  const body = new Graphics();
  drawParts(body, PARTS[flight.type], (fill) => (fill === 'tail' ? TAIL[flight.type] : C[fill]));
  shadow.scale.set(scale);
  body.scale.set(scale);
  const root = new Container();
  root.addChild(shadow, body);
  const phaseMs = [...flight.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7);
  const at = { x: flight.position?.x ?? 0, y: flight.position?.y ?? 0, heading: flight.heading };
  return { from: at, to: { ...at }, root, shadow, body, lights: aircraftLights(spec, scale), phaseMs, scale, altFrom: flight.altitude, altTo: flight.altitude };
}

const ON_RUNWAY = new Set<Flight['phase']>(['landing', 'takeoff']);
const TAXIING = new Set<Flight['phase']>(['taxiIn', 'taxiOut', 'holdShort']);

/**
 * Keeps one sprite per flight on the airfield in sync with the simulation. Holding aircraft are not drawn.
 * `container` holds the aircraft; `lights` holds their lights and goes above the daylight tint.
 */
export class FlightLayer {
  readonly container = new Container({ sortableChildren: true });
  readonly lights = new Container();
  private readonly sprites = new Map<string, Sprite>();
  private minute = -1;
  /** Reduce motion: the beacon glows steadily and the strobes stay off instead of flashing. */
  calm = false;
  /** The aircraft picked in the flight strips or alerts: drawn with a ring round it. */
  highlight: string | undefined;
  private readonly ring = new Graphics();

  constructor() {
    this.ring.zIndex = 5;
    this.container.addChild(this.ring);
  }

  /**
   * `darkness` 0 (day) … ~0.6 (night) from the daylight curve; lights fade in as it gets dark. `minute` and `fraction`
   * (how far the Day is towards its next step) let aircraft glide between steps instead of jumping, which matters at
   * slow speeds such as Live, where a step lasts 15 real seconds.
   */
  update(flights: readonly Flight[], darkness = 0, nowMs = performance.now(), minute = -1, fraction = 1): void {
    const stepped = minute !== this.minute;
    this.minute = minute;
    const present = new Set(flights.filter((f) => f.position).map((f) => f.id));
    for (const [id, s] of this.sprites) {
      if (!present.has(id)) {
        s.root.destroy({ children: true });
        s.lights.root.destroy({ children: true });
        this.sprites.delete(id);
      }
    }
    this.ring.clear();
    this.lights.visible = darkness > 0.1;
    this.lights.alpha = Math.min(1, (darkness - 0.1) / 0.25);
    for (const f of flights) {
      if (!f.position) continue;
      let s = this.sprites.get(f.id);
      if (!s) {
        s = aircraftSprite(f);
        this.sprites.set(f.id, s);
        this.container.addChild(s.root);
        this.lights.addChild(s.lights.root);
      }
      if (stepped) {
        s.from = s.to;
        s.to = { x: f.position.x, y: f.position.y, heading: f.heading };
        s.altFrom = s.altTo;
        s.altTo = f.altitude;
        // a long jump (onto a Stand, a new phase) is not a glide
        if (Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y) > 120) {
          s.from = { ...s.to };
          s.altFrom = s.altTo;
        }
      }
      const k = minute < 0 ? 1 : fraction;
      const turn = ((((s.to.heading - s.from.heading) % 360) + 540) % 360) - 180;
      const pose = { x: s.from.x + (s.to.x - s.from.x) * k, y: s.from.y + (s.to.y - s.from.y) * k, heading: s.from.heading + turn * k };
      const rotation = (pose.heading * Math.PI) / 180;
      const look = heightLook(s.altFrom + (s.altTo - s.altFrom) * k);
      s.body.position.set(pose.x, pose.y);
      s.body.rotation = rotation;
      s.body.scale.set(s.scale * look.scale);
      s.root.zIndex = look.scale > 1 ? 1 : 0; // aircraft in the air draw above those on the ground
      s.shadow.position.set(pose.x + look.shadowOffset, pose.y + look.shadowOffset);
      s.shadow.rotation = rotation;
      s.shadow.alpha = look.shadowAlpha;
      if (f.id === this.highlight) {
        // a ring round it (pulsing gently, steady with Reduce motion) and a pointer above it
        const radius = (SPECS[f.type].length * 0.75 + 4) * look.scale;
        const pulse = this.calm ? 1 : 0.6 + 0.4 * Math.sin(nowMs / 250);
        this.ring.circle(pose.x, pose.y, radius).stroke({ width: 1.6, color: 0xf0d24a, alpha: pulse });
        this.ring.circle(pose.x, pose.y, radius + 3).stroke({ width: 0.6, color: 0xf0d24a, alpha: pulse * 0.5 });
        this.ring.poly([pose.x, pose.y - radius - 2, pose.x - 3, pose.y - radius - 7, pose.x + 3, pose.y - radius - 7]).fill({ color: 0xf0d24a, alpha: pulse });
      }
      if (!this.lights.visible) continue;
      const l = s.lights;
      l.root.position.set(pose.x, pose.y);
      l.root.rotation = rotation;
      l.root.scale.set(s.scale * look.scale);
      const runway = ON_RUNWAY.has(f.phase);
      const moving = runway || TAXIING.has(f.phase);
      const t = (nowMs + s.phaseMs) % 1200;
      l.nav.visible = f.phase !== 'onStand';
      l.beacon.visible = moving && (this.calm || t % 1000 < 130); // red anti-collision beacon while the engines run
      l.strobes.visible = !this.calm && runway && (t < 60 || (t > 160 && t < 220)); // white double flash on the Runway
      l.landing.visible = runway;
      l.taxi.visible = TAXIING.has(f.phase) && f.phase !== 'holdShort';
    }
  }
}
