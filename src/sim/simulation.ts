/**
 * The Live Day simulation: flights moving through the airport in fixed steps.
 * Pure TypeScript, no rendering or DOM (ADR 0001). Each step returns a new Simulation.
 */
import { AIRCRAFT_TYPES, sizeRank, type AircraftTypeId } from './aircraft';
import { DAY_END_MINUTE, STEP_MINUTES, createDay, isDayOver, type Day } from './clock';
import { TILE_SIZE, type AirportLayout, type HoldingBay, type RunwayLength, type SizeClass, type Stand } from './layout';
import { createRandom, mixSeed, type Random } from './random';
import { buildTaxiNetwork, routeBetween, routeFromStand, routeToStand, type TaxiNetwork, type Tile } from './taxi';

/** Timings *(first guess, from the prototypes)*. */
export const TIMINGS = {
  taxiTilesPerMinute: 6,
  turnaroundMinutes: { small: 25, medium: 40, large: 60 },
  remoteStandFactor: 1.5,
  /** Arrival Fee is paid when unloading finishes, this far into the Turnaround. */
  unloadShare: 0.4,
} as const;

/** The Day's operating hours (minutes after midnight). */
export const HOURS = {
  /** No Movements before this (Curfew ends). */
  operationsStart: 6 * 60,
  /** From now on only Lit or ILS Runways can be used. */
  dusk: 20 * 60,
  /** No new arrivals enter Holding after this. */
  holdingCloses: 22 * 60,
  /** Anything still airborne is Diverted (Curfew). */
  curfew: DAY_END_MINUTE,
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
  /** A Holding aircraft this low on fuel is Diverted if no Runway that fits it is usable. */
  minimumFuelMinutes: 5,
} as const;

/** Errors and safety *(first guess, from the prototypes)*. */
export const SAFETY = {
  atcErrorChance: 0.025,
  /** ATC Error chance drops this share per Controller Training level above 1. */
  trainingReduction: 0.15,
  /** ATC Error chance rises this share per aircraft over Radar capacity. */
  overRadarIncrease: 0.4,
  pilotErrorChance: 0.015,
  surfacePilotFactor: { grass: 1.3, asphalt: 1, lit: 1, ils: 0.6 },
  landingOutcomes: { goAround: 0.8, incident: 0.19 },
  takeoffOutcomes: { rejectedTakeoff: 0.85, incident: 0.14 },
  crashFine: { small: 5_000, medium: 10_000, large: 20_000 },
  crashFineIncreasePerCrash: 0.5,
  crashFineCap: 3,
  incidentCost: { small: 1_000, medium: 2_000, large: 4_000 },
  crashBlockMinutes: 60,
  incidentBlockMinutes: 20,
  /** Blockage multiplier by Fire & Rescue Station level 0–5. */
  fireRescueFactor: [1, 0.75, 0.55, 0.4, 0.3, 0.2],
  /** Taxiway Incident chance per step for each extra aircraft taxiing at the same time. */
  taxiIncidentPerAircraft: 0.0005,
  /** Ground Radar lowers Taxiway Incidents by this share per level above 1. */
  groundRadarReduction: 0.15,
} as const;

const RUNWAY_FITS: Record<RunwayLength, number> = { short: 1, medium: 2, long: 3 };

export type LandingOutcome = 'goAround' | 'incident' | 'crash';
export type TakeoffOutcome = 'rejectedTakeoff' | 'incident' | 'crash';

/** What an error at landing becomes, for a uniform roll in [0, 1). */
export function landingOutcome(roll: number): LandingOutcome {
  const o = SAFETY.landingOutcomes;
  return roll < o.goAround ? 'goAround' : roll < o.goAround + o.incident - 1e-12 ? 'incident' : 'crash';
}

/** What an error at takeoff becomes, for a uniform roll in [0, 1). */
export function takeoffOutcome(roll: number): TakeoffOutcome {
  const o = SAFETY.takeoffOutcomes;
  return roll < o.rejectedTakeoff ? 'rejectedTakeoff' : roll < o.rejectedTakeoff + o.incident - 1e-12 ? 'incident' : 'crash';
}

/** Crash Fine for a Crash after `earlierCrashesThisWeek` others in the same Week. */
export function crashFine(size: SizeClass, earlierCrashesThisWeek: number): number {
  const factor = Math.min(SAFETY.crashFineCap, 1 + SAFETY.crashFineIncreasePerCrash * earlierCrashesThisWeek);
  return SAFETY.crashFine[size] * factor;
}

/** Chance per step of a Taxiway Incident with `taxiing` aircraft on the Taxiways. */
export function taxiIncidentChance(taxiing: number, groundRadarLevel: number): number {
  const reduction = Math.max(0, 1 - SAFETY.groundRadarReduction * (groundRadarLevel - 1));
  return Math.max(0, taxiing - 1) * SAFETY.taxiIncidentPerAircraft * reduction;
}

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
  /** Overnight aircraft only: whether yesterday's unloading finished (default true). */
  readonly arrivalFeePaid?: boolean;
}

export type FlightPhase = 'scheduled' | 'holding' | 'landing' | 'taxiIn' | 'inBay' | 'onStand' | 'taxiOut' | 'holdShort' | 'takeoff' | 'departed' | 'crashed' | 'diverted';

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
  /** Error result rolled when the current landing or takeoff started. */
  readonly pendingOutcome: LandingOutcome | TakeoffOutcome | null;
  /** Stopped on the Taxiway by an Incident until this minute. */
  readonly stoppedUntil: number;
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
  /** Arrival and Departure Fees earned today. */
  readonly fees: number;
  /** Crashes today. */
  readonly crashes: number;
  /** Crashes earlier this Week (for Crash Fines). */
  readonly earlierCrashesThisWeek: number;
  readonly diversions: number;
  readonly landings: number;
  readonly groundRadarLevel: number;
  readonly fireRescueLevel: number;
  /** Multiplies error chances (Twists, tests). */
  readonly riskMultiplier: number;
  /** The Runway can't be used before this minute (Crash, Incident, Twist). */
  readonly runwayBlockedUntil: number;
  /** Everything notable that happened today, oldest first. */
  readonly events: readonly SimEvent[];
  readonly radarLevel: number;
  readonly controllerTrainingLevel: number;
  readonly runwayBusyUntil: number;
  /** Stand id → flight id currently using (or reserved for) it. */
  readonly standOccupant: Readonly<Record<string, string>>;
  /** Holding Bay id → flight id using (or reserved for) it. */
  readonly bayOccupant: Readonly<Record<string, string>>;
  readonly flights: readonly Flight[];
}

export interface SimEvent {
  readonly minute: number;
  readonly kind: 'goAround' | 'rejectedTakeoff' | 'incident' | 'taxiIncident' | 'crash' | 'diversion';
  readonly flightId: string;
  /** Money paid (Crash Fine, Incident cost). */
  readonly cost: number;
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
  /** Ground Radar Tower Module level, 1–5. */
  readonly groundRadarLevel?: number;
  /** Fire & Rescue Station level, 0 (none) to 5. */
  readonly fireRescueLevel?: number;
  readonly earlierCrashesThisWeek?: number;
  readonly riskMultiplier?: number;
  readonly runwayBlockedUntil?: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableSim = Omit<Mutable<Simulation>, 'standOccupant' | 'bayOccupant' | 'events'> & {
  standOccupant: Record<string, string>;
  bayOccupant: Record<string, string>;
  events: SimEvent[];
};

export function createSimulation(setup: SimulationSetup): Simulation {
  const sim: MutableSim = {
    layout: setup.layout,
    network: buildTaxiNetwork(setup.layout),
    clock: createDay(),
    seed: setup.seed,
    money: setup.money ?? 0,
    movements: 0,
    fees: 0,
    crashes: 0,
    earlierCrashesThisWeek: setup.earlierCrashesThisWeek ?? 0,
    diversions: 0,
    landings: 0,
    groundRadarLevel: setup.groundRadarLevel ?? 1,
    fireRescueLevel: setup.fireRescueLevel ?? 0,
    riskMultiplier: setup.riskMultiplier ?? 1,
    runwayBlockedUntil: setup.runwayBlockedUntil ?? 0,
    events: [],
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
      pendingOutcome: null,
      stoppedUntil: 0,
    };
    const stand = f.overnight ? freeFittingStand(sim, flight) : undefined;
    if (stand) {
      sim.standOccupant[stand.id] = f.id;
      Object.assign(flight, { phase: 'onStand', phaseStart: sim.clock.minute, standId: stand.id, unloaded: f.arrivalFeePaid ?? true });
      place(sim, flight, sim.clock.minute);
    } else if (f.overnight) {
      // No Stand for it (e.g. one was demolished): it arrives when operations start instead.
      flight.arrivalMinute = HOURS.operationsStart;
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
  const sim: MutableSim = {
    ...prev, standOccupant: { ...prev.standOccupant }, bayOccupant: { ...prev.bayOccupant }, events: [...prev.events], flights: [],
  };
  const now = prev.clock.minute;
  const rng = createRandom(mixSeed(prev.seed, Math.round(now / STEP_MINUTES)));
  const flights = prev.flights.map((f) => stepFlight(sim, { ...f }, now));
  rollTaxiIncident(sim, flights, now, rng);
  const blocked = releaseBays(sim, flights, now);
  assignRunway(sim, flights, now, blocked, rng);
  if (now + STEP_MINUTES >= HOURS.curfew) for (const f of flights) if (f.phase === 'holding' || f.phase === 'scheduled') divert(sim, f, now);
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

/** Current error chances at a risky moment on the Runway; shown as the Risk Meter. */
export function riskMeter(sim: Simulation): { atc: number; pilot: number; total: number } {
  const training = Math.max(0, 1 - SAFETY.trainingReduction * (sim.controllerTrainingLevel - 1));
  const radar = 1 + SAFETY.overRadarIncrease * radarLoad(sim).over;
  const surface = sim.network.runway.surface;
  const atc = Math.min(1, SAFETY.atcErrorChance * training * radar * sim.riskMultiplier);
  const pilot = Math.min(1, SAFETY.pilotErrorChance * SAFETY.surfacePilotFactor[surface] * sim.riskMultiplier);
  return { atc, pilot, total: 1 - (1 - atc) * (1 - pilot) };
}

const blockMinutes = (sim: Simulation, base: number) => base * (SAFETY.fireRescueFactor[sim.fireRescueLevel] ?? 1);
const isDark = (now: number) => now >= HOURS.dusk;
const nightCapable = (sim: Simulation) => sim.network.runway.surface === 'lit' || sim.network.runway.surface === 'ils';
/** Whether the Runway can take any Movement right now (open, operating hours, light). */
const runwayUsable = (sim: Simulation, now: number) =>
  now >= sim.runwayBlockedUntil && now >= HOURS.operationsStart && (!isDark(now) || nightCapable(sim));
/** Whether the Runway is long enough and of a surface that takes this aircraft (Grass: Small only). */
const runwayFits = (sim: Simulation, f: Flight) => {
  const size = sizeRank(AIRCRAFT_TYPES[f.type].size);
  return RUNWAY_FITS[sim.network.runway.length] >= size && (sim.network.runway.surface !== 'grass' || size === 1);
};

function divert(sim: MutableSim, f: Mutable<Flight>, now: number): void {
  sim.diversions += 1;
  logEvent(sim, now, 'diversion', f);
  releaseSpots(sim, f);
  f.phase = 'diverted';
  f.phaseStart = now;
}

function earnFee(sim: MutableSim, f: Flight): void {
  sim.money += AIRCRAFT_TYPES[f.type].fee;
  sim.fees += AIRCRAFT_TYPES[f.type].fee;
}

function logEvent(sim: MutableSim, now: number, kind: SimEvent['kind'], f: Flight, cost = 0): void {
  sim.money -= cost;
  sim.events.push({ minute: now, kind, flightId: f.id, cost });
}

function releaseSpots(sim: MutableSim, f: Mutable<Flight>): void {
  if (f.standId) delete sim.standOccupant[f.standId];
  if (f.bayId) delete sim.bayOccupant[f.bayId];
  f.standId = null;
  f.bayId = null;
}

function crash(sim: MutableSim, f: Mutable<Flight>, now: number, blocksRunway: boolean): void {
  const fine = crashFine(AIRCRAFT_TYPES[f.type].size, sim.earlierCrashesThisWeek + sim.crashes);
  sim.crashes += 1;
  logEvent(sim, now, 'crash', f, fine);
  releaseSpots(sim, f);
  f.phase = 'crashed';
  f.phaseStart = now;
  if (blocksRunway) sim.runwayBlockedUntil = Math.max(sim.runwayBlockedUntil, now + blockMinutes(sim, SAFETY.crashBlockMinutes));
}

function incident(sim: MutableSim, f: Flight, now: number, kind: 'incident' | 'taxiIncident'): number {
  logEvent(sim, now, kind, f, SAFETY.incidentCost[AIRCRAFT_TYPES[f.type].size]);
  return now + blockMinutes(sim, SAFETY.incidentBlockMinutes);
}

/** More aircraft taxiing at once means more chance two of them meet; the Incident stops one of them. */
function rollTaxiIncident(sim: MutableSim, flights: Mutable<Flight>[], now: number, rng: Random): void {
  const taxiing = flights.filter((f) => (f.phase === 'taxiIn' || f.phase === 'taxiOut') && f.stoppedUntil <= now);
  if (rng.next() >= taxiIncidentChance(taxiing.length, sim.groundRadarLevel)) return;
  const f = rng.pick(taxiing);
  f.stoppedUntil = incident(sim, f, now, 'taxiIncident');
}

/** Rolls ATC and Pilot Error for a landing or takeoff starting now. */
function rollError(sim: Simulation, rng: Random): number | null {
  const risk = riskMeter(sim);
  const atc = rng.next() < risk.atc;
  const pilot = rng.next() < risk.pilot;
  const outcomeRoll = rng.next();
  return atc || pilot ? outcomeRoll : null;
}

/** The ATC Tower gives the Runway to one aircraft at a time. */
function assignRunway(sim: MutableSim, flights: Mutable<Flight>[], now: number, blocked: ReadonlySet<string>, rng: Random): void {
  if (sim.runwayBusyUntil > now || !runwayUsable(sim, now)) return;
  const holding = flights
    .filter((f) => f.phase === 'holding' && runwayFits(sim, f))
    .sort((a, b) => Number(isLowFuel(b)) - Number(isLowFuel(a)) || (isLowFuel(a) ? a.fuelMinutes - b.fuelMinutes : 0) || a.phaseStart - b.phaseStart);
  const departures = flights.filter((f) => f.phase === 'holdShort' && f.phaseStart < now).sort((a, b) => a.phaseStart - b.phaseStart);
  const departure = departures[0];
  const landable = holding.find((f) => freeFittingStand(sim, f, blocked) ?? freeFittingBay(sim, f));
  const urgent = landable && isLowFuel(landable) ? landable : undefined;
  const departureDue = departure && now - departure.phaseStart >= ATC.departureMaxWaitMinutes;

  const next = urgent ?? (departureDue ? departure : (landable ?? departure));
  if (!next) return;
  const separation = separationOf(sim);
  const errorRoll = rollError(sim, rng);
  if (next.phase === 'holding') {
    next.pendingOutcome = errorRoll === null ? null : landingOutcome(errorRoll);
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
    next.pendingOutcome = errorRoll === null ? null : takeoffOutcome(errorRoll);
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
      if (now >= HOURS.holdingCloses) {
        divert(sim, f, now);
        break;
      }
      enter('holding');
      f.fuelMinutes = Math.max(0, f.fuelMinutes - STEP_MINUTES);
      break;
    case 'holding':
      const nightfall = isDark(now) && !nightCapable(sim);
      if (nightfall || (f.fuelMinutes <= ATC.minimumFuelMinutes && (!runwayUsable(sim, now) || !runwayFits(sim, f)))) {
        divert(sim, f, now);
        break;
      }
      if (f.fuelMinutes <= 0) {
        crash(sim, f, now, true);
        break;
      }
      f.fuelMinutes = Math.max(0, f.fuelMinutes - STEP_MINUTES);
      break;
    case 'landing': {
      if (now < f.phaseStart + separationOf(sim).landing) break;
      const outcome = f.pendingOutcome;
      f.pendingOutcome = null;
      if (outcome === 'crash') {
        crash(sim, f, now, true);
        break;
      }
      if (outcome === 'goAround') {
        logEvent(sim, now, 'goAround', f);
        releaseSpots(sim, f);
        f.landedSeq = 0;
        enter('holding');
        break;
      }
      if (outcome === 'incident') sim.runwayBlockedUntil = Math.max(sim.runwayBlockedUntil, incident(sim, f, now, 'incident'));
      sim.movements += 1;
      f.route = routeToStand(sim.network, sim.network.runwayExit, stand ?? bayById(sim, f.bayId)!);
      f.routeProgress = 0;
      enter('taxiIn');
      break;
    }
    case 'taxiIn':
    case 'taxiOut': {
      if (now < f.stoppedUntil) break;
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
        earnFee(sim, f);
      }
      if (now < f.phaseStart + turnaround) break;
      if (isDark(now) && !nightCapable(sim)) break; // stays overnight
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
      const outcome = f.pendingOutcome;
      f.pendingOutcome = null;
      if (outcome === 'crash') {
        crash(sim, f, now, true);
        break;
      }
      if (outcome === 'rejectedTakeoff' || outcome === 'incident') {
        logEvent(sim, now, 'rejectedTakeoff', f);
        if (outcome === 'incident') sim.runwayBlockedUntil = Math.max(sim.runwayBlockedUntil, incident(sim, f, now, 'incident'));
        enter('holdShort');
        break;
      }
      earnFee(sim, f);
      sim.movements += 1;
      enter('departed');
      break;
    }
    case 'departed':
    case 'crashed':
    case 'diverted':
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

/** Aircraft still on the ground at the end of the Day become the next Day's overnight aircraft. */
export function carryOver(sim: Simulation): ScheduledFlight[] {
  const onGround: readonly FlightPhase[] = ['landing', 'taxiIn', 'inBay', 'onStand', 'taxiOut', 'holdShort'];
  return sim.flights
    .filter((f) => onGround.includes(f.phase))
    .map((f) => ({ id: f.id, type: f.type, arrivalMinute: 0, overnight: true, arrivalFeePaid: f.unloaded }));
}
