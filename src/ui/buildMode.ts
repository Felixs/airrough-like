import { Application, Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js';
import { drawAirfield, fitToScreen } from '../render/airfield';
import {
  addPending, confirmBuild, openBuild, pendingTotal, placementChecks, taxiwayFromDrag, undoPending,
  type BuildSession, type PlacementCheck,
} from '../sim/build';
import { TILE_SIZE, WORLD, type Structure } from '../sim/layout';
import type { RunState } from '../sim/run';
import type { Tile } from '../sim/taxi';

const T = TILE_SIZE;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

const TOOLS = [
  ['taxiway', 'Taxiway', 'T'],
  ['stand', 'Stands', 'S'],
  ['holdingBay', 'Holding Bay', 'B'],
  ['runway', 'Runways', 'R'],
  ['building', 'Buildings', 'U'],
  ['land', 'Land', 'L'],
  ['move', 'Move', 'M'],
  ['demolish', 'Demolish', 'D'],
] as const;
const READY_TOOLS = new Set<string>(['taxiway']);

export interface BuildModeHandlers {
  /** Called after Confirm with the updated Run. */
  onConfirmed(run: RunState): void;
}

export interface BuildModeView {
  destroy(): void;
}

/** Plan Mode · Build: the airfield on its tile grid with a tool palette, placement ghost, checks and pending list. */
export async function mountBuildMode(root: HTMLElement, run: RunState, handlers: BuildModeHandlers): Promise<BuildModeView> {
  let session: BuildSession = openBuild(run);
  let candidate: { structure: Structure; check: PlacementCheck } | null = null;
  let dragFrom: Tile | null = null;

  root.innerHTML = `
    <div class="build">
      <nav class="palette" aria-label="Build tools">${TOOLS.map(([id, name, key]) =>
        `<button type="button" data-tool="${id}" ${READY_TOOLS.has(id) ? 'aria-pressed="true"' : 'disabled title="Coming with the next build tickets"'}>${name}<kbd>${key}</kbd></button>`).join('')}</nav>
      <div class="build-map" aria-label="Build map: drag to draw a Taxiway"></div>
      <aside class="build-side">
        <div class="card"><h3>Placement</h3><div class="candidate"><p class="empty">Drag on the map to draw a Taxiway.</p></div></div>
        <div class="card"><h3>Pending</h3><ol class="pending"></ol><dl class="totals"></dl>
          <div class="build-buttons"><button type="button" class="undo">Undo <kbd>Ctrl Z</kbd></button><button type="button" class="confirm">Confirm <kbd>Enter</kbd></button></div>
          <p class="msg" role="status"></p></div>
        <p class="hint">Drag to draw · Esc cancels · Taxiways are one width that fits every aircraft.</p>
      </aside>
    </div>`;
  const mapEl = root.querySelector<HTMLElement>('.build-map')!;
  const app = new Application();
  await app.init({ resizeTo: mapEl, background: '#0b1210', antialias: true, autoDensity: true, resolution: window.devicePixelRatio });
  mapEl.appendChild(app.canvas);

  const world = new Container();
  const overlay = new Graphics();
  const ghost = new Graphics();
  const ghostLabel = new Text({ text: '', style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 4, fontWeight: '700', fill: 0xffffff } });
  ghostLabel.resolution = 4;
  let airfield = drawAirfield(session.layout);
  world.addChild(airfield, overlay, ghost, ghostLabel);
  app.stage.addChild(world);
  const fit = () => fitToScreen(world, session.layout, app.screen.width, app.screen.height);
  fit();
  app.renderer.on('resize', fit);

  const drawOverlay = () => {
    overlay.clear();
    for (let x = 0; x <= WORLD.width; x++) overlay.moveTo(x * T, 0).lineTo(x * T, WORLD.height * T).stroke({ width: 0.15, color: 0x2a3a35 });
    for (let y = 0; y <= WORLD.height; y++) overlay.moveTo(0, y * T).lineTo(WORLD.width * T, y * T).stroke({ width: 0.15, color: 0x2a3a35 });
    for (let px = 0; px < WORLD.width / WORLD.plotW; px++) {
      for (let py = 0; py < WORLD.height / WORLD.plotH; py++) {
        if (run.ownedPlots.some((p) => p.px === px && p.py === py)) continue;
        overlay.rect(px * WORLD.plotW * T, py * WORLD.plotH * T, WORLD.plotW * T, WORLD.plotH * T).fill({ color: 0x000000, alpha: 0.55 });
      }
    }
  };
  const redrawAirfield = () => {
    world.removeChild(airfield);
    airfield.destroy({ children: true });
    airfield = drawAirfield(session.layout);
    world.addChildAt(airfield, 0);
  };
  drawOverlay();

  const drawGhost = () => {
    ghost.clear();
    ghostLabel.text = '';
    for (const p of session.pending) {
      const s = p.structure;
      ghost.rect(s.x * T, s.y * T, s.w * T, s.h * T).stroke({ width: 0.6, color: 0x38d0b0 });
    }
    if (!candidate) return;
    const s = candidate.structure;
    const color = candidate.check.ok ? 0x6fd08c : 0xff6b5e;
    ghost.rect(s.x * T, s.y * T, s.w * T, s.h * T).fill({ color, alpha: 0.35 }).stroke({ width: 0.6, color });
    ghostLabel.text = `${s.w * s.h} tiles · ${money(candidate.check.cost)} · +${money(candidate.check.upkeep)}/Day`;
    ghostLabel.position.set(s.x * T, s.y * T - 6);
  };

  const side = root.querySelector<HTMLElement>('.build-side')!;
  const renderSide = () => {
    const c = candidate;
    side.querySelector('.candidate')!.innerHTML = c
      ? `<p><b>${esc(c.check.label)}</b> · ${money(c.check.cost)} · Upkeep +${money(c.check.upkeep)}/Day</p>
         <ul class="checks">${c.check.items.map((i) => `<li class="${i.ok ? 'ok' : 'bad'}">${i.ok ? '✓' : '✗'} ${esc(i.label)}</li>`).join('')}</ul>`
      : '<p class="empty">Drag on the map to draw a Taxiway.</p>';
    side.querySelector('.pending')!.innerHTML = session.pending.map((p) => `<li>${esc(p.label)} <span>${money(p.cost)}</span></li>`).join('') || '<li class="empty">Nothing yet</li>';
    const total = pendingTotal(session);
    side.querySelector('.totals')!.innerHTML = `<dt>Total</dt><dd>${money(total.cost)}</dd><dt>Upkeep</dt><dd>+${money(total.upkeep)}/Day</dd><dt>Money after</dt><dd>${money(run.money - total.cost)}</dd>`;
    side.querySelector<HTMLButtonElement>('.undo')!.disabled = session.pending.length === 0;
    side.querySelector<HTMLButtonElement>('.confirm')!.disabled = session.pending.length === 0;
  };
  renderSide();

  const toTile = (globalX: number, globalY: number): Tile => {
    const p = world.toLocal({ x: globalX, y: globalY });
    return { x: Math.floor(p.x / T), y: Math.floor(p.y / T) };
  };
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.on('pointerdown', (e: FederatedPointerEvent) => {
    dragFrom = toTile(e.global.x, e.global.y);
    update(dragFrom);
  });
  app.stage.on('pointermove', (e: FederatedPointerEvent) => {
    if (dragFrom) update(toTile(e.global.x, e.global.y));
  });
  const finish = () => {
    if (!dragFrom) return;
    dragFrom = null;
    if (candidate?.check.ok) {
      session = addPending(session, candidate.structure);
      candidate = null;
      redrawAirfield();
    }
    drawGhost();
    renderSide();
  };
  app.stage.on('pointerup', finish);
  app.stage.on('pointerupoutside', finish);
  function update(to: Tile): void {
    const structure = taxiwayFromDrag(dragFrom!, to);
    candidate = { structure, check: placementChecks(session, structure) };
    drawGhost();
    renderSide();
  }

  const msg = side.querySelector<HTMLElement>('.msg')!;
  const undo = () => {
    session = undoPending(session);
    redrawAirfield();
    drawGhost();
    renderSide();
  };
  const confirm = () => {
    try {
      run = confirmBuild(session);
      session = openBuild(run);
      candidate = null;
      msg.textContent = 'Built. The new layout is used from the next Day.';
      redrawAirfield();
      drawGhost();
      renderSide();
      handlers.onConfirmed(run);
    } catch (e) {
      msg.textContent = (e as Error).message;
    }
  };
  side.querySelector('.undo')!.addEventListener('click', undo);
  side.querySelector('.confirm')!.addEventListener('click', confirm);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      dragFrom = null;
      candidate = null;
      drawGhost();
      renderSide();
    } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (session.pending.length) undo();
    } else if (e.key === 'Enter' && session.pending.length) {
      confirm();
    }
  };
  window.addEventListener('keydown', onKey);

  return {
    destroy() {
      window.removeEventListener('keydown', onKey);
      app.destroy(true, { children: true });
    },
  };
}
