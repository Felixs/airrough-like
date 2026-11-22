/**
 * The 3D airport view (Babylon.js): a fixed top-down camera over the airfield, sunlight and night lighting that follow
 * the Day's clock, and quality that drops by itself when frames get slow. Live Day shows the whole airport with a
 * slight tilt; Build Mode looks straight down and can zoom and pan.
 */
import {
  ArcRotateCamera, Camera, Color3, Color4, DefaultRenderingPipeline, DirectionalLight, Engine, GlowLayer, HemisphericLight, ImageProcessingConfiguration,
  Matrix, Mesh, MeshBuilder, ReflectionProbe, RenderTargetTexture, Scene, ShadowGenerator, StandardMaterial, Vector3, VertexBuffer, type LinesMesh,
} from '@babylonjs/core';
import { daylight, NIGHT_DARKNESS } from '../sim/clock';
import { TILE_SIZE, type AirportLayout, type TileRect } from '../sim/layout';
import { AircraftLayer } from './aircraftLayer';
import { buildAirfield, type Airfield } from './airfield';
import { canvasTexture } from './textures';

const T = TILE_SIZE;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Quality levels, best first; the view steps down when it can't keep up. */
const TIERS = [
  { name: 'high', scale: 1.5, shadow: 2048, msaa: 4, bloom: true },
  { name: 'medium', scale: 1, shadow: 1024, msaa: 1, bloom: false },
  { name: 'low', scale: 0.67, shadow: 0, msaa: 1, bloom: false },
] as const;

export type ViewMode = 'live' | 'build';

export class AirportView {
  readonly canvas: HTMLCanvasElement;
  readonly engine: Engine;
  readonly scene: Scene;
  readonly aircraft: AircraftLayer;
  private readonly camera: ArcRotateCamera;
  private readonly sun: DirectionalLight;
  private readonly hemi: HemisphericLight;
  private readonly shadows: ShadowGenerator;
  private readonly glow: GlowLayer;
  private readonly pipeline: DefaultRenderingPipeline;
  private readonly dome: Mesh;
  private readonly probe: ReflectionProbe | null;
  private airfield: Airfield | null = null;
  private airfieldItems: Array<{ dispose(): void }> = [];
  private layout: AirportLayout | null = null;
  private view = { x: 0, z: 0, h: 400 };
  private area: TileRect | null = null;
  private light = { darkness: -1, warmth: -1 };
  private probeDarkness = -1;
  private tier = 0;
  private slowFor = 0;
  private frameHandlers: Array<(ms: number) => void> = [];
  private readonly observer: ResizeObserver;

  constructor(host: HTMLElement, readonly mode: ViewMode) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.touchAction = 'none';
    host.appendChild(this.canvas);
    this.engine = new Engine(this.canvas, true, { stencil: true, antialias: true, preserveDrawingBuffer: true }, false);
    const scene = (this.scene = new Scene(this.engine));
    scene.skipPointerMovePicking = true;
    scene.clearColor = new Color4(0.05, 0.07, 0.06, 1);
    this.camera = new ArcRotateCamera('camera', -Math.PI / 2, mode === 'live' ? 0.38 : 0.0001, 3000, Vector3.Zero(), scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 10;
    this.camera.maxZ = 8000;
    this.hemi = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
    this.sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.3), scene);
    this.shadows = new ShadowGenerator(2048, this.sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadows.bias = 0.002;
    this.shadows.normalBias = 0.02;
    this.shadows.darkness = 0.15;
    this.glow = new GlowLayer('glow', scene, { mainTextureRatio: 0.4, blurKernelSize: 32 });
    // sky dome: unseen from above, but its colours light the reflections on paint and glass
    this.dome = MeshBuilder.CreateSphere('sky', { diameter: 7000, segments: 20, sideOrientation: Mesh.BACKSIDE, updatable: true }, scene);
    const dm = new StandardMaterial('sky', scene);
    dm.disableLighting = true;
    dm.emissiveColor = Color3.White();
    dm.backFaceCulling = false;
    this.dome.material = dm;
    this.dome.isPickable = false;
    this.dome.setVerticesData(VertexBuffer.ColorKind, new Float32Array(this.dome.getTotalVertices() * 4), true);
    let probe: ReflectionProbe | null = null;
    try {
      probe = new ReflectionProbe('reflections', 128, scene, true);
      probe.renderList!.push(this.dome);
      probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      probe.position = new Vector3(0, 30, 0);
      scene.environmentTexture = probe.cubeTexture;
    } catch {
      probe = null;
    }
    this.probe = probe;
    this.pipeline = new DefaultRenderingPipeline('post', true, scene, [this.camera]);
    this.pipeline.imageProcessingEnabled = true;
    this.pipeline.imageProcessing.toneMappingEnabled = true;
    this.pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.pipeline.imageProcessing.contrast = 1.12;
    this.pipeline.bloomThreshold = 0.85;
    this.pipeline.bloomWeight = 0.25;
    this.pipeline.bloomKernel = 48;
    this.pipeline.bloomScale = 0.5;
    this.aircraft = new AircraftLayer(scene, (m) => this.glow.addIncludedOnlyMesh(m), (m) => this.shadows.addShadowCaster(m, false));
    this.setTier(0);
    this.setTime(null);
    let last = performance.now();
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const ms = now - last;
      last = now;
      for (const h of this.frameHandlers) h(ms);
      this.watchSpeed(ms);
      scene.render();
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
  }

  /** Runs `handler` once per frame, before drawing, with the real milliseconds since the last frame. */
  onFrame(handler: (ms: number) => void): void {
    this.frameHandlers.push(handler);
  }

  /** Builds the airfield for a layout (only when it changed). */
  setLayout(layout: AirportLayout): void {
    if (layout === this.layout) return;
    this.layout = layout;
    for (const item of this.airfieldItems) item.dispose();
    const s = this.scene;
    const before = new Set<object>([...s.meshes, ...s.materials, ...s.textures, ...s.transformNodes]);
    this.airfield = buildAirfield({ scene: s, caster: (m) => this.shadows.addShadowCaster(m, false), glow: (m) => this.glow.addIncludedOnlyMesh(m) }, layout);
    this.airfieldItems = [...s.meshes, ...s.materials, ...s.textures, ...s.transformNodes].filter((x) => !before.has(x));
    this.light = { darkness: -1, warmth: -1 };
    this.applyLight(this.lastMinute);
  }

  /** Frames a tile area (the airport in a Live Day, the whole map in Build Mode). */
  fit(area: TileRect): void {
    this.area = area;
    const aspect = this.aspect();
    const tilt = Math.cos(this.camera.beta);
    const w = area.w * T;
    const d = area.h * T;
    this.view = { x: (area.x + area.w / 2) * T, z: -(area.y + area.h / 2) * T, h: Math.max(d * tilt, w / aspect) * 1.02 };
    this.applyCamera();
  }

  private lastMinute: number | null = null;

  /** Lights the scene for a minute of the Day (null: plain daylight, as in Plan Mode). Returns the darkness. */
  setTime(minute: number | null): number {
    this.lastMinute = minute;
    return this.applyLight(minute);
  }

  private applyLight(minute: number | null): number {
    const { darkness, warmth } = minute === null ? { darkness: 0, warmth: 0 } : daylight(minute);
    const aircraftGlow = clamp((darkness - 0.1) / 0.25, 0, 1);
    if (Math.abs(darkness - this.light.darkness) < 0.002 && Math.abs(warmth - this.light.warmth) < 0.01) return darkness;
    this.light = { darkness, warmth };
    const day = 1 - darkness / NIGHT_DARKNESS;
    const hour = minute === null ? 13 : minute / 60;
    const arc = clamp((hour - 6) / 14, 0, 1);
    const az = Math.PI * arc;
    const el = (10 + 48 * Math.sin(Math.PI * arc)) * (Math.PI / 180);
    const sunCol = Color3.Lerp(new Color3(1, 0.97, 0.92), new Color3(1, 0.58, 0.32), warmth);
    if (day > 0.15) {
      this.sun.direction = new Vector3(-Math.cos(az) * Math.cos(el), -Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
      this.sun.diffuse = sunCol;
      this.sun.intensity = 3.1 * day ** 1.3;
    } else {
      this.sun.direction = new Vector3(0.33, -0.56, 0.46).normalize();
      this.sun.diffuse = new Color3(0.55, 0.65, 0.95);
      this.sun.intensity = 0.35;
    }
    this.sun.specular = this.sun.diffuse;
    this.sun.position = this.sun.direction.scale(-1500);
    const zenith = Color3.Lerp(new Color3(0.012, 0.018, 0.045), new Color3(0.22, 0.45, 0.82), day);
    let horizon = Color3.Lerp(new Color3(0.035, 0.045, 0.09), new Color3(0.72, 0.81, 0.92), day);
    horizon = Color3.Lerp(horizon, new Color3(0.98, 0.56, 0.34), warmth * 0.7);
    this.hemi.intensity = 0.08 + 0.22 * day;
    this.hemi.diffuse = Color3.Lerp(zenith, Color3.White(), 0.55);
    this.hemi.groundColor = Color3.Lerp(new Color3(0.05, 0.06, 0.05), new Color3(0.35, 0.38, 0.3), day);
    this.scene.environmentIntensity = 0.15 + 0.85 * day;
    this.scene.clearColor = new Color4(horizon.r * 0.5, horizon.g * 0.5, horizon.b * 0.5, 1);
    const pos = this.dome.getVerticesData('position');
    if (pos) {
      const col = new Float32Array((pos.length / 3) * 4);
      for (let i = 0; i < pos.length / 3; i++) {
        const y = pos[i * 3 + 1]! / 3500;
        const c = Color3.Lerp(horizon, zenith, Math.pow(clamp(y, 0, 1), 0.45));
        col.set([c.r, c.g, c.b, 1], i * 4);
      }
      this.dome.updateVerticesData(VertexBuffer.ColorKind, col);
    }
    if (this.probe && Math.abs(darkness - this.probeDarkness) > 0.05) {
      this.probe.cubeTexture.resetRefreshCounter();
      this.probeDarkness = darkness;
    }
    for (const l of this.airfield?.lights ?? []) l.mat.emissiveColor = l.colour.scale(l.day + (1 - l.day) * aircraftGlow);
    for (const g of this.airfield?.litGlass ?? []) g.emissiveColor = Color3.White().scale(1.3 * aircraftGlow);
    this.glow.intensity = 0.35 + 0.9 * aircraftGlow;
    this.pipeline.imageProcessing.exposure = 1 + 0.4 * aircraftGlow;
    return darkness;
  }

  /** Windows in the aircraft cabins: how brightly they glow (0 by day). */
  cabinLight(): number {
    return 1.3 * clamp((this.light.darkness - 0.1) / 0.25, 0, 1);
  }

  private aspect(): number {
    return this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
  }

  private applyCamera(): void {
    const aspect = this.aspect();
    const c = this.camera;
    c.alpha = -Math.PI / 2;
    c.radius = 3000;
    c.setTarget(new Vector3(this.view.x, 0, this.view.z));
    c.orthoTop = this.view.h / 2;
    c.orthoBottom = -this.view.h / 2;
    c.orthoLeft = (-this.view.h * aspect) / 2;
    c.orthoRight = (this.view.h * aspect) / 2;
    if (this.mode === 'build') {
      // where tile (0, 0) is and how big a tile is on screen (CSS pixels), for scripts that click on the map
      const cssW = this.canvas.clientWidth;
      const cssH = this.canvas.clientHeight;
      const viewW = this.view.h * aspect;
      this.canvas.dataset.tiles = JSON.stringify({
        x: ((0 - (this.view.x - viewW / 2)) / viewW) * cssW,
        y: ((this.view.z + this.view.h / 2) / this.view.h) * cssH,
        size: (T / viewW) * cssW,
      });
      // the tile grid fades in as tiles get big enough to aim at (faint when the whole map shows)
      const tilePx = (T / viewW) * cssW;
      if (this.grid) this.grid.color = Color3.Lerp(new Color3(0.3, 0.42, 0.2), new Color3(0.85, 0.9, 0.85), 0.15 + 0.6 * clamp((tilePx - 8) / 16, 0, 1));
    }
  }

  private resize(): void {
    this.engine.resize();
    if (this.area) this.fit(this.area);
  }

  /** The tile under a point on the canvas (CSS pixels from its top-left). */
  tileAt(px: number, py: number): { x: number; y: number } | null {
    const ray = this.scene.createPickingRay(px, py, Matrix.Identity(), this.camera);
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = -ray.origin.y / ray.direction.y;
    const p = ray.origin.add(ray.direction.scale(t));
    return { x: Math.floor(p.x / T), y: Math.floor(-p.z / T) };
  }

  /** Build Mode: zooms by `factor` (< 1 zooms in) keeping the point under (px, py) in place. */
  zoomAt(px: number, py: number, factor: number): void {
    if (!this.area) return;
    const before = this.groundAt(px, py);
    const aspect = this.aspect();
    const maxH = Math.max(this.area.h * T, (this.area.w * T) / aspect) * 1.05;
    this.view.h = clamp(this.view.h * factor, (12 * T) / aspect, maxH);
    this.applyCamera();
    const after = this.groundAt(px, py);
    if (before && after) {
      this.view.x += before.x - after.x;
      this.view.z += before.z - after.z;
    }
    this.clampView();
    this.applyCamera();
  }

  /** Build Mode: moves the map by a drag of (dx, dy) CSS pixels. */
  pan(dx: number, dy: number): void {
    const perPx = this.view.h / Math.max(1, this.canvas.clientHeight);
    this.view.x -= dx * perPx;
    this.view.z += (dy * perPx) / Math.max(0.2, Math.cos(this.camera.beta));
    this.clampView();
    this.applyCamera();
  }

  /** Build Mode: back to the whole map. */
  refit(): void {
    if (this.area) this.fit(this.area);
  }

  private clampView(): void {
    if (!this.area) return;
    const a = this.area;
    this.view.x = clamp(this.view.x, a.x * T, (a.x + a.w) * T);
    this.view.z = clamp(this.view.z, -(a.y + a.h) * T, -a.y * T);
  }

  private groundAt(px: number, py: number): Vector3 | null {
    const ray = this.scene.createPickingRay(px, py, Matrix.Identity(), this.camera);
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    return ray.origin.add(ray.direction.scale(-ray.origin.y / ray.direction.y));
  }

  private setTier(i: number): void {
    this.tier = i;
    const t = TIERS[i]!;
    const dpr = window.devicePixelRatio || 1;
    this.engine.setHardwareScalingLevel(1 / Math.min(dpr, t.scale));
    if (t.shadow) {
      this.sun.shadowEnabled = true;
      this.shadows.getShadowMap()?.resize(t.shadow);
      this.shadows.filteringQuality = t.shadow >= 2048 ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
    } else {
      this.sun.shadowEnabled = false;
    }
    this.pipeline.samples = t.msaa > 1 && this.engine.webGLVersion >= 2 ? t.msaa : 1;
    this.pipeline.fxaaEnabled = t.msaa <= 1;
    this.pipeline.bloomEnabled = t.bloom;
    this.engine.resize();
    if (this.area) this.fit(this.area);
  }

  /** Steps quality down after two seconds below 45 fps (only while the tab is shown). */
  private watchSpeed(ms: number): void {
    if (document.hidden || ms > 500) return;
    this.slowFor = ms > 1000 / 45 ? this.slowFor + ms : Math.max(0, this.slowFor - ms * 0.5);
    if (this.slowFor > 2000 && this.tier < TIERS.length - 1) {
      this.slowFor = 0;
      this.setTier(this.tier + 1);
    }
  }

  /** The quality level in use (for bug reports). */
  quality(): string {
    return TIERS[this.tier]!.name;
  }

  // ---- Build Mode overlay: grid, Land Plots, no-build zones, placement ghost

  private overlay: Array<{ dispose(): void }> = [];
  private grid: LinesMesh | null = null;
  private ghost: Array<{ dispose(): void }> = [];

  private overlayMat(name: string, hex: string, alpha: number): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.disableLighting = true;
    m.emissiveColor = Color3.FromHexString(hex);
    m.alpha = alpha;
    m.backFaceCulling = false;
    return m;
  }

  private flat(name: string, r: TileRect, mat: StandardMaterial, list: Array<{ dispose(): void }>): Mesh {
    const m = MeshBuilder.CreateGround(name, { width: r.w * T, height: r.h * T }, this.scene);
    m.position.set((r.x + r.w / 2) * T, 1, -(r.y + r.h / 2) * T);
    m.material = mat;
    m.renderingGroupId = 1;
    m.isPickable = false;
    list.push(m, mat);
    return m;
  }

  private lines(name: string, lines: Vector3[][], hex: string, alpha: number, list: Array<{ dispose(): void }>): LinesMesh {
    const m = MeshBuilder.CreateLineSystem(name, { lines }, this.scene);
    m.color = Color3.FromHexString(hex);
    m.alpha = alpha;
    m.renderingGroupId = 1;
    m.isPickable = false;
    list.push(m);
    return m;
  }

  /** Draws the tile grid, Land Plots not owned yet (dimmed, with their price) and the no-build zones past Runway ends. */
  setOverlay(world: TileRect, plotSize: { w: number; h: number }, unowned: readonly TileRect[], plotLabel: string, endZones: readonly TileRect[]): void {
    for (const o of this.overlay) o.dispose();
    this.overlay = [];
    const y = 1.2;
    const grid: Vector3[][] = [];
    const plots: Vector3[][] = [];
    for (let x = world.x; x <= world.x + world.w; x++) ((x - world.x) % plotSize.w ? grid : plots).push([new Vector3(x * T, y, -world.y * T), new Vector3(x * T, y, -(world.y + world.h) * T)]);
    for (let r = world.y; r <= world.y + world.h; r++) ((r - world.y) % plotSize.h ? grid : plots).push([new Vector3(world.x * T, y, -r * T), new Vector3((world.x + world.w) * T, y, -r * T)]);
    this.grid = this.lines('grid', grid, '#ffffff', 1, this.overlay);
    this.applyCamera();
    this.lines('plots', plots, '#ffc845', 0.6, this.overlay);
    const dim = this.overlayMat('unowned', '#000000', 0.55);
    for (const p of unowned) {
      this.flat('unowned', p, dim, this.overlay);
      this.overlay.push(this.label(plotLabel, p));
    }
    const zone = this.overlayMat('end-zone', '#ff6b5e', 0.16);
    const hatch: Vector3[][] = [];
    for (const z of endZones) {
      this.flat('end-zone', z, zone, this.overlay);
      for (let d = 0; d < z.w + z.h; d++) {
        hatch.push([
          new Vector3((z.x + Math.min(d, z.w)) * T, y, -(z.y + Math.max(0, d - z.w)) * T),
          new Vector3((z.x + Math.max(0, d - z.h)) * T, y, -(z.y + Math.min(d, z.h)) * T),
        ]);
      }
    }
    if (hatch.length) this.lines('hatch', hatch, '#ff6b5e', 0.6, this.overlay);
  }

  private label(text: string, r: TileRect): Mesh {
    const tex = canvasTexture(this.scene, 'plot-label', 512, 64, (g) => {
      g.fillStyle = 'rgba(11,18,16,0.6)';
      g.fillRect(0, 0, 512, 64);
      g.fillStyle = '#e6efeb';
      g.font = '700 44px "JetBrains Mono", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 256, 34, 500);
    }, { clamp: true, alpha: true });
    const mat = new StandardMaterial('plot-label', this.scene);
    mat.disableLighting = true;
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    const w = r.w * T * 0.9;
    const m = MeshBuilder.CreateGround('plot-label', { width: w, height: w / 8 }, this.scene);
    m.position.set((r.x + r.w / 2) * T, 1.4, -(r.y + r.h / 2) * T);
    m.material = mat;
    m.renderingGroupId = 1;
    m.isPickable = false;
    this.overlay.push(mat, tex);
    return m;
  }

  /** The placement ghost: rectangles in green (fits) or red (doesn't), a lead-in line, and the thing being moved. */
  setGhost(rects: readonly TileRect[], ok: boolean, leadIn: { from: [number, number]; to: [number, number] } | null, moving: TileRect | null): void {
    for (const g of this.ghost) g.dispose();
    this.ghost = [];
    const colour = ok ? '#6fd08c' : '#ff6b5e';
    const y = 1.6;
    const outline: Vector3[][] = [];
    const box = (r: TileRect) => {
      const x0 = r.x * T;
      const x1 = (r.x + r.w) * T;
      const z0 = -r.y * T;
      const z1 = -(r.y + r.h) * T;
      return [new Vector3(x0, y, z0), new Vector3(x1, y, z0), new Vector3(x1, y, z1), new Vector3(x0, y, z1), new Vector3(x0, y, z0)];
    };
    if (rects.length) {
      const fill = this.overlayMat('ghost', colour, 0.32);
      for (const r of rects) {
        this.flat('ghost', r, fill, this.ghost);
        outline.push(box(r));
      }
      this.lines('ghost-outline', outline, colour, 1, this.ghost);
    }
    if (leadIn) {
      this.lines('ghost-lead-in', [[new Vector3(leadIn.from[0] * T, y, -leadIn.from[1] * T), new Vector3(leadIn.to[0] * T, y, -leadIn.to[1] * T)]], '#f0d24a', 1, this.ghost);
    }
    if (moving) this.lines('moving', [box(moving)], '#f0b54a', 1, this.ghost);
  }

  /** Where a tile corner is on the canvas (CSS pixels), for labels drawn over the map. */
  screenOf(tx: number, ty: number): { x: number; y: number } {
    const p = Vector3.Project(new Vector3(tx * T, 0, -ty * T), Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(this.canvas.clientWidth, this.canvas.clientHeight));
    return { x: p.x, y: p.y };
  }

  dispose(): void {
    this.observer.disconnect();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
    this.canvas.remove();
  }
}
