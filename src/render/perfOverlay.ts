import { SceneInstrumentation, type Scene } from '@babylonjs/core';

/** How far back the overlay looks (ms of real time) and how often it rewrites its text. */
const WINDOW_MS = 5000;
const REFRESH_MS = 500;
const SIZE = 4096;

/**
 * `?perf` in the address: a small box in the bottom-left corner with frames per second, milliseconds per frame, the
 * 1% low (the slowest 1% of frames over the last five seconds), the quality level, draw calls and meshes drawn, so the
 * Player can measure the view full screen or on a weak computer. Not shown in normal play.
 */
export class PerfOverlay {
  private readonly el: HTMLElement;
  private readonly stats: SceneInstrumentation;
  /** Ring buffer of recent frames: how long each took and when it ended. */
  private readonly ms = new Float32Array(SIZE);
  private readonly at = new Float64Array(SIZE);
  private readonly sorted = new Float32Array(SIZE);
  private head = 0;
  private count = 0;
  private lastText = 0;
  private cpu = 0;

  constructor(host: HTMLElement, private readonly scene: Scene) {
    this.stats = new SceneInstrumentation(scene);
    this.stats.captureFrameTime = true;
    this.el = document.createElement('pre');
    this.el.className = 'perf-overlay';
    this.el.setAttribute('aria-hidden', 'true');
    Object.assign(this.el.style, {
      position: 'fixed', left: '8px', bottom: '8px', zIndex: '1000', margin: '0', padding: '6px 8px', pointerEvents: 'none',
      font: '11px/1.35 "JetBrains Mono", monospace', color: '#e6efeb', background: 'rgba(11,18,16,0.78)', borderRadius: '4px', whiteSpace: 'pre',
    });
    this.el.textContent = 'measuring…';
    (host.ownerDocument ?? document).body.appendChild(this.el);
    scene.onDisposeObservable.add(() => {
      this.stats.dispose();
      this.el.remove();
    });
  }

  /** Hidden while the view draws nothing (e.g. under Plan Mode). */
  setShown(shown: boolean): void {
    const display = shown ? '' : 'none';
    if (this.el.style.display !== display) this.el.style.display = display;
  }

  /** Records a drawn frame (`ms` since the one before) and now and then rewrites the text. */
  frame(ms: number, tier: string): void {
    const now = performance.now();
    this.ms[this.head] = ms;
    this.at[this.head] = now;
    this.head = (this.head + 1) % SIZE;
    this.count = Math.min(SIZE, this.count + 1);
    this.cpu += (this.stats.frameTimeCounter.current - this.cpu) * 0.1;
    if (now - this.lastText < REFRESH_MS) return;
    this.lastText = now;
    let n = 0;
    let total = 0;
    for (let i = 0; i < this.count; i++) {
      const j = (this.head - 1 - i + SIZE) % SIZE;
      if (now - this.at[j]! > WINDOW_MS) break;
      this.sorted[n++] = this.ms[j]!;
      total += this.ms[j]!;
    }
    if (!n) return;
    const frames = this.sorted.subarray(0, n).sort();
    // the slowest 1% of frames (at least one): their average time, as frames per second
    const worst = Math.max(1, Math.floor(n / 100));
    let slow = 0;
    for (let i = n - worst; i < n; i++) slow += frames[i]!;
    slow /= worst;
    const avg = total / n;
    const engine = this.scene.getEngine();
    this.el.textContent = [
      `${(1000 / avg).toFixed(0)} fps  ${avg.toFixed(1)} ms/frame`,
      `1% low ${(1000 / slow).toFixed(0)} fps (${slow.toFixed(1)} ms)  max ${frames[n - 1]!.toFixed(1)} ms`,
      `cpu ${this.cpu.toFixed(1)} ms  quality ${tier}`,
      `draw calls ${this.stats.drawCallsCounter.current}  meshes ${this.scene.getActiveMeshes().length}`,
      `${engine.getRenderWidth()}×${engine.getRenderHeight()} px`,
    ].join('\n');
  }
}
