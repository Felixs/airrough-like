/**
 * The Live Day simulation: flights moving through the airport in fixed steps.
 * Pure TypeScript, no rendering or DOM (ADR 0001). Each step returns a new Simulation.
 */
import { AIRCRAFT_TYPES, sizeRank, type AircraftTypeId } from './aircraft';
import { DAY_END_MINUTE, STEP_MINUTES, createDay, isDayOver, type Day } from './clock';
import { TILE_SIZE, type AirportLayout, type HoldingBay, type RunwayLength, type SizeClass, type Stand, type SupportRole } from './layout';
import { createRandom, mixSeed, type Random } from './random';
import { buildTaxiNetwork, routeBetween, routeFromStand, routeToStand, type RunwayAccess, type TaxiNetwork, type Tile } from './taxi';

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
  atcErrorChance: 0.0125,
  /** ATC Error chance drops this share per Controller Training level above 1. */
  trainingReduction: 0.15,
  /** ATC Error chance rises this share per aircraft over Radar capacity. */
  overRadarIncrease: 0.4,
  pilotErrorChance: 0.0075,
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

/** Emergency Actions *(first guess)*. */
export const ACTIONS = {
  groundStop: { cooldownMinutes: 8 * 60, needs: null },
  rushTurnaround: { cooldownMinutes: 90, needs: 'rampAgentStation' },
  manualDivert: { cooldownMinutes: 60, needs: 'adminOffice' },
  priorityLanding: { cooldownMinutes: 90, needs: 'airlineOffice' },
} as const satisfies Record<string, { cooldownMinutes: number; needs: SupportRole | null }>;
export type ActionId = keyof typeof ACTIONS;
export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];
/** How long a Ground Stop freezes taxiing, and how much a Rush Turnaround keeps. */
export const ACTION_EFFECTS = { groundStopMinutes: 5, rushTurnaroundFactor: 0.5 } as const;

/** Radar levels that unlock the automatic pauses. */
export const ALERTS = { fuelAlertRadar: 3, atcEmergencyRadar: 3, pilotEmergencyRadar: 4, secondRollBase: 0.5, secondRollPerTraining: 0.1 } as const;

/** Chance the Emergency Alert's second roll avoids the Crash. */
export function secondRollChance(controllerTrainingLevel: number): number {
  return Math.min(1, ALERTS.secondRollBase + ALERTS.secondRollPerTraining * (controllerTrainingLevel - 1));
}

export interface PendingAlert {
  /** fuel/emergency: Radar-driven alerts; event: an Incident, Crash or Diversion just happened. */
  readonly kind: 'fuel' | 'emergency' | 'event';
  readonly flightId: string;
  readonly minute: number;
  /** For 'event': what happened in that moment. */
  readonly events?: readonly SimEvent[];
}

/** Events that pause the Day with an info pop-up when pauseOnEvents is on. */
export const PAUSING_EVENTS: ReadonlySet<SimEvent['kind']> = new Set(['incident', 'taxiIncident', 'crash', 'diversion']);

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
  /** ATC callsign shown to the Player, e.g. "LH 347"; falls back to the id. */
  readonly callsign?: string;
  /** Spoken form, e.g. "Lufthansa 347". */
  readonly spoken?: string;
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
  /** Index (into layout.runways) of the Runway it is using or taxiing to; -1 when none. */
  readonly runway: number;
  /** Error result rolled when the current landing or takeoff started. */
  readonly pendingOutcome: LandingOutcome | TakeoffOutcome | null;
  /** Stopped on the Taxiway by an Incident until this minute. */
  readonly stoppedUntil: number;
  /** Which error caused the pending outcome. */
  readonly pendingCause: 'atc' | 'pilot' | null;
  /** Priority Landing: first in the landing queue. */
  readonly priority: boolean;
  /** Rush Turnaround: shorter Turnaround on its Stand. */
  readonly rushed: boolean;
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
  /** Movements by hour of the Day (index 0–23). */
  readonly movementsByHour: readonly number[];
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
  readonly windows: readonly RunwayWindow[];
  readonly noLights: boolean;
  readonly taxiSpeedFactor: number;
  readonly feeFactor: number;
  readonly cooldownFactor: number;
  readonly turnaroundFactor: number;
  readonly cargoNightTurnaroundFactor: number;
  readonly crashFineFactor: number;
  readonly blockageFactor: number;
  readonly pauseOnEvents: boolean;
  /** Per Runway (layout order): can't be used before this minute (Crash, Incident, Twist). */
  readonly runwayBlockedUntil: readonly number[];
  /** Everything notable that happened today, oldest first. */
  readonly events: readonly SimEvent[];
  /** Minute each Emergency Action is ready again. */
  readonly cooldownUntil: Readonly<Record<ActionId, number>>;
  /** Taxiing is frozen until this minute (Ground Stop). */
  readonly groundStopUntil: number;
  /** A Fuel or Emergency Alert waiting for the Player; the Day is paused until it is handled. */
  readonly pendingAlert: PendingAlert | null;
  readonly radarLevel: number;
  readonly controllerTrainingLevel: number;
  /** Per Runway: occupied by a Movement until this minute (Runway Separation). */
  readonly runwayBusyUntil: readonly number[];
  /** Stand id → flight id currently using (or reserved for) it. */
  readonly standOccupant: Readonly<Record<string, string>>;
  /** Holding Bay id → flight id using (or reserved for) it. */
  readonly bayOccupant: Readonly<Record<string, string>>;
  readonly flights: readonly Flight[];
}

/** A stretch of the Day when Runways are closed, or take landings only with ILS (Twists). */
export interface RunwayWindow {
  readonly kind: 'closed' | 'ilsOnly';
  readonly from: number;
  readonly to: number;
  /** Runway index; all Runways when left out. */
  readonly runway?: number;
}

export interface SimEvent {
  readonly minute: number;
  readonly kind: 'lowFuel' | 'goAround' | 'rejectedTakeoff' | 'incident' | 'taxiIncident' | 'crash' | 'diversion';
  readonly flightId: string;
  /** Money paid (Crash Fine, Incident cost). */
  readonly cost: number;
  /** Why a Diversion happened. */
  readonly reason?: DiversionReason;
}

export type DiversionReason = 'curfew' | 'dark' | 'noRunway' | 'manual';

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
  /** Closes every Runway until this minute. */
  readonly runwayBlockedUntil?: number;
  readonly windows?: readonly RunwayWindow[];
  /** Runway lights and ILS out (Power outage). */
  readonly noLights?: boolean;
  /** Multiplies taxi speed (Taxiway works). */
  readonly taxiSpeedFactor?: number;
  /** Pause with an info pop-up on Incidents, Crashes and Diversions (the game; tests leave it off). */
  readonly pauseOnEvents?: boolean;
  /** Boosts from meta-progression. */
  readonly feeFactor?: number;
  readonly fuelBonusMinutes?: number;
  readonly cooldownFactor?: number;
  readonly turnaroundFactor?: number;
  /** Cargo Turnarounds after dusk (Cargo apron lighting). */
  readonly cargoNightTurnaroundFactor?: number;
  readonly crashFineFactor?: number;
  /** Multiplies how long Crashes and Incidents block a Runway. */
  readonly blockageFactor?: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableSim = Omit<Mutable<Simulation>, 'standOccupant' | 'bayOccupant' | 'events' | 'runwayBusyUntil' | 'runwayBlockedUntil'> & {
  runwayBusyUntil: number[];
  runwayBlockedUntil: number[];
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
    movementsByHour: new Array<number>(24).fill(0),
    crashes: 0,
    earlierCrashesThisWeek: setup.earlierCrashesThisWeek ?? 0,
    diversions: 0,
    landings: 0,
    groundRadarLevel: setup.groundRadarLevel ?? 1,
    fireRescueLevel: setup.fireRescueLevel ?? 0,
    riskMultiplier: setup.riskMultiplier ?? 1,
    windows: setup.windows ?? [],
    noLights: setup.noLights ?? false,
    taxiSpeedFactor: setup.taxiSpeedFactor ?? 1,
    feeFactor: setup.feeFactor ?? 1,
    turnaroundFactor: setup.turnaroundFactor ?? 1,
    cargoNightTurnaroundFactor: setup.cargoNightTurnaroundFactor ?? 1,
    crashFineFactor: setup.crashFineFactor ?? 1,
    blockageFactor: setup.blockageFactor ?? 1,
    pauseOnEvents: setup.pauseOnEvents ?? false,
    cooldownFactor: setup.cooldownFactor ?? 1,
    runwayBlockedUntil: setup.layout.runways.map(() => setup.runwayBlockedUntil ?? 0),
    events: [],
    cooldownUntil: { groundStop: 0, rushTurnaround: 0, manualDivert: 0, priorityLanding: 0 },
    groundStopUntil: 0,
    pendingAlert: null,
    radarLevel: setup.radarLevel ?? 1,
    controllerTrainingLevel: setup.controllerTrainingLevel ?? 1,
    runwayBusyUntil: setup.layout.runways.map(() => 0),
    standOccupant: {},
    bayOccupant: {},
    flights: [],
  };
  sim.flights = setup.schedule.map((f) => {
    const flight: Mutable<Flight> = {
      ...f, phase: 'scheduled', phaseStart: 0, standId: null, bayId: null, landedSeq: 0, route: [], routeProgress: 0, unloaded: false, position: null, heading: 90,
      fuelMinutes: f.fuelMinutes ?? ATC.fuelReserveMinutes[AIRCRAFT_TYPES[f.type].size] + (setup.fuelBonusMinutes ?? 0),
      pendingOutcome: null,
      runway: -1,
      stoppedUntil: 0,
      pendingCause: null,
      priority: false,
      rushed: false,
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

const accessOf = (sim: Simulation, f: Flight): RunwayAccess | undefined => sim.network.runways.find((a) => a.index === f.runway);

function turnaroundMinutes(flight: Flight, stand: Stand, sim?: Simulation): number {
  const base = TIMINGS.turnaroundMinutes[AIRCRAFT_TYPES[flight.type].size] * (sim?.turnaroundFactor ?? 1);
  // Cargo apron lighting: cargo Turnarounds that start after dusk are quicker
  const night = sim && AIRCRAFT_TYPES[flight.type].purpose === 'cargo' && isDark(flight.phaseStart) ? sim.cargoNightTurnaroundFactor : 1;
  const placed = (stand.placement === 'remote' ? base * TIMINGS.remoteStandFactor : base) * night;
  return flight.rushed ? placed * ACTION_EFFECTS.rushTurnaroundFactor : placed;
}

/** A Stand fits aircraft of its Size Class or smaller and of its Purpose; the smallest fitting free Stand is used. */
function freeFittingStand(sim: Simulation, flight: Flight, blocked?: ReadonlySet<string>): Stand | undefined {
  const type = AIRCRAFT_TYPES[flight.type];
  const serves = type.purpose === 'passenger' ? 'terminal' : 'cargoHub';
  return sim.layout.stands
    .filter((s) => s.serves === serves && sizeRank(s.size) >= sizeRank(type.size) && !sim.standOccupant[s.id] && !blocked?.has(s.id) && sim.network.reachableSpots.has(s.id))
    .sort((a, b) => sizeRank(a.size) - sizeRank(b.size))[0];
}

function freeFittingBay(sim: Simulation, flight: Flight): HoldingBay | undefined {
  const size = sizeRank(AIRCRAFT_TYPES[flight.type].size);
  return sim.layout.holdingBays
    .filter((b) => sizeRank(b.size) >= size && !sim.bayOccupant[b.id] && sim.network.reachableSpots.has(b.id))
    .sort((a, b) => sizeRank(a.size) - sizeRank(b.size))[0];
}

const standById = (sim: Simulation, id: string | null) => (id ? sim.layout.stands.find((s) => s.id === id) : undefined);
const bayById = (sim: Simulation, id: string | null) => (id ? sim.layout.holdingBays.find((b) => b.id === id) : undefined);

// ---------------------------------------------------------------- step

/** Advances the simulation by one fixed step (15 in-game seconds). */
export function stepSimulation(prev: Simulation): Simulation {
  if (isDayOver(prev.clock) || prev.pendingAlert) return prev;
  const sim: MutableSim = {
    ...prev, standOccupant: { ...prev.standOccupant }, bayOccupant: { ...prev.bayOccupant }, events: [...prev.events], flights: prev.flights,
    runwayBusyUntil: [...prev.runwayBusyUntil], runwayBlockedUntil: [...prev.runwayBlockedUntil],
  };
  const now = prev.clock.minute;
  const rng = createRandom(mixSeed(prev.seed, Math.round(now / STEP_MINUTES)));
  const flights = prev.flights.map((f) => stepFlight(sim, { ...f }, now));
  rollTaxiIncident(sim, flights, now, rng);
  const blocked = releaseBays(sim, flights, now);
  assignRunway(sim, flights, now, blocked, rng);
  if (now + STEP_MINUTES >= HOURS.curfew) {
    for (const f of flights) if (f.phase === 'holding' || f.phase === 'scheduled') divert(sim, f, now, 'curfew');
  } else if (sim.pauseOnEvents && !sim.pendingAlert) {
    const fresh = sim.events.slice(prev.events.length).filter((e) => PAUSING_EVENTS.has(e.kind));
    if (fresh.length) sim.pendingAlert = { kind: 'event', flightId: fresh[0]!.flightId, minute: now, events: fresh };
  }
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

export { turnaroundMinutes };

export function separationOf(sim: Simulation) {
  return runwaySeparation(sim.radarLevel, sim.controllerTrainingLevel);
}

/** Current error chances at a risky moment on the Runway; shown as the Risk Meter. */
export function riskMeter(sim: Simulation, runwayIndex?: number): { atc: number; pilot: number; total: number } {
  const training = Math.max(0, 1 - SAFETY.trainingReduction * (sim.controllerTrainingLevel - 1));
  const radar = 1 + SAFETY.overRadarIncrease * radarLoad(sim).over;
  const surface = (sim.layout.runways[runwayIndex ?? sim.network.runways[0]?.index ?? 0] ?? sim.network.runway).surface;
  const atc = Math.min(1, SAFETY.atcErrorChance * training * radar * sim.riskMultiplier);
  const pilot = Math.min(1, SAFETY.pilotErrorChance * SAFETY.surfacePilotFactor[surface] * sim.riskMultiplier);
  return { atc, pilot, total: 1 - (1 - atc) * (1 - pilot) };
}

const blockMinutes = (sim: Simulation, base: number) => base * (SAFETY.fireRescueFactor[sim.fireRescueLevel] ?? 1) * sim.blockageFactor;
export const isDark = (now: number) => now >= HOURS.dusk;
const lit = (sim: Simulation, a: RunwayAccess) => !sim.noLights && (a.runway.surface === 'lit' || a.runway.surface === 'ils');
const hasIls = (sim: Simulation, a: RunwayAccess) => !sim.noLights && a.runway.surface === 'ils';
/** Whether any usable Runway can operate at night. */
export const nightCapable = (sim: Simulation) => sim.network.runways.some((a) => lit(sim, a));
const inWindow = (sim: Simulation, a: RunwayAccess, now: number, kind: RunwayWindow['kind']) =>
  sim.windows.some((w) => w.kind === kind && (w.runway === undefined || w.runway === a.index) && now >= w.from && now < w.to);
/** Whether a Runway can take a Movement right now (open, operating hours, light). */
const usable = (sim: Simulation, a: RunwayAccess, now: number) =>
  now >= (sim.runwayBlockedUntil[a.index] ?? 0) && now >= HOURS.operationsStart && (!isDark(now) || lit(sim, a)) && !inWindow(sim, a, now, 'closed');
/** Whether a Runway can take a landing right now (usable, and ILS when the weather demands it). */
const landingUsable = (sim: Simulation, a: RunwayAccess, now: number) =>
  usable(sim, a, now) && (!inWindow(sim, a, now, 'ilsOnly') || hasIls(sim, a));
/** Whether a Runway is long enough and of a surface that takes this aircraft (Grass: Small only). */
const fits = (a: RunwayAccess, f: Flight) => {
  const size = sizeRank(AIRCRAFT_TYPES[f.type].size);
  return RUNWAY_FITS[a.runway.length] >= size && (a.runway.surface !== 'grass' || size === 1);
};
const fittingRunways = (sim: Simulation, f: Flight) => sim.network.runways.filter((a) => fits(a, f));
/** Some Runway that fits the aircraft is usable now. */
const runwayUsableFor = (sim: Simulation, f: Flight, now: number) => fittingRunways(sim, f).some((a) => landingUsable(sim, a, now));
/** Some Runway that fits the aircraft works after dark. */
const nightRunwayFor = (sim: Simulation, f: Flight) => fittingRunways(sim, f).some((a) => lit(sim, a));

/** The Runway a departure taxis to: a fitting one, the one with the shortest queue first. */
function departureRunway(sim: Simulation, flights: readonly Flight[], f: Flight): RunwayAccess | undefined {
  const queue = (a: RunwayAccess) => flights.filter((o) => o.runway === a.index && (o.phase === 'taxiOut' || o.phase === 'holdShort')).length;
  // only Runways whose hold point is reachable from the aircraft's Stand
  const stand = standById(sim, f.standId);
  const here = stand ? sim.network.component.get(`${stand.x + Math.floor(stand.w / 2)},${stand.y + stand.h}`) : undefined;
  const reachable = (a: RunwayAccess) => here === undefined || sim.network.component.get(`${a.holdPoint.x},${a.holdPoint.y}`) === here;
  return [...fittingRunways(sim, f)].filter(reachable).sort((a, b) => queue(a) - queue(b) || a.index - b.index)[0]
    ?? sim.network.runways.find(reachable);
}

function divert(sim: MutableSim, f: Mutable<Flight>, now: number, reason: DiversionReason): void {
  sim.diversions += 1;
  sim.events.push({ minute: now, kind: 'diversion', flightId: f.id, cost: 0, reason });
  releaseSpots(sim, f);
  f.phase = 'diverted';
  f.phaseStart = now;
}

function countMovement(sim: MutableSim, now: number): void {
  sim.movements += 1;
  const byHour = [...sim.movementsByHour];
  const hour = Math.min(23, Math.floor(now / 60));
  byHour[hour] = (byHour[hour] ?? 0) + 1;
  sim.movementsByHour = byHour;
}

function earnFee(sim: MutableSim, f: Flight): void {
  const fee = Math.round(AIRCRAFT_TYPES[f.type].fee * sim.feeFactor);
  sim.money += fee;
  sim.fees += fee;
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
  const fine = Math.round(crashFine(AIRCRAFT_TYPES[f.type].size, sim.earlierCrashesThisWeek + sim.crashes) * sim.crashFineFactor);
  sim.crashes += 1;
  logEvent(sim, now, 'crash', f, fine);
  releaseSpots(sim, f);
  f.phase = 'crashed';
  f.phaseStart = now;
  if (blocksRunway && f.runway >= 0) block(sim, f.runway, now + blockMinutes(sim, SAFETY.crashBlockMinutes));
}

function block(sim: MutableSim, runway: number, until: number): void {
  sim.runwayBlockedUntil[runway] = Math.max(sim.runwayBlockedUntil[runway] ?? 0, until);
}

function incident(sim: MutableSim, f: Flight, now: number, kind: 'incident' | 'taxiIncident'): number {
  logEvent(sim, now, kind, f, SAFETY.incidentCost[AIRCRAFT_TYPES[f.type].size]);
  return now + blockMinutes(sim, SAFETY.incidentBlockMinutes);
}

/** More aircraft taxiing at once means more chance two of them meet; the Incident stops one of them. */
function rollTaxiIncident(sim: MutableSim, flights: Mutable<Flight>[], now: number, rng: Random): void {
  if (now < sim.groundStopUntil) return;
  const taxiing = flights.filter((f) => (f.phase === 'taxiIn' || f.phase === 'taxiOut') && f.stoppedUntil <= now);
  if (rng.next() >= taxiIncidentChance(taxiing.length, sim.groundRadarLevel)) return;
  const f = rng.pick(taxiing);
  f.stoppedUntil = incident(sim, f, now, 'taxiIncident');
}

/** Rolls ATC and Pilot Error for a landing or takeoff starting now. */
function rollError(sim: Simulation, rng: Random, runway: number): { roll: number; cause: 'atc' | 'pilot' } | null {
  const risk = riskMeter(sim, runway);
  const atc = rng.next() < risk.atc;
  const pilot = rng.next() < risk.pilot;
  const roll = rng.next();
  return atc ? { roll, cause: 'atc' } : pilot ? { roll, cause: 'pilot' } : null;
}

/** The ATC Tower gives each Runway to one aircraft at a time. */
function assignRunway(sim: MutableSim, flights: Mutable<Flight>[], now: number, blocked: ReadonlySet<string>, rng: Random): void {
  for (const access of sim.network.runways) {
    if ((sim.runwayBusyUntil[access.index] ?? 0) > now || !usable(sim, access, now)) continue;
    const holding = flights
      .filter((f) => f.phase === 'holding' && fits(access, f) && landingUsable(sim, access, now))
      .sort((a, b) => Number(b.priority) - Number(a.priority) || Number(isLowFuel(b)) - Number(isLowFuel(a)) || (isLowFuel(a) ? a.fuelMinutes - b.fuelMinutes : 0) || a.phaseStart - b.phaseStart);
    const departures = flights.filter((f) => f.phase === 'holdShort' && f.runway === access.index && f.phaseStart < now).sort((a, b) => a.phaseStart - b.phaseStart);
    const departure = departures[0];
    const landable = holding.find((f) => freeFittingStand(sim, f, blocked) ?? freeFittingBay(sim, f));
    const urgent = landable && (isLowFuel(landable) || landable.priority) ? landable : undefined;
    const departureDue = departure && now - departure.phaseStart >= ATC.departureMaxWaitMinutes;
    const next = urgent ?? (departureDue ? departure : (landable ?? departure));
    if (!next) continue;
    startMovement(sim, next, access, now, blocked, rng);
  }
}

function startMovement(sim: MutableSim, next: Mutable<Flight>, access: RunwayAccess, now: number, blocked: ReadonlySet<string>, rng: Random): void {
  const separation = separationOf(sim);
  const error = rollError(sim, rng, access.index);
  next.pendingCause = error?.cause ?? null;
  next.runway = access.index;
  if (next.phase === 'holding') {
    next.pendingOutcome = error === null ? null : landingOutcome(error.roll);
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
    sim.runwayBusyUntil[access.index] = now + separation.landing;
  } else {
    next.pendingOutcome = error === null ? null : takeoffOutcome(error.roll);
    next.phase = 'takeoff';
    sim.runwayBusyUntil[access.index] = now + separation.takeoff;
  }
  next.phaseStart = now;
  if (next.pendingOutcome === 'crash') {
    const radarNeeded = next.pendingCause === 'atc' ? ALERTS.atcEmergencyRadar : ALERTS.pilotEmergencyRadar;
    if (sim.radarLevel >= radarNeeded) sim.pendingAlert = { kind: 'emergency', flightId: next.id, minute: now };
  }
}

/** Aircraft in the air near the airport against what the Radar can track. */
export function radarLoad(sim: Simulation): { airborne: number; capacity: number; over: number } {
  const airborne = sim.flights.filter((f) => f.phase === 'holding' || f.phase === 'landing' || f.phase === 'takeoff').length;
  const capacity = ATC.radarBase + ATC.radarPerLevel * sim.radarLevel;
  return { airborne, capacity, over: Math.max(0, airborne - capacity) };
}

function burnFuel(sim: MutableSim, f: Mutable<Flight>, now: number): void {
  const before = f.fuelMinutes;
  f.fuelMinutes = Math.max(0, f.fuelMinutes - STEP_MINUTES);
  if (before >= ATC.lowFuelMinutes && f.fuelMinutes < ATC.lowFuelMinutes) {
    logEvent(sim, now, 'lowFuel', f);
    if (sim.radarLevel >= ALERTS.fuelAlertRadar) sim.pendingAlert = { kind: 'fuel', flightId: f.id, minute: now };
  }
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
        divert(sim, f, now, 'curfew');
        break;
      }
      enter('holding');
      burnFuel(sim, f, now);
      break;
    case 'holding':
      const nightfall = isDark(now) && !nightRunwayFor(sim, f);
      if (nightfall || (f.fuelMinutes <= ATC.minimumFuelMinutes && !runwayUsableFor(sim, f, now))) {
        divert(sim, f, now, nightfall ? 'dark' : 'noRunway');
        break;
      }
      if (f.fuelMinutes <= 0) {
        crash(sim, f, now, true);
        break;
      }
      burnFuel(sim, f, now);
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
      if (outcome === 'incident') block(sim, f.runway, incident(sim, f, now, 'incident'));
      countMovement(sim, now);
      f.route = routeToStand(sim.network, accessOf(sim, f)!.runwayExit, stand ?? bayById(sim, f.bayId)!);
      f.routeProgress = 0;
      enter('taxiIn');
      break;
    }
    case 'taxiIn':
    case 'taxiOut': {
      if (now < f.stoppedUntil || now < sim.groundStopUntil) break;
      f.routeProgress = Math.min(f.route.length - 1, f.routeProgress + TIMINGS.taxiTilesPerMinute * sim.taxiSpeedFactor * STEP_MINUTES);
      if (f.routeProgress < f.route.length - 1) break;
      if (f.phase === 'taxiOut') enter('holdShort');
      else enter(f.standId ? 'onStand' : 'inBay');
      break;
    }
    case 'onStand': {
      const turnaround = turnaroundMinutes(f, stand!, sim);
      if (!f.unloaded && now >= f.phaseStart + turnaround * TIMINGS.unloadShare) {
        f.unloaded = true;
        earnFee(sim, f);
      }
      if (now < f.phaseStart + turnaround) break;
      if (isDark(now) && !nightRunwayFor(sim, f)) break; // stays overnight
      const out = departureRunway(sim, sim.flights, f);
      if (!out) break; // no usable Runway at all
      f.runway = out.index;
      f.route = routeFromStand(sim.network, stand!, out.holdPoint);
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
        if (outcome === 'incident') block(sim, f.runway, incident(sim, f, now, 'incident'));
        enter('holdShort');
        break;
      }
      earnFee(sim, f);
      countMovement(sim, now);
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
  const share = (minutes: number) => Math.min(1, (t - f.phaseStart) / minutes);
  const access = accessOf(sim, f);
  /** Point along the Runway centre line: `along` in world units from its landing threshold. */
  const onRunway = (a: RunwayAccess, along: number): Point => {
    const r = a.runway;
    return a.vertical ? { x: (r.x + r.w / 2) * T, y: r.y * T + along } : { x: r.x * T + along, y: (r.y + r.h / 2) * T };
  };
  const alongOf = (a: RunwayAccess, tile: Tile) => (a.vertical ? (tile.y + 0.5 - a.runway.y) * T : (tile.x + 0.5 - a.runway.x) * T);
  const runwayHeading = (a: RunwayAccess) => (a.vertical ? 180 : 90);
  switch (f.phase) {
    case 'landing': {
      if (!access) break;
      f.position = onRunway(access, alongOf(access, access.runwayExit) * share(separationOf(sim).landing));
      f.heading = runwayHeading(access);
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
    case 'holdShort':
      f.position = tileCentre(access?.holdPoint ?? sim.network.holdPoint);
      f.heading = access?.vertical ? 90 : 180;
      break;
    case 'takeoff': {
      if (!access) break;
      const from = alongOf(access, access.holdPoint);
      const to = (access.vertical ? access.runway.h : access.runway.w) * T + 40;
      f.position = onRunway(access, from + (to - from) * share(separationOf(sim).takeoff));
      f.heading = runwayHeading(access);
      break;
    }
    default:
      f.position = null;
  }
}

/** Runs as many steps as `newClock` is ahead of the simulation's clock (see clock.advance). */
export function runTo(sim: Simulation, newClock: Day): Simulation {
  let s = sim;
  while (s.clock.minute + 1e-9 < newClock.minute && !isDayOver(s.clock) && !s.pendingAlert) s = stepSimulation(s);
  if (s.pendingAlert) return { ...s, clock: { ...s.clock, pendingRealMs: 0 } };
  return { ...s, clock: { ...s.clock, pendingRealMs: newClock.pendingRealMs } };
}

/** Aircraft still on the ground at the end of the Day become the next Day's overnight aircraft. */
export function carryOver(sim: Simulation): ScheduledFlight[] {
  const onGround: readonly FlightPhase[] = ['landing', 'taxiIn', 'inBay', 'onStand', 'taxiOut', 'holdShort'];
  return sim.flights
    .filter((f) => onGround.includes(f.phase))
    .map((f) => ({ id: f.id, type: f.type, arrivalMinute: 0, overnight: true, arrivalFeePaid: f.unloaded }));
}

// ---------------------------------------------------------------- Emergency Actions and Alerts

export interface ActionStatus {
  readonly ready: boolean;
  /** Minutes until the cooldown ends (0 when ready). */
  readonly cooldownLeft: number;
  /** Support Building the action needs but the airport lacks. */
  readonly missing: SupportRole | null;
}

export function actionAvailability(sim: Simulation): Record<ActionId, ActionStatus> {
  const roles = new Set(sim.layout.structures.flatMap((s) => (s.kind === 'supportBuilding' ? [s.role] : [])));
  const now = sim.clock.minute;
  const out = {} as Record<ActionId, ActionStatus>;
  for (const id of ACTION_IDS) {
    const needs = ACTIONS[id].needs;
    const missing = needs && !roles.has(needs) ? needs : null;
    const cooldownLeft = Math.max(0, sim.cooldownUntil[id] - now);
    out[id] = { ready: !missing && cooldownLeft === 0, cooldownLeft, missing };
  }
  return out;
}

/** The Holding aircraft most in need: lowest Fuel Reserve. */
export function mostUrgentHolding(sim: Simulation): Flight | undefined {
  return sim.flights.filter((f) => f.phase === 'holding').sort((a, b) => a.fuelMinutes - b.fuelMinutes)[0];
}

/** Uses an Emergency Action; throws if it isn't ready or has no valid target. */
export function useAction(prev: Simulation, id: ActionId, targetId?: string): Simulation {
  const status = actionAvailability(prev)[id];
  if (!status.ready) throw new Error(status.missing ? `Needs a ${status.missing}` : `On cooldown for ${Math.ceil(status.cooldownLeft)} min`);
  const now = prev.clock.minute;
  const sim: MutableSim = {
    ...prev, standOccupant: { ...prev.standOccupant }, bayOccupant: { ...prev.bayOccupant }, events: [...prev.events],
    flights: prev.flights.map((f) => ({ ...f })), cooldownUntil: { ...prev.cooldownUntil, [id]: now + ACTIONS[id].cooldownMinutes * prev.cooldownFactor },
    runwayBusyUntil: [...prev.runwayBusyUntil], runwayBlockedUntil: [...prev.runwayBlockedUntil],
  };
  const flights = sim.flights as Mutable<Flight>[];
  const holdingTarget = () => {
    const target = targetId ? flights.find((f) => f.id === targetId) : (mostUrgentHolding(sim) as Mutable<Flight> | undefined);
    if (!target || target.phase !== 'holding') throw new Error('No Holding aircraft to target');
    return flights.find((f) => f.id === target.id)!;
  };
  switch (id) {
    case 'groundStop':
      sim.groundStopUntil = now + ACTION_EFFECTS.groundStopMinutes;
      break;
    case 'priorityLanding':
      holdingTarget().priority = true;
      break;
    case 'manualDivert':
      divert(sim, holdingTarget(), now, 'manual');
      break;
    case 'rushTurnaround': {
      // The Stand the most urgent Holding aircraft waits for: of the Stands that fit it, the one that frees first.
      const waiting = holdingTarget();
      const remaining = (f: Flight) => f.phaseStart + turnaroundMinutes(f, standById(sim, f.standId)!, sim) - now;
      const occupant = flights
        .filter((f) => f.phase === 'onStand' && !f.rushed && f.standId)
        .filter((f) => {
          const stand = standById(sim, f.standId)!;
          return freeFittingStandAmong(waiting, [stand]);
        })
        .sort((a, b) => remaining(a) - remaining(b))[0];
      if (!occupant) throw new Error('No Stand to rush for that aircraft');
      occupant.rushed = true;
      break;
    }
  }
  return sim;
}

function freeFittingStandAmong(flight: Flight, stands: readonly Stand[]): boolean {
  const type = AIRCRAFT_TYPES[flight.type];
  const serves = type.purpose === 'passenger' ? 'terminal' : 'cargoHub';
  return stands.some((s) => s.serves === serves && sizeRank(s.size) >= sizeRank(type.size));
}

/** Emergency Alert: the Player intervenes and gets a second roll to avoid the Crash. */
export function resolveEmergency(prev: Simulation): Simulation {
  const alert = prev.pendingAlert;
  if (!alert || alert.kind !== 'emergency') return prev;
  const rng = createRandom(mixSeed(prev.seed, Math.round(prev.clock.minute / STEP_MINUTES), 0xe1));
  const saved = rng.next() < secondRollChance(prev.controllerTrainingLevel);
  return {
    ...prev,
    pendingAlert: null,
    flights: prev.flights.map((f) =>
      f.id !== alert.flightId || !saved ? f : { ...f, pendingOutcome: f.phase === 'landing' ? 'goAround' : 'rejectedTakeoff' }),
  };
}

/** Clears a pending Alert so the Day can go on. An Emergency Alert takes its second roll. */
export function acknowledgeAlert(sim: Simulation): Simulation {
  if (sim.pendingAlert?.kind === 'emergency') return resolveEmergency(sim);
  return { ...sim, pendingAlert: null };
}

/**
 * True when nothing else can happen today: no aircraft still to arrive, in the air or moving, and every
 * aircraft left on the ground stays overnight. The Day can then end early.
 */
export function daySettled(sim: Simulation): boolean {
  const now = sim.clock.minute;
  return sim.flights.every((f) => {
    if (f.phase === 'departed' || f.phase === 'crashed' || f.phase === 'diverted') return true;
    if (f.phase === 'onStand' || f.phase === 'inBay') return isDark(now) && !nightRunwayFor(sim, f);
    return false;
  });
}

/** Ends the Day now (used once it is settled); the clock jumps to 24:00. */
export function finishDay(sim: Simulation): Simulation {
  return { ...sim, clock: { minute: HOURS.curfew, pendingRealMs: 0 } };
}
