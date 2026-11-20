import { describe, expect, it } from 'vitest';
import { createLayout, startingAirport } from './layout';
import { createSimulation, runwaySeparation, stepSimulation, type FlightPhase, type ScheduledFlight, type Simulation } from './simulation';

const base = startingAirport();
/** Starting Airport with a second Medium Holding Bay. */
/** The starting airport with only its Medium Terminal Stand (3), and its Small and Medium Holding Bays. */
const oneStand = createLayout(base.width, base.height, base.structures.filter((s) => !(s.kind === 'stand' && (s.id === '1' || s.id === '2'))));
const runUntil = (sim: Simulation, minute: number) => {
  let s = sim;
  while (s.clock.minute < minute) s = stepSimulation(s);
  return s;
};
const flight = (s: Simulation, id: string) => s.flights.find((f) => f.id === id)!;
/** Every (minute, phase) a flight goes through. */
const history = (start: Simulation, id: string) => {
  const out: Array<{ minute: number; phase: FlightPhase; standId: string | null }> = [];
  let s = start;
  while (s.clock.minute < 24 * 60) {
    s = stepSimulation(s);
    const f = flight(s, id);
    const last = out[out.length - 1];
    if (!last || last.phase !== f.phase || last.standId !== f.standId) out.push({ minute: f.phaseStart, phase: f.phase, standId: f.standId });
  }
  return out;
};
const arrival = (id: string, type: ScheduledFlight['type'], arrivalMinute: number): ScheduledFlight => ({ id, type, arrivalMinute, fuelMinutes: 200 });

describe('Stands and Holding Bays', () => {
  it('a Stand fits aircraft of its Size Class or smaller and of its Purpose', () => {
    const s = runUntil(createSimulation({ layout: base, seed: 1, schedule: [arrival('P', 'C208', 360), arrival('C', 'B738F', 360)] }), 385);
    expect(['1', '2']).toContain(flight(s, 'P').standId); // a Small Terminal Stand
    expect(flight(s, 'C').standId).toBe('C1'); // the only Medium Cargo Stand
  });

  it('sends landed aircraft to a Holding Bay when every fitting Stand is taken', () => {
    const schedule = [arrival('1', 'A320', 360), arrival('X', 'A320', 361)]; // one Medium Terminal Stand
    const h = history(createSimulation({ layout: base, seed: 1, schedule }), 'X');
    expect(h.map((e) => e.phase)).toEqual(['scheduled', 'holding', 'landing', 'taxiIn', 'inBay', 'taxiIn', 'onStand', 'taxiOut', 'holdShort', 'takeoff', 'departed']);
  });

  it('releases aircraft from Holding Bays to Stands strictly in landing order', () => {
    const schedule = [arrival('1', 'A320', 360), arrival('X', 'A320', 361), arrival('Y', 'C208', 361)];
    const s = createSimulation({ layout: oneStand, seed: 1, schedule });
    const leftBay = (id: string) => history(s, id).find((_, i, all) => i > 0 && all[i - 1]!.phase === 'inBay')!.minute;
    const landed = (id: string) => history(s, id).find((e) => e.phase === 'landing')!.minute;
    expect(landed('X')).toBeLessThan(landed('Y'));
    // Y (small) fits the first freed Stand too, but X landed first
    expect(leftBay('X')).toBeLessThan(leftBay('Y'));
    expect(leftBay('X')).toBe(history(s, '1').find((e) => e.phase === 'taxiOut')!.minute);
  });
});

describe('Runway Separation', () => {
  it('shortens linearly with Radar + Controller Training', () => {
    expect(runwaySeparation(1, 1)).toEqual({ landing: 4, takeoff: 3 });
    expect(runwaySeparation(3, 3)).toEqual({ landing: 3, takeoff: 2.25 });
    expect(runwaySeparation(5, 5)).toEqual({ landing: 2, takeoff: 1.5 });
  });

  it('lets an upgraded Tower land more aircraft per Runway', () => {
    const schedule = ['C208', 'C208', 'C208', 'C208', 'C208F', 'C208F', 'Q400'].map((t, i) => arrival(`F${i}`, t as ScheduledFlight['type'], 360));
    const landedBy = (radarLevel: number, controllerTrainingLevel: number, minute: number) =>
      runUntil(createSimulation({ layout: base, seed: 1, schedule, radarLevel, controllerTrainingLevel }), minute).flights.filter((f) => f.phase !== 'holding').length;
    expect(landedBy(1, 1, 372)).toBe(3);
    expect(landedBy(5, 5, 372)).toBe(6);
  });
});
