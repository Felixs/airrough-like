/**
 * The Live Day simulation: flights moving through the airport in fixed steps.
 * Pure TypeScript, no rendering or DOM (ADR 0001). Each step returns a new Simulation.
 */
import { AIRCRAFT_TYPES, sizeRank, type AircraftTypeId } from './aircraft';
import { STEP_MINUTES, createDay, isDayOver, type Day } from './clock';
import { TILE_SIZE, type AirportLayout, type Stand } from './layout';
import { buildTaxiNetwork, routeFromStand, routeToStand, type TaxiNetwork, type Tile } from './taxi';

/** Timings *(first guess, from the prototypes)*. */
export const TIMINGS = {
  landingMinutes: 3,
  takeoffMinutes: 2,
  taxiTilesPerMinute: 6,
  turnaroundMinutes: { small: 25, medium: 40, large: 60 },
  remoteStandFactor: 1.5,
  /** Arrival Fee is paid when unloading finishes, this far into the Turnaround. */
  unloadShare: 0.4,
} as const;

export interface ScheduledFlight {
  readonly id: string;
  readonly type: AircraftTypeId;
  readonly arrivalMinute: number;
}

export type FlightPhase = 'scheduled' | 'landing' | 'taxiIn' | 'onStand' | 'taxiOut' | 'holdShort' | 'takeoff' | 'departed';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Flight extends ScheduledFlight {
  readonly phase: FlightPhase;
  /** Minute the current phase started. */
  readonly phaseStart: number;
  readonly standId: string | null;
  readonly route: readonly Tile[];
  /** Tiles travelled along `route`. */
  readonly routeProgress: number;
  readonly unloaded: boolean;
  /** World position (units) and heading in degrees (0 = north, 90 = east); null when not on the airfield. */
  readonly position: Point | null;
  readonly heading: number;
}

export interface Simulation {
  readonly layout: AirportLayout;
  readonly network: TaxiNetwork;
  readonly clock: Day;
  readonly seed: number;
  readonly money: number;
  /** Landings and takeoffs handled today. */
  readonly movements: number;
  readonly runwayBusyUntil: number;
  /** Stand id → flight id currently using (or reserved for) it. */
  readonly standOccupant: Readonly<Record<string, string>>;
  readonly flights: readonly Flight[];
}

export interface SimulationSetup {
  readonly layout: AirportLayout;
  readonly schedule: readonly ScheduledFlight[];
  readonly seed: number;
  readonly money?: number;
}

export function createSimulation(setup: SimulationSetup): Simulation {
  return {
    layout: setup.layout,
    network: buildTaxiNetwork(setup.layout),
    clock: createDay(),
    seed: setup.seed,
    money: setup.money ?? 0,
    movements: 0,
    runwayBusyUntil: 0,
    standOccupant: {},
    flights: setup.schedule.map((f) => ({
      ...f, phase: 'scheduled', phaseStart: 0, standId: null, route: [], routeProgress: 0, unloaded: false, position: null, heading: 90,
    })),
  };
}

// ---------------------------------------------------------------- geometry helpers
const T = TILE_SIZE;
const tileCentre = (t: Tile): Point => ({ x: (t.x + 0.5) * T, y: (t.y + 0.5) * T });
const headingOf = (from: Point, to: Point, fallback: number) =>
  from.x === to.x && from.y === to.y ? fallback : (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;

function alongRoute(route: readonly Tile[], progress: number, fallbackHeading: number): { position: Point; heading: number } {
  const i = Math.min(Math.floor(progress), route.length - 1);
  const a = tileCentre(route[i]!);
  const b = tileCentre(route[Math.min(i + 1, route.length - 1)]!);
  const f = Math.min(1, progress - i);
  return { position: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, heading: headingOf(a, b, fallbackHeading) };
}

function runwayLine(sim: Simulation) {
  const r = sim.network.runway;
  return { y: (r.y + r.h / 2) * T, x0: r.x * T, x1: (r.x + r.w) * T };
}

function turnaroundMinutes(flight: Flight, stand: Stand): number {
  const base = TIMINGS.turnaroundMinutes[AIRCRAFT_TYPES[flight.type].size];
  return stand.placement === 'remote' ? base * TIMINGS.remoteStandFactor : base;
}

function freeFittingStand(sim: Simulation, flight: Flight): Stand | undefined {
  const type = AIRCRAFT_TYPES[flight.type];
  const serves = type.purpose === 'passenger' ? 'terminal' : 'cargoHub';
  return sim.layout.stands
    .filter((s) => s.serves === serves && sizeRank(s.size) >= sizeRank(type.size) && !sim.standOccupant[s.id])
    .sort((a, b) => sizeRank(a.size) - sizeRank(b.size))[0];
}

// ---------------------------------------------------------------- step
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableSim = Omit<Mutable<Simulation>, 'standOccupant'> & { standOccupant: Record<string, string> };

/** Advances the simulation by one fixed step (15 in-game seconds). */
export function stepSimulation(prev: Simulation): Simulation {
  if (isDayOver(prev.clock)) return prev;
  const sim: MutableSim = { ...prev, standOccupant: { ...prev.standOccupant }, flights: [] };
  const now = prev.clock.minute;
  const flights = prev.flights.map((f) => stepFlight(sim, { ...f }, now));
  sim.flights = flights;
  sim.clock = { ...prev.clock, minute: now + STEP_MINUTES };
  return sim;
}

function stepFlight(sim: MutableSim, f: Mutable<Flight>, now: number): Flight {
  const stand = f.standId ? sim.layout.stands.find((s) => s.id === f.standId) : undefined;
  const enter = (phase: FlightPhase) => {
    f.phase = phase;
    f.phaseStart = now;
  };
  switch (f.phase) {
    case 'scheduled': {
      if (now < f.arrivalMinute || sim.runwayBusyUntil > now) break;
      const target = freeFittingStand(sim, f);
      if (!target) break;
      sim.standOccupant[target.id] = f.id;
      f.standId = target.id;
      sim.runwayBusyUntil = now + TIMINGS.landingMinutes;
      enter('landing');
      break;
    }
    case 'landing': {
      if (now < f.phaseStart + TIMINGS.landingMinutes) break;
      sim.movements += 1;
      f.route = routeToStand(sim.network, sim.network.runwayExit, stand!);
      f.routeProgress = 0;
      enter('taxiIn');
      break;
    }
    case 'taxiIn':
    case 'taxiOut': {
      f.routeProgress = Math.min(f.route.length - 1, f.routeProgress + TIMINGS.taxiTilesPerMinute * STEP_MINUTES);
      if (f.routeProgress < f.route.length - 1) break;
      if (f.phase === 'taxiIn') enter('onStand');
      else enter('holdShort');
      break;
    }
    case 'onStand': {
      const turnaround = turnaroundMinutes(f, stand!);
      if (!f.unloaded && now >= f.phaseStart + turnaround * TIMINGS.unloadShare) {
        f.unloaded = true;
        sim.money += AIRCRAFT_TYPES[f.type].fee;
      }
      if (now < f.phaseStart + turnaround) break;
      f.route = routeFromStand(sim.network, stand!, sim.network.holdPoint);
      f.routeProgress = 0;
      delete sim.standOccupant[stand!.id];
      f.standId = null;
      enter('taxiOut');
      break;
    }
    case 'holdShort': {
      if (sim.runwayBusyUntil > now) break;
      sim.runwayBusyUntil = now + TIMINGS.takeoffMinutes;
      enter('takeoff');
      break;
    }
    case 'takeoff': {
      if (now < f.phaseStart + TIMINGS.takeoffMinutes) break;
      sim.money += AIRCRAFT_TYPES[f.type].fee;
      sim.movements += 1;
      enter('departed');
      break;
    }
    case 'departed':
      break;
  }
  place(sim, f, now + STEP_MINUTES);
  return f;
}

/** Sets the flight's world position for rendering, as of minute `t`. */
function place(sim: Simulation, f: Mutable<Flight>, t: number): void {
  const line = runwayLine(sim);
  const share = (minutes: number) => Math.min(1, (t - f.phaseStart) / minutes);
  switch (f.phase) {
    case 'landing': {
      const exitX = tileCentre(sim.network.runwayExit).x;
      f.position = { x: line.x0 + (exitX - line.x0) * share(TIMINGS.landingMinutes), y: line.y };
      f.heading = 90;
      break;
    }
    case 'taxiIn':
    case 'taxiOut': {
      const at = alongRoute(f.route, f.routeProgress, f.heading);
      f.position = at.position;
      f.heading = at.heading;
      break;
    }
    case 'onStand': {
      const stand = sim.layout.stands.find((s) => s.id === f.standId)!;
      f.position = { x: (stand.x + stand.w / 2) * T, y: (stand.y + stand.h / 2) * T };
      f.heading = 0;
      break;
    }
    case 'holdShort':
      f.position = tileCentre(sim.network.holdPoint);
      f.heading = 180;
      break;
    case 'takeoff': {
      const holdX = tileCentre(sim.network.holdPoint).x;
      f.position = { x: holdX + (line.x1 + 40 - holdX) * share(TIMINGS.takeoffMinutes), y: line.y };
      f.heading = 90;
      break;
    }
    default:
      f.position = null;
  }
}

/** Runs as many steps as `newClock` is ahead of the simulation's clock (see clock.advance). */
export function runTo(sim: Simulation, newClock: Day): Simulation {
  let s = sim;
  while (s.clock.minute + 1e-9 < newClock.minute && !isDayOver(s.clock)) s = stepSimulation(s);
  return { ...s, clock: { ...s.clock, pendingRealMs: newClock.pendingRealMs } };
}
