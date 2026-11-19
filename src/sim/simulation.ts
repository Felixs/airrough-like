/**
 * The Live Day simulation: flights moving through the airport in fixed steps.
 * Pure TypeScript, no rendering or DOM (ADR 0001). Each step returns a new Simulation.
 */
import { AIRCRAFT_TYPES, sizeRank, type AircraftTypeId } from './aircraft';
import { STEP_MINUTES, createDay, isDayOver, type Day } from './clock';
import { TILE_SIZE, type AirportLayout, type HoldingBay, type Stand } from './layout';
import { buildTaxiNetwork, routeBetween, routeFromStand, routeToStand, type TaxiNetwork, type Tile } from './taxi';

/** Timings *(first guess, from the prototypes)*. */
export const TIMINGS = {
  taxiTilesPerMinute: 6,
  turnaroundMinutes: { small: 25, medium: 40, large: 60 },
  remoteStandFactor: 1.5,
  /** Arrival Fee is paid when unloading finishes, this far into the Turnaround. */
  unloadShare: 0.4,
} as const;

/** ATC rules *(first guess, from the prototypes)*. */
export const ATC = {
  fuelReserveMinutes: { small: 40, medium: 45, large: 55 },
  /** Below this an aircraft is low-fuel and gets landing priority. */
  lowFuelMinutes: 10,
  /** A departure that has held short this long goes before normal arrivals. */
  departureMaxWaitMinutes: 3,
  radarBase: 2,
  radarPerLevel: 2,
  /** Runway Separation at the lowest and highest Tower levels. */
  separation: { landing: [4, 2], takeoff: [3, 1.5] },
  maxModuleLevel: 5,
} as const;

/**
 * Runway Separation in minutes: how long a landing or takeoff occupies the Runway.
 * Linear in (Radar + Controller Training − 2), from Level 1 + 1 to Level 5 + 5.
 */
export function runwaySeparation(radarLevel: number, controllerTrainingLevel: number): { landing: number; takeoff: number } {
  const span = 2 * (ATC.maxModuleLevel - 1);
  const t = Math.min(1, Math.max(0, (radarLevel + controllerTrainingLevel - 2) / span));
  const lerp = ([a, b]: readonly [number, number]) => a + (b - a) * t;
  return { landing: lerp(ATC.separation.landing), takeoff: lerp(ATC.separation.takeoff) };
}

export interface ScheduledFlight {
  readonly id: string;
  readonly type: AircraftTypeId;
  readonly arrivalMinute: number;
  /** Parked overnight: starts the Day on a Stand with unloading done. */
  readonly overnight?: boolean;
  /** Fuel Reserve on arrival in minutes; defaults by Size Class. */
  readonly fuelMinutes?: number;
}

export type FlightPhase = 'scheduled' | 'holding' | 'landing' | 'taxiIn' | 'inBay' | 'onStand' | 'taxiOut' | 'holdShort' | 'takeoff' | 'departed' | 'crashed';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Flight extends ScheduledFlight {
  readonly phase: FlightPhase;
  /** Minute the current phase started. */
  readonly phaseStart: number;
  readonly standId: string | null;
  /** Holding Bay reserved or used while waiting for a Stand. */
  readonly bayId: string | null;
  /** Position in landing order (1 = first to land today); 0 before landing. */
  readonly landedSeq: number;
  readonly route: readonly Tile[];
  /** Tiles travelled along `route`. */
  readonly routeProgress: number;
  readonly unloaded: boolean;
  /** Fuel Reserve left; counts down while Holding. */
  readonly fuelMinutes: number;
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
  readonly crashes: number;
  readonly landings: number;
  readonly radarLevel: number;
  readonly controllerTrainingLevel: number;
  readonly runwayBusyUntil: number;
  /** Stand id → flight id currently using (or reserved for) it. */
  readonly standOccupant: Readonly<Record<string, string>>;
  /** Holding Bay id → flight id using (or reserved for) it. */
  readonly bayOccupant: Readonly<Record<string, string>>;
  readonly flights: readonly Flight[];
}

export interface SimulationSetup {
  readonly layout: AirportLayout;
  readonly schedule: readonly ScheduledFlight[];
  readonly seed: number;
  readonly money?: number;
  /** Radar Tower Module level, 1–5. */
  readonly radarLevel?: number;
  /** Controller Training Tower Module level, 1–5. */
  readonly controllerTrainingLevel?: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableSim = Omit<Mutable<Simulation>, 'standOccupant' | 'bayOccupant'> & {
  standOccupant: Record<string, string>;
  bayOccupant: Record<string, string>;
};

export function createSimulation(setup: SimulationSetup): Simulation {
  const sim: MutableSim = {
    layout: setup.layout,
    network: buildTaxiNetwork(setup.layout),
    clock: createDay(),
    seed: setup.seed,
    money: setup.money ?? 0,
    movements: 0,
    crashes: 0,
    landings: 0,
    radarLevel: setup.radarLevel ?? 1,
    controllerTrainingLevel: setup.controllerTrainingLevel ?? 1,
    runwayBusyUntil: 0,
    standOccupant: {},
    bayOccupant: {},
    flights: [],
  };
  sim.flights = setup.schedule.map((f) => {
    const flight: Mutable<Flight> = {
      ...f, phase: 'scheduled', phaseStart: 0, standId: null, bayId: null, landedSeq: 0, route: [], routeProgress: 0, unloaded: false, position: null, heading: 90,
      fuelMinutes: f.fuelMinutes ?? ATC.fuelReserveMinutes[AIRCRAFT_TYPES[f.type].size],
    };
    const stand = f.overnight ? freeFittingStand(sim, flight) : undefined;
    if (stand) {
      sim.standOccupant[stand.id] = f.id;
      Object.assign(flight, { phase: 'onStand', phaseStart: sim.clock.minute, standId: stand.id, unloaded: true });
      place(sim, flight, sim.clock.minute);
    }
    return flight;
  });
  return sim;
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

/** A Stand fits aircraft of its Size Class or smaller and of its Purpose; the smallest fitting free Stand is used. */
function freeFittingStand(sim: Simulation, flight: Flight, blocked?: ReadonlySet<string>): Stand | undefined {
  const type = AIRCRAFT_TYPES[flight.type];
  const serves = type.purpose === 'passenger' ? 'terminal' : 'cargoHub';
  return sim.layout.stands
    .filter((s) => s.serves === serves && sizeRank(s.size) >= sizeRank(type.size) && !sim.standOccupant[s.id] && !blocked?.has(s.id))
    .sort((a, b) => sizeRank(a.size) - sizeRank(b.size))[0];
}

function freeFittingBay(sim: Simulation, flight: Flight): HoldingBay | undefined {
  const size = sizeRank(AIRCRAFT_TYPES[flight.type].size);
  return sim.layout.holdingBays
    .filter((b) => sizeRank(b.size) >= size && !sim.bayOccupant[b.id])
    .sort((a, b) => sizeRank(a.size) - sizeRank(b.size))[0];
}

const standById = (sim: Simulation, id: string | null) => (id ? sim.layout.stands.find((s) => s.id === id) : undefined);
const bayById = (sim: Simulation, id: string | null) => (id ? sim.layout.holdingBays.find((b) => b.id === id) : undefined);

// ---------------------------------------------------------------- step

/** Advances the simulation by one fixed step (15 in-game seconds). */
export function stepSimulation(prev: Simulation): Simulation {
  if (isDayOver(prev.clock)) return prev;
  const sim: MutableSim = { ...prev, standOccupant: { ...prev.standOccupant }, bayOccupant: { ...prev.bayOccupant }, flights: [] };
  const now = prev.clock.minute;
  const flights = prev.flights.map((f) => stepFlight(sim, { ...f }, now));
  const blocked = releaseBays(sim, flights, now);
  assignRunway(sim, flights, now, blocked);
  for (const f of flights) place(sim, f, now + STEP_MINUTES);
  sim.flights = flights;
  sim.clock = { ...prev.clock, minute: now + STEP_MINUTES };
  return sim;
}

const isLowFuel = (f: Flight) => f.fuelMinutes < ATC.lowFuelMinutes;

/**
 * Landed aircraft waiting for a Stand (in or on their way to a Holding Bay) get freed Stands strictly in landing order.
 * Returns free Stands held back for a waiting aircraft that is still taxiing to its Bay.
 */
function releaseBays(sim: MutableSim, flights: Mutable<Flight>[], now: number): Set<string> {
  const blocked = new Set<string>();
  const waiting = flights.filter((f) => f.bayId && !f.standId).sort((a, b) => a.landedSeq - b.landedSeq);
  for (const f of waiting) {
    const stand = freeFittingStand(sim, f, blocked);
    if (!stand) continue;
    if (f.phase !== 'inBay') {
      blocked.add(stand.id);
      continue;
    }
    const bay = bayById(sim, f.bayId)!;
    sim.standOccupant[stand.id] = f.id;
    delete sim.bayOccupant[bay.id];
    f.standId = stand.id;
    f.bayId = null;
    f.route = routeBetween(sim.network, bay, stand);
    f.routeProgress = 0;
    f.phase = 'taxiIn';
    f.phaseStart = now;
  }
  return blocked;
}

export function separationOf(sim: Simulation) {
  return runwaySeparation(sim.radarLevel, sim.controllerTrainingLevel);
}

/** The ATC Tower gives the Runway to one aircraft at a time. */
function assignRunway(sim: MutableSim, flights: Mutable<Flight>[], now: number, blocked: ReadonlySet<string>): void {
  if (sim.runwayBusyUntil > now) return;
  const holding = flights
    .filter((f) => f.phase === 'holding')
    .sort((a, b) => Number(isLowFuel(b)) - Number(isLowFuel(a)) || (isLowFuel(a) ? a.fuelMinutes - b.fuelMinutes : 0) || a.phaseStart - b.phaseStart);
  const departures = flights.filter((f) => f.phase === 'holdShort' && f.phaseStart < now).sort((a, b) => a.phaseStart - b.phaseStart);
  const departure = departures[0];
  const landable = holding.find((f) => freeFittingStand(sim, f, blocked) ?? freeFittingBay(sim, f));
  const urgent = landable && isLowFuel(landable) ? landable : undefined;
  const departureDue = departure && now - departure.phaseStart >= ATC.departureMaxWaitMinutes;

  const next = urgent ?? (departureDue ? departure : (landable ?? departure));
  if (!next) return;
  const separation = separationOf(sim);
  if (next.phase === 'holding') {
    const stand = freeFittingStand(sim, next, blocked);
    if (stand) {
      sim.standOccupant[stand.id] = next.id;
      next.standId = stand.id;
    } else {
      const bay = freeFittingBay(sim, next)!;
      sim.bayOccupant[bay.id] = next.id;
      next.bayId = bay.id;
    }
    sim.landings += 1;
    next.landedSeq = sim.landings;
    next.phase = 'landing';
    sim.runwayBusyUntil = now + separation.landing;
  } else {
    next.phase = 'takeoff';
    sim.runwayBusyUntil = now + separation.takeoff;
  }
  next.phaseStart = now;
}

/** Aircraft in the air near the airport against what the Radar can track. */
export function radarLoad(sim: Simulation): { airborne: number; capacity: number; over: number } {
  const airborne = sim.flights.filter((f) => f.phase === 'holding' || f.phase === 'landing' || f.phase === 'takeoff').length;
  const capacity = ATC.radarBase + ATC.radarPerLevel * sim.radarLevel;
  return { airborne, capacity, over: Math.max(0, airborne - capacity) };
}

function stepFlight(sim: MutableSim, f: Mutable<Flight>, now: number): Mutable<Flight> {
  const stand = standById(sim, f.standId);
  const enter = (phase: FlightPhase) => {
    f.phase = phase;
    f.phaseStart = now;
  };
  switch (f.phase) {
    case 'scheduled':
      if (now < f.arrivalMinute) break;
      enter('holding');
      f.fuelMinutes = Math.max(0, f.fuelMinutes - STEP_MINUTES);
      break;
    case 'holding':
      if (f.fuelMinutes <= 0) {
        sim.crashes += 1;
        enter('crashed');
        break;
      }
      f.fuelMinutes = Math.max(0, f.fuelMinutes - STEP_MINUTES);
      break;
    case 'landing': {
      if (now < f.phaseStart + separationOf(sim).landing) break;
      sim.movements += 1;
      f.route = routeToStand(sim.network, sim.network.runwayExit, stand ?? bayById(sim, f.bayId)!);
      f.routeProgress = 0;
      enter('taxiIn');
      break;
    }
    case 'taxiIn':
    case 'taxiOut': {
      f.routeProgress = Math.min(f.route.length - 1, f.routeProgress + TIMINGS.taxiTilesPerMinute * STEP_MINUTES);
      if (f.routeProgress < f.route.length - 1) break;
      if (f.phase === 'taxiOut') enter('holdShort');
      else enter(f.standId ? 'onStand' : 'inBay');
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
    case 'holdShort':
    case 'inBay':
      break;
    case 'takeoff': {
      if (now < f.phaseStart + separationOf(sim).takeoff) break;
      sim.money += AIRCRAFT_TYPES[f.type].fee;
      sim.movements += 1;
      enter('departed');
      break;
    }
    case 'departed':
    case 'crashed':
      break;
  }
  return f;
}

/** Sets the flight's world position for rendering, as of minute `t`. */
function place(sim: Simulation, f: Mutable<Flight>, t: number): void {
  const line = runwayLine(sim);
  const share = (minutes: number) => Math.min(1, (t - f.phaseStart) / minutes);
  switch (f.phase) {
    case 'landing': {
      const exitX = tileCentre(sim.network.runwayExit).x;
      f.position = { x: line.x0 + (exitX - line.x0) * share(separationOf(sim).landing), y: line.y };
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
    case 'inBay':
    case 'onStand': {
      const stand = (standById(sim, f.standId) ?? bayById(sim, f.bayId))!;
      f.position = { x: (stand.x + stand.w / 2) * T, y: (stand.y + stand.h / 2) * T };
      f.heading = 0;
      break;
    }
    case 'holding': {
      // Placeholder Holding pattern: a circle over the field's south-west corner, aircraft spread around it.
      const r = 2.5 * T;
      const a = ((t - f.phaseStart) / 4) * 2 * Math.PI + (Number.parseInt(f.id.replace(/\D/g, ''), 10) || 0);
      f.position = { x: 3 * T + Math.cos(a) * r, y: 12 * T + Math.sin(a) * r };
      f.heading = ((a * 180) / Math.PI + 180) % 360;
      break;
    }
    case 'holdShort':
      f.position = tileCentre(sim.network.holdPoint);
      f.heading = 180;
      break;
    case 'takeoff': {
      const holdX = tileCentre(sim.network.holdPoint).x;
      f.position = { x: holdX + (line.x1 + 40 - holdX) * share(separationOf(sim).takeoff), y: line.y };
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
