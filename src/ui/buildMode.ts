import { Application, Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js';
import { drawAirfield, fitToScreen, worldBounds } from '../render/airfield';
import {
  applyChange, checkChange, confirmBuild, lengthened, newBuilding, newHoldingBay, newRunway, newStand, nextPlotPrice, openBuild, placeSpot,
  ROLE_NAME, pendingTotal, structureAt, taxiwayFromDrag, undoPending, type BuildSession, type Change, type PlacementCheck,
} from '../sim/build';
import { spotEntry, TILE_SIZE, WORLD, type RunwayLength, type SizeClass, type Stand, type Structure, type SupportRole, type TileRect } from '../sim/layout';
import type { RunState } from '../sim/run';
import type { UnlockableId } from '../sim/meta';
import type { Tile } from '../sim/taxi';

const T = TILE_SIZE;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

type Tool = 'taxiway' | 'stand' | 'holdingBay' | 'runway' | 'building' | 'land' | 'move' | 'demolish';
const TOOLS: ReadonlyArray<readonly [Tool, string, string]> = [
  ['taxiway', 'Taxiway', 't'], ['stand', 'Stands', 's'], ['holdingBay', 'Holding Bay', 'b'], ['runway', 'Runways', 'r'],
  ['building', 'Buildings', 'u'], ['land', 'Land', 'l'], ['move', 'Move', 'm'], ['demolish', 'Demolish', 'd'],
];
const HINT: Record<Tool, string> = {
  taxiway: 'Drag on the map to draw a Taxiway.',
  stand: 'Click to place a Stand (top-left at the cursor).',
  holdingBay: 'Click to place a Holding Bay (top-left at the cursor).',
  runway: 'Click to place a new Runway, or pick “Lengthen” and click a Runway.',
  building: 'Click to place a building (top-left at the cursor).',
  land: 'Click a dimmed Land Plot next to your land to buy it.',
  move: 'Click a building, Holding Bay or Remote Stand, then click where it should go. Free.',
  demolish: 'Click something to demolish it for a 50% refund.',
};

type Building = SupportRole | 'terminalWing' | 'cargoWing';
const TERMINAL_WING = { w: 3, h: 4 } as const;

export interface BuildModeHandlers {
  /** Called after Confirm with the updated Run. */
  onConfirmed(run: RunState): void;
}

export interface BuildModeView {
  /** Changes placed but not confirmed yet, and what confirming them would cost. */
  pending(): { count: number; cost: number };
  /** Confirms the pending changes; false (with the reason shown) when they can't be built. */
  confirm(): boolean;
  destroy(): void;
}

/** Plan Mode · Build: the airfield on its tile grid with a tool palette, placement ghost, checks and pending list. */
export async function mountBuildMode(root: HTMLElement, run: RunState, handlers: BuildModeHandlers): Promise<BuildModeView> {
  let session: BuildSession = openBuild(run);
  let candidate: { change: Change; rects: TileRect[]; check: PlacementCheck } | null = null;
  let dragFrom: Tile | null = null;
  let moving: Structure | null = null;
  let tool: Tool = 'taxiway';
  const opt = {
    size: 'medium' as SizeClass, placement: 'contact' as Stand['placement'], serves: 'terminal' as Stand['serves'],
    length: 'medium' as RunwayLength, orientation: 'horizontal', runwayAction: 'new', building: 'terminalWing' as Building, surface: 'asphalt',
  };

  /** Option text with a lock when the Unlockable isn't owned yet. */
  const lock = (id: UnlockableId, text: string) => (run.modifiers.unlocks.includes(id) ? text : `🔒 ${text}`);
  const select = (name: string, values: Array<[string, string]>, selected: string, show: Tool[]) =>
    `<label data-for="${show.join(' ')}">${name}<select data-opt="${name.toLowerCase()}">${values.map(([v, l]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
  root.innerHTML = `
    <div class="build">
      <nav class="palette" aria-label="Build tools">${TOOLS.map(([id, name, key]) =>
        `<button type="button" data-tool="${id}" aria-pressed="${id === 'taxiway'}">${name}<kbd>${key.toUpperCase()}</kbd></button>`).join('')}
        <div class="tool-options">
          ${select('Size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], 'medium', ['stand', 'holdingBay'])}
          ${select('Type', [['contact', 'Contact'], ['remote', lock('remoteStands', 'Remote')]], 'contact', ['stand'])}
          ${select('Serves', [['terminal', 'Terminal'], ['cargoHub', 'Cargo Hub']], 'terminal', ['stand'])}
          ${select('Action', [['new', 'New Runway'], ['lengthen', 'Lengthen']], 'new', ['runway'])}
          ${select('Length', [['short', 'Short (24)'], ['medium', 'Medium (36)'], ['long', 'Long (48)']], 'medium', ['runway'])}
          ${select('Orientation', [['horizontal', '09-27 (horizontal)'], ['vertical', '18-36 (vertical)']], 'horizontal', ['runway'])}
          ${select('Surface', [['asphalt', 'Asphalt'], ['grass', lock('grassStrip', 'Grass strip (Short)')]], 'asphalt', ['runway'])}
          ${select('Building', [
            ['terminalWing', lock('terminalWing', 'Terminal wing')], ['cargoWing', lock('cargoWing', 'Cargo Hub wing')],
            ...(['rampAgentStation', 'adminOffice', 'airlineOffice', 'fireRescueStation', 'fuelFarm', 'deIcingPad'] as const).map((r): [string, string] => [r, lock(r, ROLE_NAME[r])]),
          ], 'terminalWing', ['building'])}
        </div></nav>
      <div class="build-map" aria-label="Build map"></div>
      <aside class="build-side">
        <div class="card"><h3>Placement</h3><div class="candidate"></div></div>
        <div class="card"><h3>Pending</h3><ol class="pending"></ol><dl class="totals"></dl>
          <div class="build-buttons"><button type="button" class="undo">Undo <kbd>Ctrl Z</kbd></button><button type="button" class="confirm">Confirm <kbd>Enter</kbd></button></div>
          <p class="msg" role="status"></p></div>
        <p class="hint">Esc cancels · tool keys T S B R U L M D</p>
      </aside>
    </div>`;
  const mapEl = root.querySelector<HTMLElement>('.build-map')!;
  const side = root.querySelector<HTMLElement>('.build-side')!;
  const palette = root.querySelector<HTMLElement>('.palette')!;
  const msg = side.querySelector<HTMLElement>('.msg')!;

  const app = new Application();
  await app.init({ resizeTo: mapEl, background: '#0b1210', antialias: true, autoDensity: true, resolution: window.devicePixelRatio });
  mapEl.appendChild(app.canvas);

  const world = new Container();
  const overlay = new Graphics();
  const plotLabels = new Container();
  const ghost = new Graphics();
  const ghostLabel = new Text({ text: '', style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 4, fontWeight: '700', fill: 0xffffff } });
  ghostLabel.resolution = 4;
  let airfield = drawAirfield(session.layout);
  world.addChild(airfield, overlay, plotLabels, ghost, ghostLabel);
  app.stage.addChild(world);
  const fit = () => fitToScreen(world, session.layout, app.screen.width, app.screen.height, worldBounds);
  fit();
  app.renderer.on('resize', fit);

  const drawOverlay = () => {
    overlay.clear();
    for (const l of plotLabels.removeChildren()) l.destroy();
    const x0 = WORLD.x0;
    const y0 = WORLD.y0;
    for (let x = x0; x <= x0 + WORLD.width; x++) overlay.moveTo(x * T, y0 * T).lineTo(x * T, (y0 + WORLD.height) * T).stroke({ width: 0.15, color: 0x2a3a35 });
    for (let y = y0; y <= y0 + WORLD.height; y++) overlay.moveTo(x0 * T, y * T).lineTo((x0 + WORLD.width) * T, y * T).stroke({ width: 0.15, color: 0x2a3a35 });
    const price = nextPlotPrice(session);
    for (let px = WORLD.x0 / WORLD.plotW; px < (WORLD.x0 + WORLD.width) / WORLD.plotW; px++) {
      for (let py = WORLD.y0 / WORLD.plotH; py < (WORLD.y0 + WORLD.height) / WORLD.plotH; py++) {
        if (session.ownedPlots.some((p) => p.px === px && p.py === py)) continue;
        overlay.rect(px * WORLD.plotW * T, py * WORLD.plotH * T, WORLD.plotW * T, WORLD.plotH * T).fill({ color: 0x000000, alpha: 0.55 });
        const t = new Text({ text: `Land Plot · ${money(price)}`, style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 4, fill: 0x8fa8a0 } });
        t.resolution = 4;
        t.anchor.set(0.5);
        t.position.set((px + 0.5) * WORLD.plotW * T, (py + 0.5) * WORLD.plotH * T);
        plotLabels.addChild(t);
      }
    }
  };
  const redraw = () => {
    world.removeChild(airfield);
    airfield.destroy({ children: true });
    airfield = drawAirfield(session.layout);
    world.addChildAt(airfield, 0);
    drawOverlay();
  };
  drawOverlay();

  const drawGhost = () => {
    ghost.clear();
    ghostLabel.text = '';
    if (moving) ghost.rect(moving.x * T, moving.y * T, moving.w * T, moving.h * T).stroke({ width: 0.8, color: 0xf0b54a });
    if (!candidate) return;
    const color = candidate.change.kind === 'remove' ? 0xff6b5e : candidate.check.ok ? 0x6fd08c : 0xff6b5e;
    for (const r of candidate.rects) ghost.rect(r.x * T, r.y * T, r.w * T, r.h * T).fill({ color, alpha: 0.32 }).stroke({ width: 0.6, color });
    // the lead-in a Stand or Holding Bay will get, from the Taxiway tile in front into its centre
    const spot = candidate.change.kind === 'add' ? candidate.change.structure : candidate.change.kind === 'move' ? candidate.change.to : null;
    if (spot && (spot.kind === 'stand' || spot.kind === 'holdingBay')) {
      const e = spotEntry(spot);
      ghost.moveTo((e.x + 0.5) * T, (e.y + 0.5) * T).lineTo((spot.x + spot.w / 2) * T, (spot.y + spot.h / 2) * T)
        .stroke({ width: 0.8, color: 0xf0d24a, cap: 'round' });
      ghost.circle((e.x + 0.5) * T, (e.y + 0.5) * T, 1.2).fill(0xf0d24a);
    }
    const c = candidate.check;
    const r0 = candidate.rects[0]!;
    ghostLabel.text = `${c.label} · ${c.cost < 0 ? `refund ${money(-c.cost)}` : money(c.cost)}${c.upkeep ? ` · ${c.upkeep > 0 ? '+' : '−'}${money(Math.abs(c.upkeep))}/Day` : ''}`;
    ghostLabel.position.set(r0.x * T, Math.max(0, r0.y * T - 6));
  };

  const renderSide = () => {
    const c = candidate;
    side.querySelector('.candidate')!.innerHTML = c
      ? `<p><b>${esc(c.check.label)}</b> · ${c.check.cost < 0 ? `refund ${money(-c.check.cost)}` : money(c.check.cost)}${c.check.upkeep ? ` · Upkeep ${c.check.upkeep > 0 ? '+' : '−'}${money(Math.abs(c.check.upkeep))}/Day` : ''}</p>
         <ul class="checks">${c.check.items.map((i) => `<li class="${i.ok ? 'ok' : 'bad'}">${i.ok ? '✓' : '✗'} ${esc(i.label)}</li>`).join('')}</ul>`
      : `<p class="empty">${moving ? 'Click where it should go. Esc cancels.' : HINT[tool]}</p>`;
    side.querySelector('.pending')!.innerHTML = session.pending.map((p) => `<li>${esc(p.label)} <span>${p.cost < 0 ? `+${money(-p.cost)}` : money(p.cost)}</span></li>`).join('') || '<li class="empty">Nothing yet</li>';
    const total = pendingTotal(session);
    side.querySelector('.totals')!.innerHTML = `<dt>Total</dt><dd>${money(total.cost)}</dd><dt>Upkeep</dt><dd>${total.upkeep >= 0 ? '+' : '−'}${money(Math.abs(total.upkeep))}/Day</dd><dt>Money after</dt><dd>${money(run.money - total.cost)}</dd>`;
    side.querySelector<HTMLButtonElement>('.undo')!.disabled = session.pending.length === 0;
    side.querySelector<HTMLButtonElement>('.confirm')!.disabled = session.pending.length === 0;
  };

  const selectTool = (t: Tool) => {
    tool = t;
    moving = null;
    candidate = null;
    for (const b of palette.querySelectorAll<HTMLButtonElement>('button[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
    for (const l of palette.querySelectorAll<HTMLElement>('[data-for]')) l.hidden = !l.dataset.for!.split(' ').includes(t);
    drawGhost();
    renderSide();
  };
  palette.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tool]');
    if (b) selectTool(b.dataset.tool as Tool);
  });
  palette.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    const key = sel.dataset.opt === 'serves' ? 'serves' : sel.dataset.opt === 'type' ? 'placement' : sel.dataset.opt === 'action' ? 'runwayAction' : sel.dataset.opt!;
    (opt as Record<string, string>)[key] = sel.value;
  });

  /** The change the current tool would make at a tile, and the rectangles to show for it. */
  const changeAt = (t: Tile): { change: Change; rects: TileRect[] } | null => {
    switch (tool) {
      case 'taxiway': {
        const s = taxiwayFromDrag(dragFrom ?? t, t);
        return { change: { kind: 'add', structure: s }, rects: [s] };
      }
      case 'stand': {
        const s = newStand(session, t, opt.size, opt.placement, opt.serves);
        return { change: { kind: 'add', structure: s }, rects: [s] };
      }
      case 'holdingBay': {
        const s = newHoldingBay(session, t, opt.size);
        return { change: { kind: 'add', structure: s }, rects: [s] };
      }
      case 'runway': {
        if (opt.runwayAction === 'lengthen') {
          const r = structureAt(session.layout, t);
          if (r?.kind !== 'runway') return null;
          const longer = lengthened(r);
          return longer ? { change: { kind: 'replace', from: r, to: longer }, rects: [longer] } : null;
        }
        const s = newRunway(session, t, opt.length, opt.orientation === 'vertical', opt.surface === 'grass');
        return { change: { kind: 'add', structure: s }, rects: [s] };
      }
      case 'building': {
        const s: Structure = opt.building === 'terminalWing' ? { kind: 'terminal', x: t.x, y: t.y, ...TERMINAL_WING }
          : opt.building === 'cargoWing' ? { kind: 'cargoHub', x: t.x, y: t.y, ...TERMINAL_WING }
          : newBuilding(session, t, opt.building);
        return { change: { kind: 'add', structure: s }, rects: [s] };
      }
      case 'land': {
        const plot = { px: Math.floor(t.x / WORLD.plotW), py: Math.floor(t.y / WORLD.plotH) };
        return { change: { kind: 'buyPlot', plot }, rects: [{ x: plot.px * WORLD.plotW, y: plot.py * WORLD.plotH, w: WORLD.plotW, h: WORLD.plotH }] };
      }
      case 'move': {
        if (!moving) return null;
        const to = (moving.kind === 'stand'
          ? { ...moving, ...placeSpot(session.layout, t, moving.size, moving.placement === 'contact' ? moving.serves : undefined) }
          : moving.kind === 'holdingBay'
            ? { ...moving, ...placeSpot(session.layout, t, moving.size) }
            : { ...moving, x: t.x, y: t.y }) as Structure;
        return { change: { kind: 'move', from: moving, to }, rects: [to] };
      }
      case 'demolish': {
        const s = structureAt(session.layout, t);
        return s ? { change: { kind: 'remove', structure: s }, rects: [s] } : null;
      }
    }
  };

  const update = (t: Tile) => {
    const c = changeAt(t);
    candidate = c ? { ...c, check: checkChange(session, c.change) } : null;
    drawGhost();
    renderSide();
  };
  const commit = () => {
    if (!candidate) return;
    if (!candidate.check.ok) {
      msg.textContent = candidate.check.items.filter((i) => !i.ok).map((i) => i.label).join(' · ');
      return;
    }
    session = applyChange(session, candidate.change);
    msg.textContent = '';
    moving = null;
    candidate = null;
    redraw();
    drawGhost();
    renderSide();
  };

  const toTile = (e: FederatedPointerEvent): Tile => {
    const p = world.toLocal(e.global);
    return { x: Math.floor(p.x / T), y: Math.floor(p.y / T) };
  };
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.on('pointerdown', (e: FederatedPointerEvent) => {
    const t = toTile(e);
    if (tool === 'taxiway') {
      dragFrom = t;
      update(t);
    } else if (tool === 'move' && !moving) {
      const s = structureAt(session.layout, t);
      if (s) {
        moving = s;
        update(t);
      }
    } else {
      update(t);
      commit();
    }
  });
  app.stage.on('pointermove', (e: FederatedPointerEvent) => {
    if (tool !== 'taxiway' || dragFrom) update(toTile(e));
  });
  const finish = () => {
    if (!dragFrom) return;
    dragFrom = null;
    commit();
  };
  app.stage.on('pointerup', finish);
  app.stage.on('pointerupoutside', finish);

  const undo = () => {
    session = undoPending(session);
    redraw();
    drawGhost();
    renderSide();
  };
  const confirm = () => {
    try {
      run = confirmBuild(session);
      session = openBuild(run);
      candidate = null;
      moving = null;
      msg.textContent = 'Built. The new layout is used from the next Day.';
      redraw();
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
    if ((e.target as HTMLElement).tagName === 'SELECT') return;
    const byKey = TOOLS.find(([, , k]) => k === e.key);
    if (byKey && !e.ctrlKey && !e.metaKey) {
      selectTool(byKey[0]);
    } else if (e.key === 'Escape') {
      dragFrom = null;
      moving = null;
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
  selectTool('taxiway');

  return {
    pending: () => ({ count: session.pending.length, cost: pendingTotal(session).cost }),
    confirm() {
      confirm();
      return session.pending.length === 0;
    },
    destroy() {
      window.removeEventListener('keydown', onKey);
      app.destroy(true, { children: true });
    },
  };
}
