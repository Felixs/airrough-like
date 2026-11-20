import { Application, Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js';
import { drawAirfield, fitToScreen, worldBounds } from '../render/airfield';
import {
  applyChange, BUILD_COSTS, MAIN_BUILDING, checkChange, confirmBuild, lengthened, newBuilding, newHoldingBay, newRunway, newStand, nextPlotPrice, openBuild, placeSpot,
  priceOf, ROLE_NAME, pendingTotal, structureAt, taxiwayFromDrag, undoPending, type BuildSession, type Change, type PlacementCheck,
} from '../sim/build';
import { runwayEndZones, spotEntry, TILE_SIZE, WORLD, type RunwayLength, type SizeClass, type Stand, type Structure, type SupportRole, type TileRect } from '../sim/layout';
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
  runway: 'Click to place a new Runway, or pick “Lengthen” and click the end of a Runway to grow it on that side.',
  building: 'Click to place a building (top-left at the cursor).',
  land: 'Click a dimmed Land Plot next to your land to buy it.',
  move: 'Click a building, Holding Bay or Remote Stand, then click where it should go. Free.',
  demolish: 'Click something to demolish it. You get back what building it again would cost.',
};

type Building = SupportRole | 'terminal' | 'cargoHub' | 'terminalWing' | 'cargoWing';
const TERMINAL_WING = { w: 3, h: 4 } as const;
const SIZE_NAME: Record<SizeClass, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
const LENGTH_NAME: Record<RunwayLength, string> = { short: 'Short', medium: 'Medium', long: 'Long' };
const SUPPORT_ROLES = ['rampAgentStation', 'adminOffice', 'airlineOffice', 'fireRescueStation', 'fuelFarm', 'deIcingPad'] as const;

/** The options a tool places with; each variant tile sets some of them. */
interface BuildOptions {
  size: SizeClass; placement: Stand['placement']; serves: Stand['serves'];
  length: RunwayLength; orientation: 'horizontal' | 'vertical'; runwayAction: 'new' | 'lengthen'; building: Building; surface: 'asphalt' | 'grass';
}

/** One tile in the variant picker: a small picture of what gets built, its name and its price. */
interface Variant {
  readonly id: string;
  /** Heading the tile is listed under (e.g. "Terminal · Contact"). */
  readonly group: string;
  readonly label: string;
  readonly icon: string;
  /** What building it costs now (null when it depends on where: lengthening). */
  readonly price: number | null;
  readonly unlock: UnlockableId | null;
  readonly set: Partial<BuildOptions>;
}

// --- variant icons: tiny top-down SVGs in the map's colours ---
const svg = (body: string) => `<svg viewBox="0 0 32 24" aria-hidden="true">${body}</svg>`;
const plane = (cx: number, cy: number, k: number, color = '#dfe8e4') =>
  `<path fill="${color}" d="M${cx} ${cy - 6 * k}l${1 * k} ${3 * k}l${5 * k} ${3 * k}v${1.2 * k}l${-5 * k} ${-1.2 * k}l${-0.4 * k} ${3 * k}l${1.8 * k} ${1.4 * k}v${0.8 * k}l${-2.4 * k} ${-0.6 * k}l${-2.4 * k} ${0.6 * k}v${-0.8 * k}l${1.8 * k} ${-1.4 * k}l${-0.4 * k} ${-3 * k}l${-5 * k} ${1.2 * k}v${-1.2 * k}l${5 * k} ${-3 * k}z"/>`;
const SIZE_K: Record<SizeClass, number> = { small: 0.75, medium: 1, large: 1.3 };
const SIZE_W: Record<SizeClass, number> = { small: 12, medium: 17, large: 22 };
function spotIcon(size: SizeClass, kind: 'stand' | 'holdingBay', placement: Stand['placement'] = 'contact', serves: Stand['serves'] = 'terminal'): string {
  const w = SIZE_W[size];
  const x = 16 - w / 2;
  const building = serves === 'terminal' ? '#4d6f8c' : '#8c6f3e';
  return svg(`${kind === 'stand' && placement === 'contact' ? `<rect x="2" y="1" width="28" height="5" rx="1" fill="${building}"/>` : ''}
    <rect x="${x}" y="7" width="${w}" height="15" rx="1" fill="#1d2a26" stroke="${kind === 'holdingBay' ? '#7fa89a' : '#f0d24a'}" stroke-width="0.8" ${kind === 'holdingBay' ? 'stroke-dasharray="2 1.5"' : ''}/>
    ${plane(16, 14.5, SIZE_K[size])}`);
}
function runwayIcon(length: RunwayLength | 'lengthen', vertical: boolean, grass: boolean): string {
  const l = length === 'lengthen' ? 18 : { short: 14, medium: 21, long: 28 }[length];
  const fill = grass ? '#3f6b3a' : '#3a3f42';
  const strip = vertical
    ? `<rect x="13" y="${12 - Math.min(l, 22) / 2}" width="6" height="${Math.min(l, 22)}" fill="${fill}"/>${grass ? '' : `<path d="M16 ${14 - Math.min(l, 22) / 2}V${10 + Math.min(l, 22) / 2}" stroke="#e8e8e8" stroke-width="0.7" stroke-dasharray="2 2"/>`}`
    : `<rect x="${16 - l / 2}" y="9" width="${l}" height="6" fill="${fill}"/>${grass ? '' : `<path d="M${18 - l / 2} 12H${14 + l / 2}" stroke="#e8e8e8" stroke-width="0.7" stroke-dasharray="2 2"/>`}`;
  const arrow = length === 'lengthen' ? '<path d="M26 12h5m-2-2l2 2l-2 2M6 12H1m2-2l-2 2l2 2" stroke="#6fd08c" stroke-width="1" fill="none"/>' : '';
  return svg(strip + arrow);
}
const BUILDING_GLYPH: Record<Building, string> = {
  terminal: 'TERM', cargoHub: 'CARGO', terminalWing: 'T+', cargoWing: 'C+', rampAgentStation: 'RA', adminOffice: 'AO', airlineOffice: 'AL', fireRescueStation: 'FR', fuelFarm: 'F', deIcingPad: 'DI',
};
function buildingIcon(b: Building): string {
  if (b === 'terminal' || b === 'cargoHub') {
    return svg(`<rect x="1" y="6" width="30" height="13" rx="1" fill="${b === 'terminal' ? '#4d6f8c' : '#8c6f3e'}" stroke="#0b1210"/>
      <text x="16" y="14.8" text-anchor="middle" font-size="6" font-family="monospace" font-weight="700" fill="#f2f5f4">${BUILDING_GLYPH[b]}</text>`);
  }
  const color = b === 'terminalWing' ? '#4d6f8c' : b === 'cargoWing' ? '#8c6f3e' : b === 'fireRescueStation' ? '#8c4a42' : '#56645f';
  const tall = b === 'terminalWing' || b === 'cargoWing';
  return svg(`<rect x="${tall ? 9 : 5}" y="${tall ? 2 : 6}" width="${tall ? 14 : 22}" height="${tall ? 20 : 13}" rx="1" fill="${color}" stroke="#0b1210"/>
    <text x="16" y="${tall ? 15.5 : 15}" text-anchor="middle" font-size="7" font-family="monospace" font-weight="700" fill="#f2f5f4">${BUILDING_GLYPH[b]}</text>`);
}

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
  /** The tool the cursor places with; null after placing something (a free cursor), until a tool or variant is picked. */
  let tool: Tool | null = 'taxiway';
  /** The tool whose variants the picker shows (the last one picked). */
  let shown: Tool = 'taxiway';
  const opt: BuildOptions = {
    size: 'medium', placement: 'contact', serves: 'terminal',
    length: 'medium', orientation: 'horizontal', runwayAction: 'new', building: 'terminalWing', surface: 'asphalt',
  };
  /** Which variant tile of each tool was picked last. */
  const picked: Partial<Record<Tool, string>> = { stand: 'stand-contact-terminal-medium', holdingBay: 'bay-medium', runway: 'runway-medium-h', building: 'terminalWing' };

  /** The variant tiles a tool offers, priced for the layout as it is with the pending changes. */
  const variantsOf = (t: Tool): Variant[] => {
    const at = { x: 0, y: 0 };
    const price = (st: Structure) => priceOf(session.layout, st);
    switch (t) {
      case 'stand': {
        const out: Variant[] = [];
        for (const placement of ['contact', 'remote'] as const) {
          for (const serves of ['terminal', 'cargoHub'] as const) {
            for (const size of ['small', 'medium', 'large'] as const) {
              const st = newStand(session, at, size, placement, serves);
              out.push({
                id: `stand-${placement}-${serves}-${size}`,
                group: `${serves === 'terminal' ? 'Terminal' : 'Cargo'} · ${placement === 'contact' ? 'Contact' : 'Remote'}`, label: SIZE_NAME[size],
                icon: spotIcon(size, 'stand', placement, serves), price: price(st), unlock: placement === 'remote' ? 'remoteStands' : null,
                set: { size, placement, serves },
              });
            }
          }
        }
        return out;
      }
      case 'holdingBay':
        return (['small', 'medium', 'large'] as const).map((size) => ({
          id: `bay-${size}`, group: 'Holding Bay', label: SIZE_NAME[size], icon: spotIcon(size, 'holdingBay'),
          price: price(newHoldingBay(session, at, size)), unlock: null, set: { size },
        }));
      case 'runway': {
        const out: Variant[] = [];
        for (const vertical of [false, true]) {
          for (const length of ['short', 'medium', 'long'] as const) {
            out.push({
              id: `runway-${length}-${vertical ? 'v' : 'h'}`, group: vertical ? 'New · 18-36' : 'New · 09-27', label: LENGTH_NAME[length],
              icon: runwayIcon(length, vertical, false), price: price(newRunway(session, at, length, vertical)), unlock: null,
              set: { runwayAction: 'new', length, orientation: vertical ? 'vertical' : 'horizontal', surface: 'asphalt' },
            });
          }
        }
        for (const vertical of [false, true]) {
          out.push({
            id: `grass-${vertical ? 'v' : 'h'}`, group: 'Grass strip (Short)', label: vertical ? '18-36' : '09-27', icon: runwayIcon('short', vertical, true),
            price: price(newRunway(session, at, 'short', vertical, true)), unlock: 'grassStrip',
            set: { runwayAction: 'new', length: 'short', orientation: vertical ? 'vertical' : 'horizontal', surface: 'grass' },
          });
        }
        out.push({ id: 'lengthen', group: 'Existing Runway', label: 'Lengthen', icon: runwayIcon('lengthen', false, false), price: null, unlock: null, set: { runwayAction: 'lengthen' } });
        return out;
      }
      case 'building':
        return [
          ...(['terminal', 'cargoHub'] as const).map((b): Variant => ({
            id: b, group: 'Main buildings', label: b === 'terminal' ? 'Terminal' : 'Cargo Hub', icon: buildingIcon(b),
            price: MAIN_BUILDING[b].w * MAIN_BUILDING[b].h * BUILD_COSTS.wingPerTile, unlock: null, set: { building: b },
          })),
          ...(['terminalWing', 'cargoWing', ...SUPPORT_ROLES] as const).map((b): Variant => ({
            id: b, group: b === 'terminalWing' || b === 'cargoWing' ? 'Wings' : 'Support', label: b === 'terminalWing' ? 'Terminal wing' : b === 'cargoWing' ? 'Cargo wing' : ROLE_NAME[b], icon: buildingIcon(b),
            price: b === 'terminalWing' || b === 'cargoWing' ? TERMINAL_WING.w * TERMINAL_WING.h * BUILD_COSTS.wingPerTile : BUILD_COSTS.supportBuilding[b],
            unlock: b, set: { building: b },
          })),
        ];
      default:
        return [];
    }
  };
  root.innerHTML = `
    <div class="build">
      <nav class="palette" aria-label="Build tools">${TOOLS.map(([id, name, key]) =>
        `<button type="button" data-tool="${id}" aria-pressed="${id === 'taxiway'}">${name}<kbd>${key.toUpperCase()}</kbd></button>`).join('')}
        <div class="variants" role="group" aria-label="What to build"></div></nav>
      <div class="build-map" aria-label="Build map"></div>
      <aside class="build-side">
        <div class="card"><h3>Placement</h3><div class="candidate"></div></div>
        <div class="card"><h3>Pending</h3><ol class="pending"></ol><dl class="totals"></dl>
          <div class="build-buttons"><button type="button" class="undo">Undo <kbd>Ctrl Z</kbd></button><button type="button" class="confirm">Confirm <kbd>Enter</kbd></button></div>
          <p class="msg" role="status"></p></div>
        <p class="hint">Esc frees the cursor · tool keys T S B R U L M D · 1–9 pick a variant</p>
      </aside>
    </div>`;
  const mapEl = root.querySelector<HTMLElement>('.build-map')!;
  const side = root.querySelector<HTMLElement>('.build-side')!;
  const palette = root.querySelector<HTMLElement>('.palette')!;
  const variantsEl = palette.querySelector<HTMLElement>('.variants')!;
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
  const fit = () => {
    fitToScreen(world, session.layout, app.screen.width, app.screen.height, worldBounds);
    // where tile (0, 0) is and how big a tile is on screen, for scripts that click on the map (README screenshots)
    app.canvas.dataset.tiles = JSON.stringify({ x: world.position.x, y: world.position.y, size: world.scale.x * T });
  };
  fit();
  app.renderer.on('resize', fit);

  const drawOverlay = () => {
    overlay.clear();
    for (const l of plotLabels.removeChildren()) l.destroy();
    const x0 = WORLD.x0;
    const y0 = WORLD.y0;
    for (let x = x0; x <= x0 + WORLD.width; x++) overlay.moveTo(x * T, y0 * T).lineTo(x * T, (y0 + WORLD.height) * T).stroke({ width: 0.15, color: 0x2a3a35 });
    for (let y = y0; y <= y0 + WORLD.height; y++) overlay.moveTo(x0 * T, y * T).lineTo((x0 + WORLD.width) * T, y * T).stroke({ width: 0.15, color: 0x2a3a35 });
    // the no-build areas past each Runway end: red hatching
    for (const z of session.layout.runways.flatMap(runwayEndZones)) {
      overlay.rect(z.x * T, z.y * T, z.w * T, z.h * T).fill({ color: 0xff6b5e, alpha: 0.12 }).stroke({ width: 0.4, color: 0xff6b5e, alpha: 0.6 });
      for (let d = 0; d < z.w + z.h; d += 1) {
        const x0 = z.x + Math.min(d, z.w);
        const y0 = z.y + Math.max(0, d - z.w);
        const x1 = z.x + Math.max(0, d - z.h);
        const y1 = z.y + Math.min(d, z.h);
        overlay.moveTo(x0 * T, y0 * T).lineTo(x1 * T, y1 * T).stroke({ width: 0.3, color: 0xff6b5e, alpha: 0.45 });
      }
    }
    const price = nextPlotPrice(session);
    for (let px = WORLD.x0 / WORLD.plotW; px < (WORLD.x0 + WORLD.width) / WORLD.plotW; px++) {
      for (let py = WORLD.y0 / WORLD.plotH; py < (WORLD.y0 + WORLD.height) / WORLD.plotH; py++) {
        if (session.ownedPlots.some((p) => p.px === px && p.py === py)) continue;
        overlay.rect(px * WORLD.plotW * T, py * WORLD.plotH * T, WORLD.plotW * T, WORLD.plotH * T).fill({ color: 0x000000, alpha: 0.55 });
        const t = new Text({ text: `Land Plot · ${money(price)}`, style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 7, fill: 0x8fa8a0 } });
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
      : `<p class="empty">${moving ? 'Click where it should go. Esc cancels.' : tool ? HINT[tool] : 'Pick what to build next: a tool, a tile or its key.'}</p>`;
    side.querySelector('.pending')!.innerHTML = session.pending.map((p) => `<li>${esc(p.label)} <span>${p.cost < 0 ? `+${money(-p.cost)}` : money(p.cost)}</span></li>`).join('') || '<li class="empty">Nothing yet</li>';
    const total = pendingTotal(session);
    side.querySelector('.totals')!.innerHTML = `<dt>Total</dt><dd>${money(total.cost)}</dd><dt>Upkeep</dt><dd>${total.upkeep >= 0 ? '+' : '−'}${money(Math.abs(total.upkeep))}/Day</dd><dt>Money after</dt><dd>${money(run.money - total.cost)}</dd>`;
    side.querySelector<HTMLButtonElement>('.undo')!.disabled = session.pending.length === 0;
    side.querySelector<HTMLButtonElement>('.confirm')!.disabled = session.pending.length === 0;
    renderVariants();
  };

  /** The picker under the tools: one tile per variant, greyed when locked or more than the money left. */
  const renderVariants = () => {
    const list = variantsOf(shown);
    const left = run.money - pendingTotal(session).cost;
    variantsEl.hidden = list.length === 0;
    variantsEl.innerHTML = list.map((v, i) => {
      const heading = i === 0 || list[i - 1]!.group !== v.group ? `<h4>${esc(v.group)}</h4>` : '';
      const locked = v.unlock !== null && !run.modifiers.unlocks.includes(v.unlock);
      const short = v.price !== null && v.price > left;
      const why = locked ? 'Locked: buy it in the Main Menu' : short ? `Not enough money (${money(left)} left)` : '';
      return `${heading}<button type="button" class="variant${short ? ' short' : ''}" data-variant="${v.id}" aria-pressed="${tool === shown && picked[shown] === v.id}"
        ${locked || short ? `disabled title="${esc(why)}"` : ''} aria-label="${esc(`${v.group}: ${v.label}${v.price !== null ? `, ${money(v.price)}` : ''}${why ? `. ${why}` : ''}`)}">
        ${v.icon}<span class="v-name">${locked ? '🔒 ' : ''}${esc(v.label)}</span><span class="cost">${v.price !== null ? money(v.price) : 'price difference'}</span>${i < 9 ? `<kbd>${i + 1}</kbd>` : ''}</button>`;
    }).join('');
  };
  const pickVariant = (id: string) => {
    const v = variantsOf(shown).find((x) => x.id === id);
    if (!v) return;
    picked[shown] = id;
    Object.assign(opt, v.set);
    selectTool(shown);
  };

  /** Picks a tool (with the variant last picked for it), or frees the cursor with null. */
  const selectTool = (t: Tool | null) => {
    if (t && t !== shown) {
      shown = t;
      const v = variantsOf(t).find((x) => x.id === picked[t]);
      if (v) Object.assign(opt, v.set);
    }
    tool = t;
    moving = null;
    candidate = null;
    dragFrom = null;
    for (const b of palette.querySelectorAll<HTMLButtonElement>('button[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
    drawGhost();
    renderSide();
  };
  palette.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tool], button[data-variant]');
    if (b?.dataset.tool) selectTool(b.dataset.tool as Tool);
    else if (b?.dataset.variant) pickVariant(b.dataset.variant);
  });

  /** The change the current tool would make at a tile, and the rectangles to show for it. */
  const changeAt = (t: Tile): { change: Change; rects: TileRect[] } | null => {
    switch (tool) {
      case null: return null;
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
          // grow on the side that was clicked: the west/north half lengthens it that way, the east/south half the other
          const horizontal = r.w >= r.h;
          const startSide = horizontal ? t.x < r.x + r.w / 2 : t.y < r.y + r.h / 2;
          const longer = lengthened(r, startSide ? 'start' : 'end');
          return longer ? { change: { kind: 'replace', from: r, to: longer }, rects: [longer] } : null;
        }
        const s = newRunway(session, t, opt.length, opt.orientation === 'vertical', opt.surface === 'grass');
        return { change: { kind: 'add', structure: s }, rects: [s] };
      }
      case 'building': {
        const s: Structure = opt.building === 'terminal' || opt.building === 'cargoHub' ? { kind: opt.building, x: t.x, y: t.y, ...MAIN_BUILDING[opt.building] }
          : opt.building === 'terminalWing' ? { kind: 'terminal', x: t.x, y: t.y, ...TERMINAL_WING }
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
    redraw();
    // placing frees the cursor (the next thing is picked by key or tile); Demolish stays on for clearing several things
    selectTool(tool === 'demolish' ? 'demolish' : null);
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
    if (tool && (tool !== 'taxiway' || dragFrom)) update(toTile(e));
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
    if (['SELECT', 'INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
    const byKey = TOOLS.find(([, , k]) => k === e.key.toLowerCase());
    const n = Number(e.key);
    if (byKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      selectTool(byKey[0]);
    } else if (n >= 1 && n <= 9 && !e.ctrlKey && !e.metaKey) {
      const v = variantsOf(shown)[n - 1];
      const b = v && variantsEl.querySelector<HTMLButtonElement>(`[data-variant="${v.id}"]`);
      if (v && b && !b.disabled) pickVariant(v.id);
    } else if (e.key === 'Escape') {
      selectTool(null);
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
