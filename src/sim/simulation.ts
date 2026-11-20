/**
 * The Live Day simulation: flights moving through the airport in fixed steps.
 * Pure TypeScript, no rendering or DOM (ADR 0001). Each step returns a new Simulation.
 */
import { AIRCRAFT_TYPES, sizeRank, type AircraftTypeId } from './aircraft';
import { DAY_END_MINUTE, STEP_MINUTES, createDay, isDayOver, type Day } from './clock';
import { TILE_SIZE, parkedHeading, runwayNames, spotEntry, type AirportLayout, type HoldingBay, type RunwayLength, type SizeClass, type Stand, type SupportRole } from './layout';
import { createRandom, mixSeed, type Random } from './random';
import { storyFor, type StoryKind } from './stories';
import { buildTaxiNetwork, departureHolds, detour, exitFor, exitsFor, holdPointFor, rejectExit, routeBetween, TAKEOFF_TILES, routeFromStand, routeToStand, taxiRoute, type RunwayAccess, type Spot, type TaxiNetwork, type Tile } from './taxi';
import { WIND_RULES, landingHeading, wantsReverse, windTimeline, type Wind, type WindSetup } from './wind';

/** Timings *(first guess, from the prototypes)*. */
export const TIMINGS = {
  /** Straight-line taxi speed of Small and Medium aircraft. */
  taxiTilesPerMinute: 6,
  /** Taxi speed by Size Class on straight Taxiway (wide-bodies taxi a little slower). */
  taxiSpeedFactor: { small: 1, medium: 1, large: 0.85 },
  /**
   * A tile where the route turns costs this many tiles' worth of time: everyone slows down for a turn (real airliners
   * taxi at ~20 kt straight and ~10 kt in turns), the larger the aircraft the more.
   */
  turnTileCost: { small: 1.3, medium: 1.6, large: 2 },
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
  /**
   * How long Incidents and Crashes block their Runway or Taxiway, in minutes, by Size Class (before Fire & Rescue).
   * Each one varies by ±`blockSpread` around it. Nothing costs money: the blockage is the whole penalty.
   */
  blockMinutes: {
    taxiIncident: { small: 10, medium: 15, large: 20 },
    incident: { small: 15, medium: 20, large: 30 },
    crash: { small: 45, medium: 60, large: 90 },
  },
  blockSpread: 0.3,
  /** Blockage multiplier by Fire & Rescue Station level 0–5. */
  fireRescueFactor: [1, 0.75, 0.55, 0.4, 0.3, 0.2],
  /** Taxiway Incident chance per step for each extra aircraft taxiing at the same time. */
  taxiIncidentPerAircraft: 0.0005,
  /** Ground Radar lowers Taxiway Incidents by this share per level above 1. */
  groundRadarReduction: 0.15,
} as const;

/** Emergency Actions *(first guess)*. */
export const ACTIONS = {
  rushTurnaround: { cooldownMinutes: 90, needs: 'rampAgentStation' },
  manualDivert: { cooldownMinutes: 60, needs: 'adminOffice' },
  priorityLanding: { cooldownMinutes: 90, needs: 'airlineOffice' },
} as const satisfies Record<string, { cooldownMinutes: number; needs: SupportRole | null }>;
export type ActionId = keyof typeof ACTIONS;
export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];
/** How much of the Turnaround a Rush Turnaround keeps. */
export const ACTION_EFFECTS = { rushTurnaroundFactor: 0.5 } as const;

/** Radar levels that unlock the automatic pauses. */
export const ALERTS = { atcEmergencyRadar: 3, pilotEmergencyRadar: 4, secondRollBase: 0.5, secondRollPerTraining: 0.1 } as const;

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

/**
 * Minutes an Incident or Crash blocks its Runway or Taxiway before Fire & Rescue: by Size Class, times 0.7–1.3 from
 * the event itself (seed, flight, minute), so it draws nothing from the Day's random rolls.
 */
export function blockageMinutes(kind: keyof typeof SAFETY.blockMinutes, size: SizeClass, seed: number, flightId: string, minute: number): number {
  let h = 0;
  for (let i = 0; i < flightId.length; i++) h = Math.imul(h ^ flightId.charCodeAt(i), 16777619) >>> 0;
  const u = mixSeed(seed, h, Math.round(minute * 4), kind.length) / 2 ** 32;
  return SAFETY.blockMinutes[kind][size] * (1 - SAFETY.blockSpread + 2 * SAFETY.blockSpread * u);
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
  /** Direction of its current landing or takeoff (true = 27 / 36). */
  readonly reverse: boolean;
  /** Error result rolled when the current landing or takeoff started. */
  readonly pendingOutcome: LandingOutcome | TakeoffOutcome | null;
  /** Stopped on the Taxiway by an Incident until this minute. */
  readonly stoppedUntil: number;
  /** The Runway exit a landing aircraft will take (set when it is cleared to land). */
  readonly exitTile?: Tile | null;
  /** Since when it has been waiting in line in front of a Taxiway closed by an Incident (unset while it can move). */
  readonly waitingSince?: number;
  /** Which error caused the pending outcome. */
  readonly pendingCause: 'atc' | 'pilot' | null;
  /** Priority Landing: first in the landing queue. */
  readonly priority: boolean;
  /** Rush Turnaround: shorter Turnaround on its Stand. */
  readonly rushed: boolean;
  /** Where a departure holds short and lines up (an intersection, when that is a shorter taxi); null = full length. */
  readonly holdTile: Tile | null;
  /** World position (units) and heading in degrees (0 = north, 90 = east); null when not on the airfield. */
  readonly position: Point | null;
  readonly heading: number;
  /** How high it flies, 0 (on the ground) … 1 (leaving the airfield), for drawing the climb and descent. */
  readonly altitude: number;
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
  readonly blockageFactor: number;
  readonly pauseOnEvents: boolean;
  /** Ask the Player at low fuel: divert, or declare a Mayday (on in a played Live Day; off in a bare simulation). */
  readonly askOnLowFuel: boolean;
  /** Per Runway (layout order): can't be used before this minute (Crash, Incident, Twist). */
  readonly runwayBlockedUntil: readonly number[];
  /** Everything notable that happened today, oldest first. */
  readonly events: readonly SimEvent[];
  /** Minute each Emergency Action is ready again. */
  readonly cooldownUntil: Readonly<Record<ActionId, number>>;
  /** Aircraft that declared a Mayday, in order: every Runway stops for them until they are down. */
  readonly mayday: readonly string[];
  /** A Fuel or Emergency Alert waiting for the Player; the Day is paused until it is handled. */
  readonly pendingAlert: PendingAlert | null;
  readonly radarLevel: number;
  readonly controllerTrainingLevel: number;
  /** Per Runway: occupied by a Movement until this minute (Runway Separation). */
  readonly runwayBusyUntil: readonly number[];
  /** Per Runway: landing in its reverse direction (27 / 36) because of the wind. */
  readonly runwayReverse: readonly boolean[];
  /** Per Runway: changing direction until this minute (no new Movements). */
  readonly changeoverUntil: readonly number[];
  /** Wind every 30 minutes; empty means calm (Runways keep 09 / 18). */
  readonly wind: readonly Wind[];
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
  readonly kind: 'lowFuel' | 'mayday' | 'goAround' | 'rejectedTakeoff' | 'incident' | 'taxiIncident' | 'crash' | 'diversion' | 'runwayChange';
  readonly flightId: string;
  /** Money paid: always 0 now (Incidents and Crashes cost nothing); kept for saves. */
  readonly cost: number;
  /** Why a Diversion happened. */
  readonly reason?: DiversionReason;
  /** What went wrong, in a line (Go-Arounds, Rejected Takeoffs, Incidents, Crashes); flavour only. */
  readonly story?: string;
  /** Until when an Incident or Crash blocks its Runway or Taxiway. */
  readonly blockedUntil?: number;
}

export type DiversionReason = 'curfew' | 'dark' | 'noRunway' | 'manual' | 'lowFuel';

export interface SimulationSetup {
  /** Seeded wind for the Day; leave out for calm air. */
  readonly wind?: WindSetup;
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
  readonly askOnLowFuel?: boolean;
  /** Boosts from meta-progression. */
  readonly feeFactor?: number;
  readonly fuelBonusMinutes?: number;
  readonly cooldownFactor?: number;
  readonly turnaroundFactor?: number;
  /** Cargo Turnarounds after dusk (Cargo apron lighting). */
  readonly cargoNightTurnaroundFactor?: number;
  /** Multiplies how long Crashes and Incidents block a Runway. */
  readonly blockageFactor?: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableSim = Omit<Mutable<Simulation>, 'standOccupant' | 'bayOccupant' | 'events' | 'runwayBusyUntil' | 'runwayBlockedUntil' | 'runwayReverse' | 'changeoverUntil'> & {
  runwayBusyUntil: number[];
  runwayReverse: boolean[];
  changeoverUntil: number[];
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
    blockageFactor: setup.blockageFactor ?? 1,
    pauseOnEvents: setup.pauseOnEvents ?? false,
    askOnLowFuel: setup.askOnLowFuel ?? false,
    cooldownFactor: setup.cooldownFactor ?? 1,
    runwayBlockedUntil: setup.layout.runways.map(() => setup.runwayBlockedUntil ?? 0),
    events: [],
    cooldownUntil: { rushTurnaround: 0, manualDivert: 0, priorityLanding: 0 },
    mayday: [],
    pendingAlert: null,
    radarLevel: setup.radarLevel ?? 1,
    controllerTrainingLevel: setup.controllerTrainingLevel ?? 1,
    runwayBusyUntil: setup.layout.runways.map(() => 0),
    runwayReverse: setup.layout.runways.map(() => false),
    changeoverUntil: setup.layout.runways.map(() => 0),
    wind: setup.wind ? windTimeline(setup.wind) : [],
    standOccupant: {},
    bayOccupant: {},
    flights: [],
  };
  sim.flights = setup.schedule.map((f) => {
    const flight: Mutable<Flight> = {
      ...f, phase: 'scheduled', phaseStart: 0, standId: null, bayId: null, landedSeq: 0, route: [], routeProgress: 0, unloaded: false, position: null, heading: 90,
      // the Fuel Farm Boost/building adds to whatever the flight brings
      fuelMinutes: (f.fuelMinutes ?? ATC.fuelReserveMinutes[AIRCRAFT_TYPES[f.type].size]) + (setup.fuelBonusMinutes ?? 0),
      pendingOutcome: null,
      runway: -1,
      reverse: false,
      stoppedUntil: 0,
      waitingSince: undefined, // every flight has every field, so copying flights each step stays fast
      exitTile: null,
      holdTile: null,
      altitude: 0,
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
    runwayReverse: [...prev.runwayReverse], changeoverUntil: [...prev.changeoverUntil],
  };
  const now = prev.clock.minute;
  const rng = createRandom(mixSeed(prev.seed, Math.round(now / STEP_MINUTES)));
  const closed = taxiwayClosures(prev, prev.flights, now);
  const flights = prev.flights.map((f) => stepFlight(sim, { ...f }, now, closed));
  rollTaxiIncident(sim, flights, now, rng);
  updateDirections(sim, flights, now);
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
  now >= (sim.changeoverUntil[a.index] ?? 0) && now >= (sim.runwayBlockedUntil[a.index] ?? 0) && now >= HOURS.operationsStart && (!isDark(now) || lit(sim, a)) && !inWindow(sim, a, now, 'closed');
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
/** The wind now (calm when the Day has no wind). */
export function windAt(sim: Simulation, minute: number): Wind {
  return sim.wind[Math.min(sim.wind.length - 1, Math.floor(minute / WIND_RULES.sampleMinutes))] ?? { direction: 0, knots: 0 };
}

/** Where departures hold short for a Runway in its current direction. */
export const holdOf = (sim: Simulation, a: RunwayAccess): Tile => holdPointFor(a, sim.runwayReverse[a.index] ?? false);

const sameTile = (p: Tile, q: Tile) => p.x === q.x && p.y === q.y;

/** Where this departure holds short: its intersection if it still has enough Runway ahead, else the full length. */
export function holdFor(sim: Simulation, f: Flight, a: RunwayAccess): Tile {
  const h = f.holdTile;
  if (h && departureHolds(a, sim.runwayReverse[a.index] ?? false, AIRCRAFT_TYPES[f.type].size).some((t) => sameTile(t, h))) return h;
  return holdOf(sim, a);
}

/**
 * The hold point a departure taxis to from `from`: of the full-length hold and the intersections with enough Runway
 * ahead for its takeoff run, the one with the shortest taxi. The Tower still clears them in the order they got there.
 */
function chooseHold(sim: Simulation, f: Flight, a: RunwayAccess, route: (hold: Tile) => readonly Tile[]): { hold: Tile; route: Tile[] } {
  const holds = departureHolds(a, sim.runwayReverse[a.index] ?? false, AIRCRAFT_TYPES[f.type].size);
  let best: { hold: Tile; route: Tile[] } | null = null;
  for (const hold of holds) {
    let r: Tile[];
    try {
      r = [...route(hold)];
    } catch {
      continue;
    }
    if (!best || r.length < best.route.length) best = { hold, route: r };
  }
  return best ?? { hold: holds[0]!, route: [...route(holds[0]!)] };
}

/**
 * The ATC Tower turns a Runway round when the tailwind gets too strong: a short changeover with no new
 * Movements; departures already heading for the old hold point taxi on to the new one.
 */
function updateDirections(sim: MutableSim, flights: Mutable<Flight>[], now: number): void {
  if (!sim.wind.length) return;
  const wind = windAt(sim, now);
  for (const a of sim.network.runways) {
    const current = sim.runwayReverse[a.index] ?? false;
    if (wantsReverse(wind, a.vertical, current) === current) continue;
    sim.runwayReverse[a.index] = !current;
    sim.changeoverUntil[a.index] = Math.max(now, sim.runwayBusyUntil[a.index] ?? 0) + WIND_RULES.changeoverMinutes;
    sim.events.push({ minute: now, kind: 'runwayChange', flightId: `RWY ${activeName(sim, a, !current)}`, cost: 0 });
    for (const f of flights) {
      if (f.runway !== a.index || f.phase !== 'holdShort') continue;
      const at = f.route[f.route.length - 1] ?? holdPointFor(a, current);
      const next = chooseHold(sim, f, a, (h) => taxiRoute(sim.network, at, h));
      f.holdTile = next.hold;
      f.route = next.route;
      f.routeProgress = 0;
      f.phase = 'taxiOut';
      f.phaseStart = now;
    }
  }
}

const activeName = (sim: Simulation, a: RunwayAccess, reverse: boolean) => {
  const ends = runwayNames(sim.layout)[a.index]!;
  return reverse ? ends.reverse : ends.forward;
};

function departureRunway(sim: Simulation, flights: readonly Flight[], f: Flight, now: number): RunwayAccess | undefined {
  const queue = (a: RunwayAccess) => flights.filter((o) => o.runway === a.index && (o.phase === 'taxiOut' || o.phase === 'holdShort')).length;
  // only Runways whose hold point is reachable from the aircraft's Stand
  const stand = standById(sim, f.standId);
  const entry = stand ? spotEntry(stand) : undefined;
  const here = entry ? sim.network.component.get(`${entry.x},${entry.y}`) : undefined;
  const reachable = (a: RunwayAccess) => {
    const hold = holdOf(sim, a);
    return here === undefined || sim.network.component.get(`${hold.x},${hold.y}`) === here;
  };
  // after dark only a Lit or ILS Runway will do
  const candidates = fittingRunways(sim, f).filter((a) => reachable(a) && (!isDark(now) || lit(sim, a)));
  return candidates.sort((a, b) => queue(a) - queue(b) || a.index - b.index)[0]
    ?? (isDark(now) ? undefined : sim.network.runways.find(reachable));
}

/**
 * At dusk a departure taxiing to, or holding short of, a Runway that can't be used at night goes to a fitting Lit or
 * ILS Runway it can reach; if there is none it turns round to a free Stand (Contact or Remote; else a Holding Bay) and
 * stays there for the night. With nowhere free it stays where it is.
 */
function nightTurnBack(sim: MutableSim, f: Mutable<Flight>, now: number): void {
  const access = accessOf(sim, f);
  const at = f.phase === 'holdShort' && access ? holdFor(sim, f, access) : f.route[Math.min(Math.floor(f.routeProgress), f.route.length - 1)];
  if (!at || !sim.network.tiles.has(`${at.x},${at.y}`)) return; // still leaving its Stand: decide once on the Taxiway
  const here = sim.network.component.get(`${at.x},${at.y}`);
  const litOut = fittingRunways(sim, f).find((a) => {
    const hold = holdOf(sim, a);
    return lit(sim, a) && sim.network.component.get(`${hold.x},${hold.y}`) === here;
  });
  if (litOut) {
    f.runway = litOut.index;
    const next = chooseHold(sim, f, litOut, (h) => taxiRoute(sim.network, at, h));
    f.holdTile = next.hold;
    f.route = next.route;
  } else {
    const stand = freeFittingStand(sim, f);
    const spot = stand ?? freeFittingBay(sim, f);
    if (!spot) return;
    if (stand) {
      sim.standOccupant[stand.id] = f.id;
      f.standId = stand.id;
    } else {
      sim.bayOccupant[spot.id] = f.id;
      f.bayId = spot.id;
    }
    f.runway = -1;
    f.route = routeToStand(sim.network, at, spot);
    f.phase = 'taxiIn';
  }
  f.routeProgress = 0;
  f.waitingSince = undefined;
  f.phaseStart = now;
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

function logEvent(sim: MutableSim, now: number, kind: SimEvent['kind'], f: Flight, blockedUntil?: number): void {
  const story = storyKind(kind, f);
  sim.events.push({
    minute: now, kind, flightId: f.id, cost: 0,
    ...(story ? { story: storyFor(story, f.pendingCause, sim.seed, f.id, now) } : {}),
    ...(blockedUntil !== undefined ? { blockedUntil } : {}),
  });
}

/** Which kind of story an event gets, from what the aircraft was doing. */
function storyKind(kind: SimEvent['kind'], f: Flight): StoryKind | null {
  switch (kind) {
    case 'goAround': return 'goAround';
    case 'rejectedTakeoff': return 'rejectedTakeoff';
    case 'taxiIncident': return 'taxiIncident';
    case 'incident': return f.phase === 'takeoff' ? 'takeoffIncident' : 'landingIncident';
    case 'crash': return f.phase === 'takeoff' ? 'takeoffCrash' : f.phase === 'holding' ? 'fuelCrash' : 'landingCrash';
    default: return null;
  }
}

function releaseSpots(sim: MutableSim, f: Mutable<Flight>): void {
  if (f.standId) delete sim.standOccupant[f.standId];
  if (f.bayId) delete sim.bayOccupant[f.bayId];
  f.standId = null;
  f.bayId = null;
}

function crash(sim: MutableSim, f: Mutable<Flight>, now: number, blocksRunway: boolean): void {
  sim.crashes += 1;
  const until = blocksRunway && f.runway >= 0 ? now + blockMinutes(sim, blockageMinutes('crash', AIRCRAFT_TYPES[f.type].size, sim.seed, f.id, now)) : undefined;
  logEvent(sim, now, 'crash', f, until);
  releaseSpots(sim, f);
  f.phase = 'crashed';
  f.phaseStart = now;
  if (until !== undefined) block(sim, f.runway, until);
}

function block(sim: MutableSim, runway: number, until: number): void {
  sim.runwayBlockedUntil[runway] = Math.max(sim.runwayBlockedUntil[runway] ?? 0, until);
}

function incident(sim: MutableSim, f: Flight, now: number, kind: 'incident' | 'taxiIncident'): number {
  const until = now + blockMinutes(sim, blockageMinutes(kind, AIRCRAFT_TYPES[f.type].size, sim.seed, f.id, now));
  logEvent(sim, now, kind, f, until);
  return until;
}

/** More aircraft taxiing at once means more chance two of them meet; the Incident stops one of them. */
function rollTaxiIncident(sim: MutableSim, flights: Mutable<Flight>[], now: number, rng: Random): void {
  // only aircraft on the move can run into trouble: ones standing in a queue (waiting in line) don't count
  const taxiing = flights.filter((f) => (f.phase === 'taxiIn' || f.phase === 'taxiOut') && f.stoppedUntil <= now && f.waitingSince === undefined);
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
  // A Mayday: every Runway stops for it; it lands on the first fitting Runway that is free, and nothing else
  // lands or takes off anywhere until it is down.
  const inEmergency = (f: Flight | undefined) => f?.phase === 'holding' || f?.phase === 'landing';
  sim.mayday = sim.mayday.filter((id) => inEmergency(flights.find((f) => f.id === id)));
  const mayday = flights.find((f) => f.id === sim.mayday[0]);
  if (mayday && !flights.some((f) => sim.mayday.includes(f.id) && f.phase === 'landing')) {
    {
      const access = sim.network.runways.find((a) => (sim.runwayBusyUntil[a.index] ?? 0) <= now && usable(sim, a, now) && fits(a, mayday) && landingUsable(sim, a, now));
      if (access) startMovement(sim, mayday, access, now, blocked, rng);
    }
    return;
  }
  if (sim.mayday.length) return; // a Mayday aircraft is landing: nothing else moves on any Runway
  for (const access of sim.network.runways) {
    if ((sim.runwayBusyUntil[access.index] ?? 0) > now || !usable(sim, access, now)) continue;
    const holding = flights
      .filter((f) => f.phase === 'holding' && fits(access, f) && landingUsable(sim, access, now))
      .sort((a, b) => Number(b.priority) - Number(a.priority) || Number(isLowFuel(b)) - Number(isLowFuel(a)) || (isLowFuel(a) ? a.fuelMinutes - b.fuelMinutes : 0) || a.phaseStart - b.phaseStart);
    const departures = flights.filter((f) => f.phase === 'holdShort' && f.runway === access.index && f.phaseStart < now).sort((a, b) => a.phaseStart - b.phaseStart);
    const departure = departures[0];
    // Only land an aircraft whose way off the Runway is clear, so a blocked exit never keeps departures waiting.
    const closed = holding.length ? taxiwayClosures(sim, flights, now) : undefined;
    const exits = new Map<string, Tile>();
    const landable = holding.find((f) => {
      const spot = freeFittingStand(sim, f, blocked) ?? freeFittingBay(sim, f);
      const exit = spot ? clearExit(sim, closed!, access, sim.runwayReverse[access.index] ?? false, f, spot) : null;
      if (exit) exits.set(f.id, exit);
      return !!exit;
    });
    const urgent = landable && (isLowFuel(landable) || landable.priority) ? landable : undefined;
    const departureDue = departure && now - departure.phaseStart >= ATC.departureMaxWaitMinutes;
    const next = urgent ?? (departureDue ? departure : (landable ?? departure));
    if (!next) continue;
    if (next.phase === 'holding') next.exitTile = exits.get(next.id) ?? null;
    startMovement(sim, next, access, now, blocked, rng);
  }
}

/** Tiles of the way off the Runway that must be free before an aircraft may land. */
const EXIT_CLEAR_TILES = 6;

/**
 * The exit a landing aircraft will take: the first one past its landing roll whose way off the Runway is clear (it
 * rolls on past a blocked one). An exit is clear when the first tiles of the taxi route from it hold no aircraft that
 * is stopped, holding short or waiting in line, and no departure is on its way to hold short there; and no Incident
 * closes the way to the Stand with no way round. Null when no exit is clear.
 */
function clearExit(sim: Simulation, closed: Closures, access: RunwayAccess, reverse: boolean, f: Flight, spot: Spot): Tile | null {
  const holdsComing = sim.flights.filter((o) => o.phase === 'taxiOut' && o.id !== f.id).map((o) => o.route[o.route.length - 1]!).filter(Boolean);
  for (const exit of exitsFor(access, reverse, AIRCRAFT_TYPES[f.type].size)) {
    let route: Tile[];
    try {
      route = routeToStand(sim.network, exit, spot);
    } catch {
      continue;
    }
    const first = route.slice(0, EXIT_CLEAR_TILES);
    const taken = closed.occupants.some((o) => o.id !== f.id && (o.heading === null || o.waitingSince !== undefined) && first.some((t) => near(t, o.at, o.clearance + 1)))
      || holdsComing.some((h) => first.some((t) => near(t, h, 2)));
    if (taken || first.some((t) => closed.incident.has(`${t.x},${t.y}`))) continue;
    if (closed.incident.size && route.some((t) => closed.incident.has(`${t.x},${t.y}`)) && !detour(sim.network, route, 1, closed.incident)) continue;
    return exit;
  }
  return null;
}

function startMovement(sim: MutableSim, next: Mutable<Flight>, access: RunwayAccess, now: number, blocked: ReadonlySet<string>, rng: Random): void {
  const separation = separationOf(sim);
  const error = rollError(sim, rng, access.index);
  next.pendingCause = error?.cause ?? null;
  next.runway = access.index;
  next.reverse = sim.runwayReverse[access.index] ?? false;
  if (next.phase === 'holding') {
    next.pendingOutcome = error === null ? null : landingOutcome(error.roll);
    // no fuel to go around: on a Mayday a Go-Around is a Crash
    if (sim.mayday.includes(next.id) && next.pendingOutcome === 'goAround') next.pendingOutcome = 'crash';
    const stand = freeFittingStand(sim, next, blocked);
    const bay = stand ? undefined : freeFittingBay(sim, next);
    if (stand) {
      sim.standOccupant[stand.id] = next.id;
      next.standId = stand.id;
    } else if (bay) {
      sim.bayOccupant[bay.id] = next.id;
      next.bayId = bay.id;
    } // a Mayday may land with nowhere to park: it waits by its exit until a Stand or Holding Bay frees up
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
    // a decision for the Player (whatever the Radar or pop-up setting): divert now, or declare a Mayday and land
    if (sim.askOnLowFuel) sim.pendingAlert = { kind: 'fuel', flightId: f.id, minute: now };
  }
}

interface Occupant {
  readonly id: string;
  /** The tile it stands on. */
  readonly at: Tile;
  /** How far round it others keep clear (tiles): 1, or 2 for Large aircraft. */
  readonly clearance: number;
  /** Its taxi direction, or null when it is standing still (holding short, stopped by an Incident). */
  readonly heading: readonly [number, number] | null;
  /** When it started waiting in line, if it is waiting. */
  readonly waitingSince?: number;
  /** Its route and where it is on it (taxiing aircraft only), to see who it will meet head-on. */
  readonly route?: readonly Tile[];
  readonly index?: number;
  /** Its path over the next tiles (taxiing aircraft only). */
  readonly path?: Path;
}

interface Closures {
  /** Taxiway tiles closed by aircraft stopped by an Incident (the whole Taxiway width round them). */
  readonly incident: ReadonlySet<string>;
  /** Every aircraft on the Taxiways (taxiing, waiting or holding short), for in-trail spacing. */
  readonly occupants: readonly Occupant[];
}

const around = (t: Tile): string[] => [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => `${t.x + dx},${t.y + dy}`));
const near = (a: Tile, b: Tile, r: number) => Math.abs(a.x - b.x) <= r && Math.abs(a.y - b.y) <= r;

function taxiwayClosures(sim: Simulation, flights: readonly Flight[], now: number): Closures {
  const incident = new Set<string>();
  const occupants: Occupant[] = [];
  for (const f of flights) {
    const clearance = AIRCRAFT_TYPES[f.type].size === 'large' ? 2 : 1;
    // holding short, or taking off (a Rejected Takeoff comes back to the hold point, so it stays claimed until airborne)
    if (f.phase === 'holdShort' || f.phase === 'takeoff') {
      const access = sim.network.runways.find((a) => a.index === f.runway);
      occupants.push({ id: f.id, at: access ? holdFor(sim, f, access) : f.route[f.route.length - 1]!, clearance, heading: null });
      continue;
    }
    if (f.phase !== 'taxiIn' && f.phase !== 'taxiOut') continue;
    const i = Math.min(Math.floor(f.routeProgress), f.route.length - 1);
    const at = f.route[i]!;
    if (f.stoppedUntil > now) {
      for (let j = Math.max(0, i - 1); j <= Math.min(f.route.length - 1, i + 2); j++) for (const k of around(f.route[j]!)) incident.add(k);
      occupants.push({ id: f.id, at, clearance, heading: null });
      continue;
    }
    const next = f.route[Math.min(i + 1, f.route.length - 1)]!;
    const heading = next.x === at.x && next.y === at.y ? null : [next.x - at.x, next.y - at.y] as const;
    occupants.push({ id: f.id, at, clearance, heading, waitingSince: f.waitingSince, route: f.route, index: i, path: pathAhead(f.route, i) });
  }
  return { incident, occupants };
}

/** How many tiles ahead aircraft look for someone they would meet head-on. */
const HEAD_ON_HORIZON = 30;
/** Head-on conflicts are only sorted out once the meeting point is this close (further out, routes often part anyway). */
const HEAD_ON_ACT = 16;
/** Two aircraft crossing a tile less than this many tiles' worth of taxiing apart would meet there. */
const MEET_MARGIN = 3;

const stepAt = (route: readonly Tile[], j: number): [number, number] => {
  const t = route[j]!;
  const n = route[Math.min(j + 1, route.length - 1)]!;
  const p = route[Math.max(j - 1, 0)]!;
  return n.x !== t.x || n.y !== t.y ? [n.x - t.x, n.y - t.y] : [t.x - p.x, t.y - p.y];
};

/** Where an aircraft will be over the next tiles: tile → how many tiles from now it gets there, and its direction. */
type Path = Map<string, { readonly d: number; readonly dir: readonly [number, number] }>;
function pathAhead(route: readonly Tile[], from: number): Path {
  const out: Path = new Map();
  for (let j = from; j < Math.min(route.length, from + HEAD_ON_HORIZON); j++) {
    const k = `${route[j]!.x},${route[j]!.y}`;
    if (!out.has(k)) out.set(k, { d: j - from, dir: stepAt(route, j) });
  }
  return out;
}

/** Whether two aircraft on these paths would meet nose to nose soon: a tile both reach, in opposite directions, at about the same time, within HEAD_ON_ACT tiles. */
function meets(a: Path, b: Path): boolean {
  for (const [k, pa] of a) {
    if (pa.d > HEAD_ON_ACT) continue;
    const pb = b.get(k);
    if (pb && pa.dir[0] * pb.dir[0] + pa.dir[1] * pb.dir[1] < 0 && Math.abs(pa.d - pb.d) <= MEET_MARGIN) return true;
  }
  return false;
}

/** A detour for an aircraft on `route` (at index i) that keeps clear of `other` in time: a tile it crosses is fine when reached well before or after the other aircraft. */
function detourAround(sim: Simulation, route: readonly Tile[], i: number, other: Path): Tile[] | null {
  const from = Math.min(i + 1, route.length - 1);
  return detour(sim.network, route, from, (k, steps) => {
    const o = other.get(k);
    return !!o && Math.abs(o.d - (steps + from - i)) <= MEET_MARGIN + 1;
  });
}

/**
 * How far a taxiing aircraft may move this step. It detours round a Taxiway closed by an Incident when it can, and
 * keeps in-trail spacing: it stops short of any aircraft ahead of it on its route that stands still (holding short,
 * stopped by an Incident), goes the same way, or waits in line and started waiting before it did (so lines never
 * wait on each other in a circle).
 *
 * Oncoming aircraft never pass on the same Taxiway. When two would meet nose to nose, one gives way: the one not yet
 * on the other's path, else the one that has another way round, else the one with the later id. It takes another
 * Taxiway if it can (crossing the other's path only well before or after it); otherwise it waits short of the other's
 * path until it has passed.
 */
function taxiAhead(sim: MutableSim, f: Mutable<Flight>, now: number, closed: Closures, wanted: number): number {
  let i = Math.floor(f.routeProgress);
  if (closed.incident.size && f.route.some((t, j) => j > i && closed.incident.has(`${t.x},${t.y}`))) {
    const round = detour(sim.network, f.route, Math.min(i + 1, f.route.length - 1), closed.incident);
    if (round) f.route = round;
  }
  let stop = Infinity;
  let mine: Path | undefined;
  const here = f.route[i]!;
  for (const o of closed.occupants) {
    if (o.id === f.id || !o.route || o.index === undefined || !o.path || o.waitingSince !== undefined) continue;
    if (Math.abs(o.at.x - here.x) + Math.abs(o.at.y - here.y) > 2 * HEAD_ON_HORIZON) continue;
    const ours = (mine ??= pathAhead(f.route, i));
    const theirs = o.path;
    if (!meets(ours, theirs)) continue;
    const onTheir = (t: Tile) => around(t).some((k) => theirs.has(k));
    const onMine = (t: Tile) => around(t).some((k) => ours.has(k));
    const meOn = onTheir(f.route[i]!);
    const themOn = onMine(o.at);
    const myWay = detourAround(sim, f.route, i, theirs);
    let iGiveWay: boolean;
    if (meOn !== themOn) iGiveWay = !meOn;
    else {
      const theirWay = detourAround(sim, o.route, o.index, ours);
      iGiveWay = !!myWay !== !!theirWay ? !!myWay : f.id > o.id;
    }
    if (!iGiveWay) continue;
    if (myWay) {
      f.route = myWay;
      i = Math.floor(f.routeProgress);
      mine = undefined;
      continue;
    }
    if (meOn) continue; // stuck on its path with no way round: nothing better to do than carry on
    const j = f.route.findIndex((t, n) => n > i && onTheir(t));
    if (j > 0) stop = Math.min(stop, j - 1);
  }
  const since = f.waitingSince ?? Infinity;
  const blocking = (o: Occupant, j: number): boolean => {
    if (o.id === f.id) return false;
    if (o.waitingSince !== undefined) return o.waitingSince < since || (o.waitingSince === since && o.id < f.id);
    if (!o.heading) return true;
    const dir = stepAt(f.route, j);
    return dir[0] * o.heading[0] + dir[1] * o.heading[1] > 0; // following it (meeting it is handled above)
  };
  const LOOK = 6;
  const ahead = new Set<string>();
  for (let j = i + 1; j < f.route.length; j++) ahead.add(`${f.route[j]!.x},${f.route[j]!.y}`);
  for (let j = i + 1; j <= Math.min(f.route.length - 1, i + LOOK, stop); j++) {
    const t = f.route[j]!;
    if (closed.incident.has(`${t.x},${t.y}`)) { stop = Math.min(stop, j - 1); break; }
    // an aircraft ahead: one on the route itself, or (standing still) right beside it
    const o = closed.occupants.find((o) => near(t, o.at, o.clearance) && (o.heading === null || ahead.has(`${o.at.x},${o.at.y}`)) && blocking(o, j));
    if (o) { stop = Math.min(stop, j - 1); break; }
  }
  if (wanted > stop) {
    f.waitingSince ??= now;
    return Math.max(f.routeProgress, stop);
  }
  f.waitingSince = undefined; // not `delete`: that turns every flight into a slow dictionary object
  return wanted;
}

function stepFlight(sim: MutableSim, f: Mutable<Flight>, now: number, closed: Closures): Mutable<Flight> {
  const stand = standById(sim, f.standId);
  const enter = (phase: FlightPhase) => {
    f.phase = phase;
    f.phaseStart = now;
  };
  if ((f.phase === 'taxiOut' || f.phase === 'holdShort') && isDark(now)) {
    const access = accessOf(sim, f);
    if (!access || !lit(sim, access)) nightTurnBack(sim, f, now);
  }
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
      const access = accessOf(sim, f)!;
      const spot = stand ?? bayById(sim, f.bayId);
      const firstExit = f.exitTile ?? exitFor(access, f.reverse, AIRCRAFT_TYPES[f.type].size);
      const mayday = sim.mayday.includes(f.id);
      // roll on to the next exit if the planned one got blocked; go around only if none is clear (never on a Mayday)
      const exit = outcome === 'incident' || !spot ? firstExit : clearExit(sim, closed, access, f.reverse, f, spot) ?? (mayday ? firstExit : null);
      if (outcome === 'goAround' || !exit) {
        logEvent(sim, now, 'goAround', f);
        releaseSpots(sim, f);
        f.landedSeq = 0;
        enter('holding');
        break;
      }
      if (outcome === 'incident') block(sim, f.runway, incident(sim, f, now, 'incident'));
      countMovement(sim, now);
      f.exitTile = exit;
      f.route = spot ? routeToStand(sim.network, exit, spot) : [exit];
      f.routeProgress = 0;
      enter('taxiIn');
      break;
    }
    case 'taxiIn':
    case 'taxiOut': {
      if (now < f.stoppedUntil) break;
      const size = AIRCRAFT_TYPES[f.type].size;
      const budget = TIMINGS.taxiTilesPerMinute * TIMINGS.taxiSpeedFactor[size] * sim.taxiSpeedFactor * STEP_MINUTES;
      f.routeProgress = taxiAhead(sim, f, now, closed, advanceAlong(f.route, f.routeProgress, budget, TIMINGS.turnTileCost[size]));
      if (f.routeProgress < f.route.length - 1) break;
      if (f.phase === 'taxiOut') {
        // the Runway may have turned round while it was taxiing: carry on to the new hold point
        const access = accessOf(sim, f);
        const hold = access ? holdFor(sim, f, access) : undefined;
        const at = f.route[f.route.length - 1]!;
        if (hold && (hold.x !== at.x || hold.y !== at.y)) {
          f.route = taxiRoute(sim.network, at, hold);
          f.routeProgress = 0;
          break;
        }
        enter('holdShort');
      }
      else if (!f.standId && !f.bayId) {
        // landed on a Mayday with nowhere to park: wait here until a Stand or Holding Bay frees up
        const at = f.route[f.route.length - 1]!;
        const stand = freeFittingStand(sim, f);
        const bay = stand ? undefined : freeFittingBay(sim, f);
        if (stand) {
          sim.standOccupant[stand.id] = f.id;
          f.standId = stand.id;
        } else if (bay) {
          sim.bayOccupant[bay.id] = f.id;
          f.bayId = bay.id;
        } else break;
        f.route = routeToStand(sim.network, at, (stand ?? bay)!);
        f.routeProgress = 0;
      } else enter(f.standId ? 'onStand' : 'inBay');
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
      const out = departureRunway(sim, sim.flights, f, now);
      if (!out) break; // no usable Runway at all
      f.runway = out.index;
      const leave = chooseHold(sim, f, out, (h) => routeFromStand(sim.network, stand!, h));
      f.holdTile = leave.hold;
      f.route = leave.route;
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
        const access = accessOf(sim, f);
        logEvent(sim, now, 'rejectedTakeoff', f);
        if (outcome === 'incident') block(sim, f.runway, incident(sim, f, now, 'incident'));
        // it has braked to a stop and left the Runway at the next exit: taxi back and line up again
        const exit = access ? rejectExit(access, f.reverse, AIRCRAFT_TYPES[f.type].size, holdFor(sim, f, access)) : null;
        let back: { hold: Tile; route: Tile[] } | null = null;
        try {
          back = access && exit ? chooseHold(sim, f, access, (h) => taxiRoute(sim.network, exit, h)) : null;
        } catch {
          back = null;
        }
        if (!back) {
          enter('holdShort');
          break;
        }
        f.holdTile = back.hold;
        f.route = back.route;
        f.routeProgress = 0;
        enter('taxiOut');
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

/**
 * How far along a route an aircraft gets with `budget` tiles' worth of taxiing from `progress`: each tile where the
 * route turns costs `turnCost` instead of 1, so aircraft slow down through turns.
 */
export function advanceAlong(route: readonly Tile[], progress: number, budget: number, turnCost: number): number {
  const last = route.length - 1;
  let at = progress;
  let left = budget;
  while (left > 1e-9 && at < last) {
    const i = Math.floor(at);
    const a = route[i - 1];
    const b = route[i]!;
    const c = route[i + 1]!;
    // the tile being crossed is a turn when the way in and the way out differ
    const turning = !!a && (b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y);
    const cost = turning ? turnCost : 1;
    const step = Math.min(i + 1 - at, left / cost);
    at += step;
    left -= step * cost;
  }
  return Math.min(at, last);
}

/** Approach before the threshold, in world units (drawn descending onto the Runway). */
const APPROACH_UNITS = 60;
/** Touchdown point past the threshold, in world units. */
const TOUCHDOWN_UNITS = 2 * T;

/**
 * A landing over its share `s` (0…1) of the landing time: a steady descent from the approach to touchdown, then braking
 * evenly to taxi speed at the exit (`exitAlong` from the threshold). Altitude 1 at the start of the approach, 0 on the ground.
 */
export function landingPath(exitAlong: number, s: number): { along: number; altitude: number } {
  const air = APPROACH_UNITS + TOUCHDOWN_UNITS;
  const roll = Math.max(1, exitAlong - TOUCHDOWN_UNITS);
  // same speed at touchdown, braking evenly to a stop: the roll takes twice as long per unit as the air part
  const flare = air / (air + 2 * roll);
  if (s < flare) return { along: -APPROACH_UNITS + air * (s / flare), altitude: 1 - s / flare };
  const u = (s - flare) / (1 - flare);
  return { along: TOUCHDOWN_UNITS + roll * (1 - (1 - u) * (1 - u)), altitude: 0 };
}

/** A takeoff over its share `s`: accelerating down the Runway, lifting off after `rotate` units and climbing away. */
export function takeoffPath(total: number, rotate: number, s: number): { along: number; altitude: number } {
  const along = total * s * s;
  return { along, altitude: along <= rotate ? 0 : Math.min(1, (along - rotate) / Math.max(1, total - rotate)) };
}

/** Sets the flight's world position for rendering, as of minute `t`. */
function place(sim: Simulation, f: Mutable<Flight>, t: number): void {
  f.altitude = 0;
  const share = (minutes: number) => Math.min(1, (t - f.phaseStart) / minutes);
  const access = accessOf(sim, f);
  /** Point along the Runway centre line: `along` in world units from its landing threshold. */
  /** Point on the centre line, `d` world units from the threshold of the direction in use. */
  const onRunway = (a: RunwayAccess, reverse: boolean, d: number): Point => {
    const r = a.runway;
    const len = (a.vertical ? r.h : r.w) * T;
    const along = reverse ? len - d : d;
    return a.vertical ? { x: (r.x + r.w / 2) * T, y: r.y * T + along } : { x: r.x * T + along, y: (r.y + r.h / 2) * T };
  };
  const fromStart = (a: RunwayAccess, reverse: boolean, tile: Tile) => {
    const r = a.runway;
    const along = a.vertical ? (tile.y + 0.5 - r.y) * T : (tile.x + 0.5 - r.x) * T;
    return reverse ? (a.vertical ? r.h : r.w) * T - along : along;
  };
  switch (f.phase) {
    case 'landing': {
      if (!access) break;
      const exit = f.exitTile ?? exitFor(access, f.reverse, AIRCRAFT_TYPES[f.type].size);
      const path = landingPath(fromStart(access, f.reverse, exit), share(separationOf(sim).landing));
      f.position = onRunway(access, f.reverse, path.along);
      f.altitude = path.altitude;
      f.heading = landingHeading(access.vertical, f.reverse);
      return;
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
      f.heading = parkedHeading(stand);
      break;
    }
    case 'holdShort':
      f.position = tileCentre(access ? holdFor(sim, f, access) : sim.network.holdPoint);
      f.heading = access?.vertical ? 90 : 180;
      break;
    case 'takeoff': {
      if (!access) break;
      const size = AIRCRAFT_TYPES[f.type].size;
      const lineUp = holdFor(sim, f, access);
      const from = fromStart(access, f.reverse, lineUp);
      const s = share(separationOf(sim).takeoff);
      f.heading = landingHeading(access.vertical, f.reverse);
      if (f.pendingOutcome === 'rejectedTakeoff' || f.pendingOutcome === 'incident') {
        // accelerates, aborts and brakes to a stop at the exit it leaves by
        const stop = fromStart(access, f.reverse, rejectExit(access, f.reverse, size, lineUp));
        f.position = onRunway(access, f.reverse, from + (stop - from) * (s * s * (3 - 2 * s)));
        f.altitude = 0;
        return;
      }
      const to = (access.vertical ? access.runway.h : access.runway.w) * T + 60;
      const path = takeoffPath(to - from, TAKEOFF_TILES[size] * T * 0.8, s);
      f.position = onRunway(access, f.reverse, from + path.along);
      f.altitude = path.altitude;
      return;
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
    runwayReverse: [...prev.runwayReverse], changeoverUntil: [...prev.changeoverUntil],
  };
  const flights = sim.flights as Mutable<Flight>[];
  const holdingTarget = () => {
    const target = targetId ? flights.find((f) => f.id === targetId) : (mostUrgentHolding(sim) as Mutable<Flight> | undefined);
    if (!target || target.phase !== 'holding') throw new Error('No Holding aircraft to target');
    return flights.find((f) => f.id === target.id)!;
  };
  switch (id) {
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

/**
 * The low-fuel decision: `divert` sends the aircraft away now (no fees, no Movement, no fine); `mayday` declares an
 * emergency: it lands next, every Runway stops for it until it is down, and if its landing goes wrong it crashes,
 * having no fuel to go around.
 */
export function resolveFuel(prev: Simulation, choice: 'divert' | 'mayday'): Simulation {
  const alert = prev.pendingAlert;
  if (!alert || alert.kind !== 'fuel') return prev;
  const sim = { ...prev, pendingAlert: null, events: [...prev.events], flights: prev.flights.map((f) => ({ ...f })), standOccupant: { ...prev.standOccupant }, bayOccupant: { ...prev.bayOccupant } } as unknown as MutableSim;
  const f = sim.flights.find((x) => x.id === alert.flightId) as Mutable<Flight> | undefined;
  if (!f || f.phase !== 'holding') return { ...prev, pendingAlert: null };
  if (choice === 'divert') divert(sim, f, prev.clock.minute, 'lowFuel');
  else {
    sim.mayday = [...sim.mayday, f.id];
    f.priority = true;
    logEvent(sim, prev.clock.minute, 'mayday', f);
  }
  return sim as unknown as Simulation;
}

/** Clears a pending Alert so the Day can go on. An Emergency Alert takes its second roll; a low-fuel aircraft declares a Mayday. */
export function acknowledgeAlert(sim: Simulation): Simulation {
  if (sim.pendingAlert?.kind === 'emergency') return resolveEmergency(sim);
  if (sim.pendingAlert?.kind === 'fuel') return resolveFuel(sim, 'mayday');
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
