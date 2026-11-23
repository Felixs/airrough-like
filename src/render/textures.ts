import { DynamicTexture, Texture, type Scene } from '@babylonjs/core';

/** Small seeded random numbers, so painted textures look the same every time. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Paint = (g: CanvasRenderingContext2D, w: number, h: number) => void;

export interface TextureOptions {
  /** Repeat count across the surface (u along x, v along y of the canvas). */
  readonly u?: number;
  readonly v?: number;
  /** Clamp instead of repeating (textures painted for one surface). */
  readonly clamp?: boolean;
  readonly alpha?: boolean;
}

/** A texture painted with the 2D canvas API. */
export function canvasTexture(scene: Scene, name: string, width: number, height: number, paint: Paint, o: TextureOptions = {}): DynamicTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  paint(g, width, height);
  const t = new DynamicTexture(name, canvas, scene, true);
  t.update();
  t.hasAlpha = !!o.alpha;
  t.wrapU = o.clamp ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
  t.wrapV = o.clamp ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 8;
  t.uScale = o.u ?? 1;
  t.vScale = o.v ?? 1;
  return t;
}

/** Fine dark and light grain. */
export function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number, size: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const dark = r() < 0.5;
    g.fillStyle = dark ? `rgba(0,0,0,${alpha * r()})` : `rgba(255,255,255,${alpha * r() * 0.6})`;
    const s = 1 + r() * size;
    g.fillRect(r() * w, r() * h, s, s);
  }
}

/** Soft dark stains. */
export function blots(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number, radius: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(0,0,0,${alpha * r()})`;
    g.beginPath();
    g.ellipse(r() * w, r() * h, radius * (0.4 + r()), radius * (0.3 + r() * 0.6), r() * 3, 0, Math.PI * 2);
    g.fill();
  }
}
