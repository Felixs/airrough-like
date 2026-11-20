import { describe, expect, it } from 'vitest';
import { landingPath, takeoffPath } from './simulation';
import { departureHolds, rejectExit, type RunwayAccess } from './taxi';
import { STORIES, storyFor } from './stories';

// A Medium Runway (36 tiles, x 0–35) with connectors at its west end, at x 14 and at its east end.
const runway = { kind: 'runway', x: 0, y: 0, w: 36, h: 4, length: 'medium', surface: 'asphalt' } as const;
const connectors = [{ x: 1, y: 5 }, { x: 14, y: 5 }, { x: 34, y: 5 }];
const access: RunwayAccess = { index: 0, runway, vertical: false, connectors, holdPoint: connectors[0]!, runwayExit: connectors[2]! };

describe('Landing and takeoff paths', () => {
  it('a landing descends from the approach to touchdown, then brakes to the exit', () => {
    expect(landingPath(200, 0)).toEqual({ along: -60, altitude: 1 });
    const end = landingPath(200, 1);
    expect(end.along).toBeCloseTo(200);
    expect(end.altitude).toBe(0);
    // altitude only falls, and reaches the ground before half the time is up
    let last = 2;
    for (let s = 0; s <= 1; s += 0.05) {
      const p = landingPath(200, s);
      expect(p.altitude).toBeLessThanOrEqual(last);
      last = p.altitude;
    }
    expect(landingPath(200, 0.5).altitude).toBe(0);
  });

  it('a takeoff stays on the ground until it rotates, then climbs to full height', () => {
    expect(takeoffPath(300, 200, 0)).toEqual({ along: 0, altitude: 0 });
    expect(takeoffPath(300, 200, 0.8).altitude).toBe(0); // 192 units: still rolling
    expect(takeoffPath(300, 200, 0.9).altitude).toBeGreaterThan(0);
    expect(takeoffPath(300, 200, 1)).toEqual({ along: 300, altitude: 1 });
  });
});

describe('Intersection departures', () => {
  it('a Small aircraft may also line up at a connector with its takeoff run of Runway ahead; a Medium one only at the end', () => {
    expect(departureHolds(access, false, 'small')).toEqual([connectors[0], connectors[1]]);
    expect(departureHolds(access, false, 'medium')).toEqual([connectors[0]]);
    // the other way round the full-length hold is the east end, and x 14 has only 14.5 tiles ahead
    expect(departureHolds(access, true, 'small')).toEqual([connectors[2]]);
  });
});

describe('Rejected takeoff exits', () => {
  it('a Small aircraft stops early, a Large one uses nearly all the Runway', () => {
    expect(rejectExit(access, false, 'small', connectors[0]!)).toEqual(connectors[1]);
    expect(rejectExit(access, false, 'medium', connectors[0]!)).toEqual(connectors[2]);
    expect(rejectExit(access, false, 'large', connectors[0]!)).toEqual(connectors[2]);
  });
});

describe('Stories', () => {
  it('are picked from the event alone, so a replay tells the same story', () => {
    const a = storyFor('taxiIncident', null, 42, 'F7', 610);
    expect(STORIES.taxiIncident.pilot).toContain(a);
    expect(storyFor('taxiIncident', null, 42, 'F7', 610)).toBe(a);
    expect(STORIES.goAround.atc).toContain(storyFor('goAround', 'atc', 42, 'F7', 610));
    expect(STORIES.goAround.pilot).toContain(storyFor('goAround', 'pilot', 42, 'F7', 610));
  });
});
