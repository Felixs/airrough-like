/**
 * Read-only views of a running Day for the Live Day screen (flight strips, Quota bar, Alerts, Stands,
 * Runway chip, Movements per hour). Pure functions of the simulation; the DOM only renders them.
 */
import { AIRCRAFT_TYPES, type AircraftTypeId, type Purpose } from './aircraft';
import { runwayNames, type SizeClass } from './layout';
import { ATC, HOURS, TIMINGS, isDark, windAt, type FlightPhase, type ScheduledFlight, type SimEvent, type Simulation } from './simulation';

interface StripBase {
  readonly id: string;
  /** ATC callsign, e.g. "LH 347". */
  readonly callsign: string;
  /** Spoken form, e.g. "Lufthansa 347". */
  readonly spoken: string;
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
  /** Stopped in line in front of a Taxiway closed by an Incident. */
  readonly waiting: boolean;
  /** Stand or Holding Bay id. */
  readonly spot: string | null;
}

const GROUND: readonly FlightPhase[] = ['landing', 'taxiIn', 'inBay', 'onStand', 'taxiOut', 'holdShort', 'takeoff'];

export function flightStrips(sim: Simulation): { inbound: InboundStrip[]; holding: HoldingStrip[]; ground: GroundStrip[] } {
  const base = (f: Simulation['flights'][number]): StripBase => ({
    id: f.id, callsign: f.callsign ?? f.id, spoken: f.spoken ?? f.callsign ?? f.id,
    type: f.type, size: AIRCRAFT_TYPES[f.type].size, purpose: AIRCRAFT_TYPES[f.type].purpose,
  });
  return {
    inbound: sim.flights.filter((f) => f.phase === 'scheduled').sort((a, b) => a.arrivalMinute - b.arrivalMinute)
      .map((f) => ({ ...base(f), eta: f.arrivalMinute })),
    holding: sim.flights.filter((f) => f.phase === 'holding').sort((a, b) => a.fuelMinutes - b.fuelMinutes)
      .map((f) => ({ ...base(f), fuelMinutes: f.fuelMinutes, lowFuel: f.fuelMinutes < ATC.lowFuelMinutes, since: f.phaseStart })),
    ground: sim.flights.filter((f) => GROUND.includes(f.phase))
      .map((f) => ({ ...base(f), phase: f.phase, waiting: f.waitingSince !== undefined, spot: f.standId ?? f.bayId })),
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
  /** The aircraft it is about (none for a Runway change). */
  readonly flightId: string | null;
}

const ALERT_TEXT: Record<SimEvent['kind'], [Alert['severity'], (id: string) => string]> = {
  lowFuel: ['warn', (id) => `${id} low on fuel`],
  mayday: ['danger', (id) => `MAYDAY: ${id} lands next, all Runways held`],
  goAround: ['info', (id) => `${id} went around`],
  rejectedTakeoff: ['info', (id) => `${id} rejected takeoff`],
  incident: ['warn', (id) => `Runway Incident: ${id}`],
  taxiIncident: ['warn', (id) => `Taxiway Incident: ${id}`],
  crash: ['danger', (id) => `CRASH: ${id}`],
  diversion: ['warn', (id) => `${id} diverted`],
  runwayChange: ['info', (id) => `Wind change: ${id} now in use`],
};

/** Newest first. */
/** The callsign of a flight in the simulation (or its id). */
export function callsignOf(sim: Simulation, flightId: string): string {
  return sim.flights.find((f) => f.id === flightId)?.callsign ?? flightId;
}

/** One line describing an event, e.g. "CRASH: LH 347 (−$10,000)". */
export function describeEvent(sim: Simulation, e: SimEvent): string {
  const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
  const closed = e.blockedUntil === undefined ? '' : ` · ${e.kind === 'taxiIncident' ? 'Taxiway' : 'Runway'} closed until ${hhmm(e.blockedUntil)}`;
  return ALERT_TEXT[e.kind][1](callsignOf(sim, e.flightId)) + (e.story ? `: ${e.story}` : '') + closed;
}

export function alerts(sim: Simulation): Alert[] {
  return [...sim.events].reverse().map((e) => ({
    minute: e.minute, kind: e.kind, severity: ALERT_TEXT[e.kind][0], text: describeEvent(sim, e),
    flightId: e.kind !== 'runwayChange' && sim.flights.some((f) => f.id === e.flightId) ? e.flightId : null,
  }));
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
  readonly state: 'open' | 'blocked' | 'dark' | 'curfew' | 'unconnected' | 'ilsOnly' | 'changeover';
  readonly until: number | null;
  readonly wind: { readonly direction: number; readonly knots: number };
}

/** One status per Runway, in layout order. */
export function runwayStatuses(sim: Simulation): RunwayStatus[] {
  const now = sim.clock.minute;
  const wind = windAt(sim, now);
  return sim.layout.runways.map((r, i): RunwayStatus => {
    const ends = runwayNames(sim.layout)[i]!;
    const name = sim.runwayReverse[i] ? ends.reverse : ends.forward;
    const lit = !sim.noLights && (r.surface === 'lit' || r.surface === 'ils');
    const active = sim.windows.filter((w) => (w.runway === undefined || w.runway === i) && now >= w.from && now < w.to);
    const closedTo = Math.max(0, ...active.filter((w) => w.kind === 'closed').map((w) => w.to));
    const blockedUntil = Math.max(sim.runwayBlockedUntil[i] ?? 0, closedTo);
    const ilsOnly = active.some((w) => w.kind === 'ilsOnly') && (sim.noLights || r.surface !== 'ils');
    if (!sim.network.runways.some((a) => a.index === i)) return { name, state: 'unconnected', until: null, wind };
    if (now < HOURS.operationsStart || now >= HOURS.curfew) return { name, state: 'curfew', until: HOURS.operationsStart, wind };
    if (now < blockedUntil) return { name, state: 'blocked', until: blockedUntil, wind };
    if (now < (sim.changeoverUntil[i] ?? 0)) return { name, state: 'changeover', until: sim.changeoverUntil[i]!, wind };
    if (isDark(now) && !lit) return { name, state: 'dark', until: null, wind };
    if (ilsOnly) return { name, state: 'ilsOnly', until: null, wind };
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
