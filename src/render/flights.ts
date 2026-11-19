import { Container, Graphics, GraphicsPath } from 'pixi.js';
import { AIRCRAFT_TYPES, type AircraftTypeId } from '../sim/aircraft';
import type { Flight } from '../sim/simulation';

/** Aircraft length in world units by Size Class (UI baseline): about 9 / 13 / 18. */
const LENGTH = { small: 9, medium: 13, large: 18 } as const;

type Shape = 'prop' | 'narrow' | 'wide' | 'jumbo';
const SHAPE: Record<AircraftTypeId, Shape> = {
  C208: 'prop', C208F: 'prop', Q400: 'prop', A320: 'narrow', B738: 'narrow', B738F: 'narrow', B77W: 'wide', A350: 'wide', B748F: 'jumbo',
};
const TAIL: Record<AircraftTypeId, number> = {
  C208: 0x7aa7ff, C208F: 0xf2a33a, Q400: 0x38d0b0, A320: 0x38d0b0, B738: 0x7aa7ff, B738F: 0xf2a33a, B77W: 0xe86f63, A350: 0x38d0b0, B748F: 0xf2a33a,
};

const C = { fuselage: 0xe8f0ed, fuselageEdge: 0xaebdb8, wing: 0xb4c3be, engine: 0x7d8a86, cockpit: 0x0d1513, upperDeck: 0xf6fbf9 } as const;

/** Top-down silhouettes, nose up, 40 long (y −20…20); from the accepted UI baseline (v5). */
interface Part { readonly d: string; readonly fill: keyof typeof C | 'tail'; readonly stroke?: number }
const fuselage = (w: number): string =>
  `M0,-20 C${w * 0.7},-19.6 ${w},-17.5 ${w},-14 L${w},12 C${w},15.5 ${w * 0.5},18.5 0,20 C${-w * 0.5},18.5 ${-w},15.5 ${-w},12 L${-w},-14 C${-w},-17.5 ${-w * 0.7},-19.6 0,-20 Z`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx},${cy} A${rx},${ry} 0 1 0 ${cx + rx},${cy} A${rx},${ry} 0 1 0 ${cx - rx},${cy} Z`;

const SHAPES: Record<Shape, readonly Part[]> = {
  prop: [
    { d: 'M1.8,-7 L19,-6 L19,-3.4 L1.8,-2.6 Z M-1.8,-7 L-19,-6 L-19,-3.4 L-1.8,-2.6 Z', fill: 'wing' },
    { d: 'M6,-11 L8.6,-11 L8.6,-3 L6,-3 Z M-8.6,-11 L-6,-11 L-6,-3 L-8.6,-3 Z', fill: 'engine' },
    { d: fuselage(2), fill: 'fuselage' },
    { d: 'M0,15 L7,17 L7,18.6 L0,17.6 L-7,18.6 L-7,17 Z', fill: 'wing' },
    { d: 'M-1.1,-17.8 Q0,-18.4 1.1,-17.8 L1,-17 Q0,-17.5 -1,-17 Z', fill: 'cockpit' },
    { d: 'M-0.6,12 L0.6,12 L0.6,17.4 L-0.6,17.4 Z', fill: 'tail' },
  ],
  narrow: [
    { d: 'M2.1,-3 L18.5,7.6 L18.8,9.4 L2.1,4.6 Z M-2.1,-3 L-18.5,7.6 L-18.8,9.4 L-2.1,4.6 Z', fill: 'wing' },
    { d: 'M1.6,13.5 L7.6,17.6 L7.6,19 L1.3,17.4 Z M-1.6,13.5 L-7.6,17.6 L-7.6,19 L-1.3,17.4 Z', fill: 'wing' },
    { d: `${ellipse(7.6, 0.6, 1.35, 3)} ${ellipse(-7.6, 0.6, 1.35, 3)}`, fill: 'engine' },
    { d: fuselage(2.2), fill: 'fuselage' },
    { d: 'M-1.3,-17.6 Q0,-18.4 1.3,-17.6 L1.2,-16.8 Q0,-17.4 -1.2,-16.8 Z', fill: 'cockpit' },
    { d: 'M-0.65,12.5 L0.65,12.5 L0.65,19.6 L-0.65,19.6 Z', fill: 'tail' },
  ],
  wide: [
    { d: 'M3,-4 L20,8.6 L20.2,10.6 L3,5.4 Z M-3,-4 L-20,8.6 L-20.2,10.6 L-3,5.4 Z', fill: 'wing' },
    { d: 'M2.2,13 L9,17.2 L9,18.8 L1.8,17.2 Z M-2.2,13 L-9,17.2 L-9,18.8 L-1.8,17.2 Z', fill: 'wing' },
    { d: `${ellipse(8.6, 0.2, 2, 3.8)} ${ellipse(-8.6, 0.2, 2, 3.8)}`, fill: 'engine' },
    { d: fuselage(3.1), fill: 'fuselage' },
    { d: 'M-1.8,-17.4 Q0,-18.4 1.8,-17.4 L1.7,-16.4 Q0,-17.2 -1.7,-16.4 Z', fill: 'cockpit' },
    { d: 'M-0.8,12 L0.8,12 L0.8,19.6 L-0.8,19.6 Z', fill: 'tail' },
  ],
  jumbo: [
    { d: 'M3,-5 L20,8 L20.2,10 L3,4.4 Z M-3,-5 L-20,8 L-20.2,10 L-3,4.4 Z', fill: 'wing' },
    { d: 'M2.2,13 L9,17.2 L9,18.8 L1.8,17.2 Z M-2.2,13 L-9,17.2 L-9,18.8 L-1.8,17.2 Z', fill: 'wing' },
    { d: `${ellipse(7.4, -0.6, 1.6, 3.2)} ${ellipse(-7.4, -0.6, 1.6, 3.2)} ${ellipse(13.4, 3.6, 1.5, 3)} ${ellipse(-13.4, 3.6, 1.5, 3)}`, fill: 'engine' },
    { d: fuselage(3.15), fill: 'fuselage' },
    { d: 'M0,-17 C1.6,-16.6 2,-14 2,-10 L1.4,-6 L-1.4,-6 L-2,-10 C-2,-14 -1.6,-16.6 0,-17 Z', fill: 'upperDeck' },
    { d: 'M-0.8,12 L0.8,12 L0.8,19.6 L-0.8,19.6 Z', fill: 'tail' },
  ],
};

function drawShape(g: Graphics, shape: Shape, colour: (fill: Part['fill']) => number, alpha = 1): void {
  for (const part of SHAPES[shape]) g.path(new GraphicsPath(part.d)).fill({ color: colour(part.fill), alpha });
}

/** How high the aircraft is, as a shadow offset in world units. */
function altitude(f: Flight): number {
  if (f.phase === 'landing') return 3.5;
  if (f.phase === 'takeoff') return 3;
  return 0.6;
}

interface Sprite {
  readonly root: Container;
  readonly shadow: Graphics;
  readonly body: Graphics;
}

function aircraftSprite(flight: Flight): Sprite {
  const shape = SHAPE[flight.type];
  const scale = LENGTH[AIRCRAFT_TYPES[flight.type].size] / 40;
  const shadow = new Graphics();
  drawShape(shadow, shape, () => 0x000000, 0.45);
  const body = new Graphics();
  drawShape(body, shape, (fill) => (fill === 'tail' ? TAIL[flight.type] : C[fill]));
  shadow.scale.set(scale);
  body.scale.set(scale);
  const root = new Container();
  root.addChild(shadow, body);
  return { root, shadow, body };
}

/** Keeps one sprite per flight on the airfield in sync with the simulation. Holding aircraft are not drawn. */
export class FlightLayer {
  readonly container = new Container();
  private readonly sprites = new Map<string, Sprite>();

  update(flights: readonly Flight[]): void {
    const present = new Set(flights.filter((f) => f.position).map((f) => f.id));
    for (const [id, s] of this.sprites) {
      if (!present.has(id)) {
        s.root.destroy({ children: true });
        this.sprites.delete(id);
      }
    }
    for (const f of flights) {
      if (!f.position) continue;
      let s = this.sprites.get(f.id);
      if (!s) {
        s = aircraftSprite(f);
        this.sprites.set(f.id, s);
        this.container.addChild(s.root);
      }
      const rotation = (f.heading * Math.PI) / 180;
      const alt = altitude(f);
      s.body.position.set(f.position.x, f.position.y);
      s.body.rotation = rotation;
      s.shadow.position.set(f.position.x + alt, f.position.y + alt);
      s.shadow.rotation = rotation;
    }
  }
}
