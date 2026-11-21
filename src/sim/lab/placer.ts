/**
 * Balance lab: how the scripted players build. Real players design layouts; the lab needs a few generic moves that
 * work from any airport, found by searching the map and checking each step with the game's own build rules:
 * a Stand or Holding Bay where one fits, a new pier (a whole Terminal or Cargo Hub with a Taxiway lane in front and a
 * connector to the network, buying Land on the way), and a longer Runway.
 */
import { applyChange, checkChange, lengthened, newHoldingBay, newRunway, newStand, taxiwayFromDrag, type BuildSession, type Change } from '../build';
import { WORLD, type SizeClass, type Stand, type Structure } from '../layout';
import type { LandPlot } from '../run';
import type { Tile } from '../taxi';

/** Applies a change if the game allows it (including money), else null. */
export function tryChange(s: BuildSession, change: Change): BuildSession | null {
  return checkChange(s, change).ok ? applyChange(s, change) : null;
}

const tilesIn = (s: BuildSession) => {
  const out: Tile[] = [];
  for (let y = WORLD.y0; y < WORLD.y0 + WORLD.height; y++) for (let x = WORLD.x0; x < WORLD.x0 + WORLD.width; x++) out.push({ x, y });
  return out.filter((t) => s.ownedPlots.some((p) => Math.floor(t.x / WORLD.plotW) === p.px && Math.floor(t.y / WORLD.plotH) === p.py));
};

/** Places a Stand of this size for this building where one fits now (Contact first, Remote when allowed). */
export function placeStand(s: BuildSession, size: SizeClass, serves: Stand['serves'], allowRemote: boolean): BuildSession | null {
  for (const placement of allowRemote ? (['contact', 'remote'] as const) : (['contact'] as const)) {
    for (const t of tilesIn(s)) {
      const next = tryChange(s, { kind: 'add', structure: newStand(s, t, size, placement, serves) });
      if (next) return next;
    }
  }
  return null;
}

/** Places a Holding Bay of this size where one fits. */
export function placeHoldingBay(s: BuildSession, size: SizeClass): BuildSession | null {
  for (const t of tilesIn(s)) {
    const next = tryChange(s, { kind: 'add', structure: newHoldingBay(s, t, size) });
    if (next) return next;
  }
  return null;
}

const plotOf = (t: Tile): LandPlot => ({ px: Math.floor(t.x / WORLD.plotW), py: Math.floor(t.y / WORLD.plotH) });

/** Buys the Land Plots a set of structures needs (in an order where each borders owned land); null if it can't. */
function buyLandFor(s: BuildSession, structures: readonly Structure[], maxPlots: number): BuildSession | null {
  const needed = new Map<string, LandPlot>();
  for (const r of structures) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const p = plotOf({ x, y });
        if (!s.ownedPlots.some((o) => o.px === p.px && o.py === p.py)) needed.set(`${p.px},${p.py}`, p);
      }
    }
  }
  if (needed.size > maxPlots) return null;
  let session = s;
  let left = [...needed.values()];
  while (left.length) {
    const before = left.length;
    for (const p of [...left]) {
      const next = tryChange(session, { kind: 'buyPlot', plot: p });
      if (next) {
        session = next;
        left = left.filter((q) => q !== p);
      }
    }
    if (left.length === before) return null;
  }
  return session;
}

/** Applies changes in order; null when any is refused. */
function applyAll(s: BuildSession, changes: readonly Change[]): BuildSession | null {
  let session: BuildSession | null = s;
  for (const c of changes) {
    session = session && tryChange(session, c);
    if (!session) return null;
  }
  return session;
}

const isTaxiway = (s: BuildSession, t: Tile) => s.layout.structures.some((o) => o.kind === 'taxiway' && t.x >= o.x && t.x < o.x + o.w && t.y >= o.y && t.y < o.y + o.h);

/**
 * A new pier: a whole Terminal or Cargo Hub, a Taxiway lane along one long side (the side its Stands will face), and a
 * straight connector from one end of the lane to the existing Taxiways. Tries places across the map (owned land first,
 * then up to `maxPlots` new Land Plots) and keeps the cheapest that the build rules allow. Stands come afterwards.
 */
export function buildPier(s: BuildSession, kind: 'terminal' | 'cargoHub', maxPlots = 3): BuildSession | null {
  const W = kind === 'terminal' ? 10 : 7;
  // keep the strip south of the first Runway free for a parallel Runway later (see buildParallelRunway)
  const r1 = s.layout.runways[0];
  const reserved = r1 && r1.w > r1.h ? { x: r1.x - 12, y: r1.y + r1.h, w: r1.w + 24, h: 14 } : null;
  const clearOfReserve = (r: Structure) => !reserved || !(r.x < reserved.x + reserved.w && reserved.x < r.x + r.w && r.y < reserved.y + reserved.h && reserved.y < r.y + r.h);
  let best: { session: BuildSession; cost: number } | null = null;
  const spent = (x: BuildSession) => x.pending.reduce((n, p) => n + p.cost, 0);
  for (let y = WORLD.y0 + 1; y < WORLD.y0 + WORLD.height - 12; y += 2) {
    for (let x = WORLD.x0 + 3; x < WORLD.x0 + WORLD.width - W - 3; x += 2) {
      for (const facing of ['south', 'north'] as const) {
        // building, 3 rows of Stands, then the lane (south facing); mirrored for north
        const building: Structure = { kind, x, y: facing === 'south' ? y : y + 6, w: W, h: 4 };
        const laneRow = facing === 'south' ? y + 8 : y + 1;
        const lane = taxiwayFromDrag({ x: x - 2, y: laneRow }, { x: x + W + 1, y: laneRow });
        for (const end of [x - 2, x + W + 1]) {
          for (const dir of [1, -1]) {
            // a straight connector from the lane end until it meets an existing Taxiway
            let reach = 0;
            for (let d = 2; d <= 24; d++) {
              if (isTaxiway(s, { x: end, y: laneRow + dir * d })) {
                reach = d;
                break;
              }
            }
            if (!reach) continue;
            const connector = taxiwayFromDrag({ x: end, y: laneRow + dir * reach }, { x: end, y: laneRow + dir * 2 });
            if (![building, lane, connector].every(clearOfReserve)) continue;
            const land = buyLandFor(s, [building, lane, connector], maxPlots);
            if (!land) continue;
            const built = applyAll(land, [
              { kind: 'add', structure: connector },
              { kind: 'add', structure: lane },
              { kind: 'add', structure: building },
            ]);
            if (built && (!best || spent(built) < best.cost)) best = { session: built, cost: spent(built) };
          }
        }
      }
    }
  }
  return best?.session ?? null;
}

/** Lengthens a Runway that can still grow (Medium → Long), on whichever end has room, buying Land if needed. */
export function lengthenRunway(s: BuildSession, maxPlots = 1): BuildSession | null {
  for (const r of s.layout.runways) {
    if (r.surface === 'grass') continue;
    for (const side of ['end', 'start'] as const) {
      const to = lengthened(r, side);
      if (!to) continue;
      const land = buyLandFor(s, [to], maxPlots);
      const next = land && tryChange(land, { kind: 'replace', from: r, to });
      if (next) return next;
    }
  }
  return null;
}

/**
 * A second, parallel Runway below a horizontal one: a new parallel Taxiway between them, short connectors down to the
 * new Runway at both ends, and a loop round one end of the old Runway (clear of its end zone) that joins the existing
 * parallel Taxiway to the new one. Buys the Land it needs (up to `maxPlots`). Built for layouts like the Starting
 * Airport (a horizontal Runway with its Taxiways above it); returns null for others.
 */
export function buildParallelRunway(s: BuildSession, length: 'medium' | 'long' | 'grass', maxPlots = 4): BuildSession | null {
  const r1 = s.layout.runways[0];
  if (!r1 || r1.h > r1.w) return null;
  // the existing parallel Taxiway: the long horizontal one closest above the Runway
  const t1 = s.layout.structures
    .filter((o) => o.kind === 'taxiway' && o.w >= 10 && o.h === 3 && o.y + o.h <= r1.y && o.y >= r1.y - 12)
    .sort((a, b) => b.w - a.w)[0];
  if (!t1) return null;
  const row1 = t1.y + 1;
  const row2 = r1.y + r1.h + 2; // new parallel Taxiway: rows just below the old Runway, not touching it
  const r2y = row2 + 4; // the new Runway, with 2 rows of connector between
  const tiles = { grass: 24, medium: 36, long: 48 }[length];
  for (const side of ['west', 'east'] as const) {
    const loopX = side === 'west' ? r1.x - 6 : r1.x + r1.w + 6;
    const r2x = side === 'west' ? r1.x : r1.x + r1.w - tiles;
    const r2 = length === 'grass' ? newRunway(s, { x: r2x, y: r2y }, 'short', false, true) : newRunway(s, { x: r2x, y: r2y }, length, false);
    const stubs = [r2.x + 1, r2.x + r2.w - 2].map((x) => taxiwayFromDrag({ x, y: row2 + 2 }, { x, y: r2y - 1 }));
    const farX = side === 'west' ? r2.x + r2.w - 2 : r2.x + 1;
    const changes: Change[] = [
      // extend the old parallel Taxiway to the loop, down the loop, then along under the old Runway
      { kind: 'add', structure: taxiwayFromDrag({ x: side === 'west' ? t1.x - 1 : t1.x + t1.w, y: row1 }, { x: loopX, y: row1 }) },
      { kind: 'add', structure: taxiwayFromDrag({ x: loopX, y: row1 + 2 }, { x: loopX, y: row2 }) },
      { kind: 'add', structure: taxiwayFromDrag({ x: side === 'west' ? loopX + 2 : loopX - 2, y: row2 }, { x: farX, y: row2 }) },
      ...stubs.map((st): Change => ({ kind: 'add', structure: st })),
      { kind: 'add', structure: r2 },
    ];
    const structures = changes.flatMap((c) => (c.kind === 'add' ? [c.structure] : []));
    const land = buyLandFor(s, structures, maxPlots);
    const built = land && applyAll(land, changes);
    if (built) return built;
  }
  return null;
}

