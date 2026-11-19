import { Container, Graphics } from 'pixi.js';
import { AIRCRAFT_TYPES } from '../sim/aircraft';
import type { Flight } from '../sim/simulation';

/** Aircraft length in world units by Size Class (UI baseline); wingspan is about the same. */
const LENGTH = { small: 9, medium: 13, large: 18 } as const;

/** Simple top-down airliner silhouette, nose up, length 40 (scaled per Size Class). The art pass replaces it. */
const SILHOUETTE = [
  0, -20, 2.2, -16, 2.2, -4, 19, 8, 19, 10, 2.2, 5, 2.2, 13, 8, 17.5, 8, 19, 0, 17.5, -8, 19, -8, 17.5, -2.2, 13, -2.2, 5, -19, 10, -19, 8, -2.2, -4,
  -2.2, -16,
];

function aircraftGraphic(flight: Flight): Graphics {
  const g = new Graphics();
  g.poly(SILHOUETTE).fill({ color: 0x000000, alpha: 0.45 });
  g.poly(SILHOUETTE.map((v) => v - 1.2)).fill(0xe4eeeb);
  g.scale.set(LENGTH[AIRCRAFT_TYPES[flight.type].size] / 40);
  return g;
}

/** Keeps one sprite per flight on the airfield in sync with the simulation. */
export class FlightLayer {
  readonly container = new Container();
  private readonly sprites = new Map<string, Graphics>();

  update(flights: readonly Flight[]): void {
    const present = new Set(flights.map((f) => f.id));
    for (const [id, g] of this.sprites) {
      if (!present.has(id)) {
        g.destroy();
        this.sprites.delete(id);
      }
    }
    for (const f of flights) {
      let g = this.sprites.get(f.id);
      if (!f.position) {
        if (g) {
          g.destroy();
          this.sprites.delete(f.id);
        }
        continue;
      }
      if (!g) {
        g = aircraftGraphic(f);
        this.sprites.set(f.id, g);
        this.container.addChild(g);
      }
      g.position.set(f.position.x, f.position.y);
      g.rotation = (f.heading * Math.PI) / 180;
    }
  }
}
