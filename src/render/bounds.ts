import { WORLD, type AirportLayout, type TileRect } from '../sim/layout';

/** The tiles the airport covers, plus a margin (what the Live Day shows). */
export function airportBounds(layout: AirportLayout, margin = 3): TileRect {
  const xs = layout.structures.flatMap((s) => [s.x, s.x + s.w]);
  const ys = layout.structures.flatMap((s) => [s.y, s.y + s.h]);
  const x = Math.min(...xs) - margin;
  const y = Math.min(...ys) - margin;
  return { x, y, w: Math.max(...xs) + margin - x, h: Math.max(...ys) + margin - y };
}

/** The whole world map (what Build Mode shows). */
export const worldBounds: TileRect = { x: WORLD.x0, y: WORLD.y0, w: WORLD.width, h: WORLD.height };
