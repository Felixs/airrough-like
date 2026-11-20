import { describe, expect, it } from 'vitest';
import { createLayout, findOverlaps, runwayNames, startingAirport } from './layout';

describe('Starting Airport', () => {
  const airport = startingAirport();
  const of = <K extends string>(kind: K) => airport.structures.filter((s) => s.kind === kind);

  it('has one Medium Asphalt Runway', () => {
    const runways = airport.runways;
    expect(runways).toHaveLength(1);
    expect(runways[0]?.length).toBe('medium');
    expect(runways[0]?.surface).toBe('asphalt');
  });

  it('has a Terminal with 2 Small + 1 Medium Stands and a Cargo Hub with 1 Medium + 1 Small', () => {
    expect(airport.stands.filter((s) => s.serves === 'terminal').map((s) => s.size)).toEqual(['small', 'small', 'medium']);
    expect(airport.stands.filter((s) => s.serves === 'cargoHub').map((s) => s.size)).toEqual(['medium', 'small']);
    expect(of('terminal')).toHaveLength(1);
    expect(of('cargoHub')).toHaveLength(1);
    expect(airport.stands.filter((s) => s.serves === 'terminal').length).toBeGreaterThanOrEqual(2);
    expect(airport.stands.filter((s) => s.serves === 'cargoHub')).toHaveLength(2);
  });

  it('has a Small and a Medium Holding Bay, an ATC Tower and Taxiways', () => {
    expect(airport.holdingBays.map((b) => b.size)).toEqual(['small', 'medium']);
    expect(of('atcTower')).toHaveLength(1);
    expect(of('taxiway').length).toBeGreaterThan(0);
  });

  it('has no two structures overlapping on the tile grid', () => {
    expect(findOverlaps(airport)).toHaveLength(0);
  });

  it('keeps every structure inside the grid', () => {
    for (const s of airport.structures) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x + s.w).toBeLessThanOrEqual(airport.width);
      expect(s.y + s.h).toBeLessThanOrEqual(airport.height);
    }
  });
});

describe('findOverlaps', () => {
  it('reports structures sharing a tile but not ones that only touch', () => {
    const layout = createLayout(10, 10, [
      { kind: 'taxiway', x: 0, y: 0, w: 3, h: 3 },
      { kind: 'taxiway', x: 3, y: 0, w: 3, h: 3 }, // touches the first, no shared tile
      { kind: 'holdingBay', id: 'B9', x: 5, y: 2, w: 3, h: 3, size: 'medium' }, // shares tile (5,2) with the second
    ]);
    const overlaps = findOverlaps(layout);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]?.[1].kind).toBe('holdingBay');
  });
});

describe('Runway names', () => {
  const runway = (y: number, x = 6, vertical = false) =>
    ({ kind: 'runway' as const, x, y, w: vertical ? 4 : 36, h: vertical ? 36 : 4, length: 'medium' as const, surface: 'asphalt' as const });
  const names = (rs: ReturnType<typeof runway>[]) => runwayNames(createLayout(96, 64, rs)).map((n) => `${n.forward}/${n.reverse}`);

  it('are 09/27 and 18/36 for a single Runway of each kind', () => {
    expect(names([runway(24)])).toEqual(['09/27']);
    expect(names([runway(24), runway(0, 50, true)])).toEqual(['09/27', '18/36']);
  });

  it('get L / R and L / C / R for parallels as seen on approach, swapped at the other end', () => {
    expect(names([runway(24), runway(34)])).toEqual(['09L/27R', '09R/27L']); // the northern one is left landing east
    expect(names([runway(34), runway(24), runway(44)])).toEqual(['09C/27C', '09L/27R', '09R/27L']);
    expect(names([runway(0, 10, true), runway(0, 20, true)])).toEqual(['18R/36L', '18L/36R']); // landing south, east is left
  });

  it('take the next number for a second group from four parallels on', () => {
    expect(names([runway(4), runway(14), runway(24), runway(34)])).toEqual(['09L/27R', '09R/27L', '10L/28R', '10R/28L']);
    expect(names([4, 14, 24, 34, 44].map((y) => runway(y)))).toEqual(['09L/27R', '09C/27C', '09R/27L', '10L/28R', '10R/28L']);
  });
});
