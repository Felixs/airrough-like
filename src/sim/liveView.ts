/**
 * Read-only views of a running Day for the Live Day screen (flight strips, Quota bar, Alerts, Stands,
 * Runway chip, Movements per hour). Pure functions of the simulation; the DOM only renders them.
 */
import { AIRCRAFT_TYPES, type AircraftTypeId, type Purpose } from './aircraft';
import type { SizeClass } from './layout';
import { mixSeed, createRandom } from './random';
import { ATC, HOURS, TIMINGS, isDark, type FlightPhase, type ScheduledFlight, type SimEvent, type Simulation } from './simulation';

interface StripBase {
  readonly id: string;
  readonly type: AircraftTypeId;
  readonly size: SizeClass;
  readonly purpose: Purpose;
}
export interface InboundStrip extends StripBase {
  readonly eta: number;
}
export interface HoldingStrip extends StripBase {
  readonly fuelMinutes: number;
  readonly lowFuel: boolean;
  /** Minute it entered Holding. */
  readonly since: number;
}
export interface GroundStrip extends StripBase {
  readonly phase: FlightPhase;
  /** Stand or Holding Bay id. */
  readonly spot: string | null;
}

const GROUND: readonly FlightPhase[] = ['landing', 'taxiIn', 'inBay', 'onStand', 'taxiOut', 'holdShort', 'takeoff'];

export function flightStrips(sim: Simulation): { inbound: InboundStrip[]; holding: HoldingStrip[]; ground: GroundStrip[] } {
  const base = (f: Simulation['flights'][number]): StripBase => ({
    id: f.id, type: f.type, size: AIRCRAFT_TYPES[f.type].size, purpose: AIRCRAFT_TYPES[f.type].purpose,
  });
  return {
    inbound: sim.flights.filter((f) => f.phase === 'scheduled').sort((a, b) => a.arrivalMinute - b.arrivalMinute)
      .map((f) => ({ ...base(f), eta: f.arrivalMinute })),
    holding: sim.flights.filter((f) => f.phase === 'holding').sort((a, b) => a.fuelMinutes - b.fuelMinutes)
      .map((f) => ({ ...base(f), fuelMinutes: f.fuelMinutes, lowFuel: f.fuelMinutes < ATC.lowFuelMinutes, since: f.phaseStart })),
    ground: sim.flights.filter((f) => GROUND.includes(f.phase))
      .map((f) => ({ ...base(f), phase: f.phase, spot: f.standId ?? f.bayId })),
  };
}

export interface QuotaProgress {
  readonly movements: number;
  readonly quota: number;
  readonly stillNeeded: number;
  /** Movements a steady pace would have reached by now (06:00 → 24:00). */
  readonly pace: number;
  readonly met: boolean;
}

export function quotaProgress(sim: Simulation, quota: number): QuotaProgress {
  const share = Math.min(1, Math.max(0, (sim.clock.minute - HOURS.operationsStart) / (HOURS.curfew - HOURS.operationsStart)));
  return {
    movements: sim.movements, quota, stillNeeded: Math.max(0, quota - sim.movements), pace: Math.round(quota * share), met: sim.movements >= quota,
  };
}

export interface Alert {
  readonly minute: number;
  readonly kind: SimEvent['kind'];
  readonly severity: 'info' | 'warn' | 'danger';
  readonly text: string;
}

const ALERT_TEXT: Record<SimEvent['kind'], [Alert['severity'], (id: string) => string]> = {
  lowFuel: ['warn', (id) => `${id} low on fuel`],
  goAround: ['info', (id) => `${id} went around`],
  rejectedTakeoff: ['info', (id) => `${id} rejected takeoff`],
  incident: ['warn', (id) => `Runway Incident: ${id}`],
  taxiIncident: ['warn', (id) => `Taxiway Incident: ${id}`],
  crash: ['danger', (id) => `CRASH: ${id}`],
  diversion: ['warn', (id) => `${id} diverted`],
};

/** Newest first. */
export function alerts(sim: Simulation): Alert[] {
  return [...sim.events].reverse().map((e) => {
    const [severity, text] = ALERT_TEXT[e.kind];
    return { minute: e.minute, kind: e.kind, severity, text: text(e.flightId) + (e.cost ? ` (−$${e.cost.toLocaleString('en-US')})` : '') };
  });
}

export interface SpotStatus {
  readonly id: string;
  readonly kind: 'stand' | 'holdingBay';
  readonly size: SizeClass;
  readonly serves: 'terminal' | 'cargoHub' | 'any';
  readonly state: 'free' | 'reserved' | 'busy';
  readonly flightId: string | null;
  readonly aircraft: AircraftTypeId | null;
}

export function standsStatus(sim: Simulation): SpotStatus[] {
  const status = (id: string, occupant: string | undefined) => {
    const f = occupant ? sim.flights.find((x) => x.id === occupant) : undefined;
    const state: SpotStatus['state'] = !f ? 'free' : f.phase === 'onStand' || f.phase === 'inBay' ? 'busy' : 'reserved';
    return { state, flightId: f?.id ?? null, aircraft: f?.type ?? null, id };
  };
  return [
    ...sim.layout.stands.map((s): SpotStatus => ({ kind: 'stand', size: s.size, serves: s.serves, ...status(s.id, sim.standOccupant[s.id]) })),
    ...sim.layout.holdingBays.map((b): SpotStatus => ({ kind: 'holdingBay', size: b.size, serves: 'any', ...status(b.id, sim.bayOccupant[b.id]) })),
  ];
}

export interface RunwayStatus {
  readonly name: string;
  readonly state: 'open' | 'blocked' | 'dark' | 'curfew' | 'unconnected';
  readonly until: number | null;
  readonly wind: { readonly direction: number; readonly knots: number };
}

/** One status per Runway, in layout order. */
export function runwayStatuses(sim: Simulation): RunwayStatus[] {
  const now = sim.clock.minute;
  const rng = createRandom(mixSeed(sim.seed, 0x3171d));
  const wind = { direction: 240 + Math.round(rng.next() * 6) * 10, knots: 4 + rng.int(12) };
  return sim.layout.runways.map((r, i): RunwayStatus => {
    const name = (r.w >= r.h ? '09-27' : '18-36') + (sim.layout.runways.length > 1 ? ` (R${i + 1})` : '');
    const lit = r.surface === 'lit' || r.surface === 'ils';
    const blockedUntil = sim.runwayBlockedUntil[i] ?? 0;
    if (!sim.network.runways.some((a) => a.index === i)) return { name, state: 'unconnected', until: null, wind };
    if (now < HOURS.operationsStart || now >= HOURS.curfew) return { name, state: 'curfew', until: HOURS.operationsStart, wind };
    if (now < blockedUntil) return { name, state: 'blocked', until: blockedUntil, wind };
    if (isDark(now) && !lit) return { name, state: 'dark', until: null, wind };
    return { name, state: 'open', until: null, wind };
  });
}

export function runwayStatus(sim: Simulation): RunwayStatus {
  return runwayStatuses(sim)[0]!;
}

export interface HourBar {
  readonly hour: number;
  readonly done: number;
  readonly forecast: number;
}

/** Movements per hour from 05:00 to 24:00, done vs expected from the Schedule. */
export function movementsPerHour(sim: Simulation, schedule: readonly ScheduledFlight[]): HourBar[] {
  const forecast = new Array<number>(24).fill(0);
  const add = (minute: number) => {
    if (minute < HOURS.curfew) forecast[Math.floor(minute / 60)]!++;
  };
  for (const f of schedule) {
    const turnaround = TIMINGS.turnaroundMinutes[AIRCRAFT_TYPES[f.type].size];
    if (f.overnight) {
      add(Math.max(HOURS.operationsStart, 5 * 60 + turnaround + 10));
    } else {
      add(f.arrivalMinute);
      add(f.arrivalMinute + turnaround + 15);
    }
  }
  const out: HourBar[] = [];
  for (let hour = 5; hour < 24; hour++) out.push({ hour, done: sim.movementsByHour[hour] ?? 0, forecast: forecast[hour] ?? 0 });
  return out;
}
