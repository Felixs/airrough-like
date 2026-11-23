/**
 * Building names: clean sans-serif capitals with open letter spacing, as on airport signage (the UI's monospace font is
 * kept for Stand numbers). Used for the names painted on roofs and the ground and for the signs on roof edges.
 */
export const NAME_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif';

export interface NameStyle {
  /** Font weight (CSS). */
  weight?: number;
  /** Gap between letters, as a fraction of the font size. */
  spacing?: number;
  /** Font size as a fraction of the canvas height. */
  fill?: number;
}

const fontOf = (size: number, o: NameStyle) => `${o.weight ?? 600} ${size}px ${NAME_FONT}`;

/** Width of `text` at the current font with the letter spacing added (per letter, so it works on every canvas). */
function spacedWidth(g: CanvasRenderingContext2D, text: string, size: number, spacing: number): number {
  let w = 0;
  for (const ch of text) w += g.measureText(ch).width;
  return w + size * spacing * Math.max(0, [...text].length - 1);
}

/** Paints `text` centred on a W × H canvas, as large as fits (92% of the width at most). */
export function paintName(g: CanvasRenderingContext2D, text: string, W: number, H: number, colour: string, o: NameStyle = {}): void {
  const spacing = o.spacing ?? 0.16;
  let size = H * (o.fill ?? 0.7);
  g.font = fontOf(size, o);
  while (spacedWidth(g, text, size, spacing) > W * 0.92 && size > 6) {
    size *= 0.96;
    g.font = fontOf(size, o);
  }
  g.fillStyle = colour;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  let x = (W - spacedWidth(g, text, size, spacing)) / 2;
  for (const ch of text) {
    g.fillText(ch, x, H / 2 + size * 0.04);
    x += g.measureText(ch).width + size * spacing;
  }
}

/** Width : height of `text` set by paintName on a plate of that height (with a margin either side of `margin` heights). */
export function nameAspect(text: string, o: NameStyle = {}, margin = 0.5): number {
  const g = document.createElement('canvas').getContext('2d');
  const size = 100;
  if (!g) return [...text].length * 0.85 + 2 * margin;
  g.font = fontOf(size, o);
  return (spacedWidth(g, text, size, o.spacing ?? 0.16) / size) * (o.fill ?? 0.7) + 2 * margin;
}
