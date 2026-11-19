/**
 * Demand, Traffic Mix, Schedule and Daily Quota for one Day, plus the Forecast summary.
 * Numbers are first guesses from the Run loop prototype (docs/prototypes/run-loop.md).
 */
import { AIRCRAFT_TYPES, sizeRank, type AircraftTypeId, type Purpose } from './aircraft';
import type { AirportLayout, RunwayLength, SizeClass } from './layout';
import { createRandom, mixSeed, type Random } from './random';
import type { ScheduledFlight } from './simulation';
import { trafficEffects, type TrafficEffects, type TwistRef } from './twists';

/** Mon..Sun; Saturday is the Rush Day, Sunday the Boss Day. */
export const DAY_FACTORS = [1, 1.05, 1.1, 1.15, 1.2, 2.0, 1.6] as const;
export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const BOSS_DAY = 6;
export const RUSH_DAY = 5;

export const SCHEDULE_RULES = {
  baseFlights: 30,
  flightsPerWeek: 20,
  quotaShare: 0.75,
  bossQuotaShare: 0.9,
  cargoShare: 0.25,
  overnightShare: 0.12,
  /** Arrivals per fitting Stand per Day, by Size Class. */
  arrivalsPerStand: { small: 10, medium: 8, large: 6 },
  firstArrivalMinute: 6 * 60,
  lastArrivalMinute: 22 * 60,
} as const;

const SIZES: readonly SizeClass[] = ['small', 'medium', 'large'];
const RUNWAY_FITS: Record<RunwayLength, number> = { short: 1, medium: 2, long: 3 };

/** Share of Small / Medium / Large in the Traffic Mix. */
export function trafficMix(week: number, weekday: number): Record<SizeClass, number> {
  if (week <= 1) return { small: 0.6, medium: 0.4, large: 0 };
  if (week === 2) {
    const large = [0, 0, 0, 0.04, 0.06, 0.09, 0.12][weekday] ?? 0;
    return { small: 0.5 - large, medium: 0.5, large };
  }
  if (week === 3) return { small: 0.35, medium: 0.5, large: 0.15 };
  return { small: 0.25, medium: 0.5, large: 0.25 };
}

export type TurnAwayReason = 'noFittingRunway' | 'noFittingStand' | 'standCapacity';

export interface Forecast {
  readonly demand: number;
  readonly quota: number;
  readonly arrivalsBySize: Readonly<Record<SizeClass, number>>;
  readonly turnedAway: Readonly<Record<TurnAwayReason | 'total', number>>;
  /** Hour (0–23) with the most arrivals. */
  readonly peakHour: number;
}

export interface DayPlan {
  readonly week: number;
  readonly weekday: number;
  readonly demand: number;
  readonly quota: number;
  /** Sorted by arrival; overnight aircraft first. */
  readonly schedule: readonly ScheduledFlight[];
  readonly forecast: Forecast;
}

export interface DayPlanSetup {
  readonly layout: AirportLayout;
  /** 1-based; Weeks after 4 are Endless and keep the Week 4 mix. */
  readonly week: number;
  /** 0 = Monday … 6 = Sunday. */
  readonly weekday: number;
  readonly seed: number;
  /**
   * Whether some arrivals are instead parked overnight (default true). The Run turns this off after its
   * first Day, because last night's real aircraft carry over.
   */
  readonly includeOvernight?: boolean;
  /** The Day's Twist; a Traffic Surge changes Demand, mix and peaks. */
  readonly twist?: TwistRef | null;
}

export function demandFor(week: number, weekday: number): number {
  return Math.round((SCHEDULE_RULES.baseFlights + SCHEDULE_RULES.flightsPerWeek * (week - 1)) * (DAY_FACTORS[weekday] ?? 1));
}

export function quotaFor(demand: number, weekday: number): number {
  const share = weekday === BOSS_DAY ? SCHEDULE_RULES.bossQuotaShare : SCHEDULE_RULES.quotaShare;
  return Math.ceil(demand * 2 * share - 1e-9);
}

const TYPES_BY = (size: SizeClass, purpose: Purpose) =>
  (Object.keys(AIRCRAFT_TYPES) as AircraftTypeId[]).filter((id) => AIRCRAFT_TYPES[id].size === size && AIRCRAFT_TYPES[id].purpose === purpose);

function pickSize(rng: Random, mix: Record<SizeClass, number>): SizeClass {
  let r = rng.next();
  for (const s of SIZES) {
    r -= mix[s];
    if (r < 0) return s;
  }
  return 'medium';
}

/** Morning and evening peaks with some traffic all day. */
function arrivalMinute(rng: Random, traffic: TrafficEffects): number {
  const { firstArrivalMinute: lo, lastArrivalMinute: hi } = SCHEDULE_RULES;
  const { peakShare: p, peakSpread: sd } = traffic;
  for (;;) {
    const r = rng.next();
    const m = r < p ? 8.5 * 60 + rng.normal() * sd : r < 2 * p ? 17.75 * 60 + rng.normal() * sd : lo + rng.next() * (hi - lo);
    if (m >= lo && m < hi) return Math.floor(m);
  }
}

export function planDay(setup: DayPlanSetup): DayPlan {
  const { layout, week, weekday } = setup;
  const rng = createRandom(mixSeed(setup.seed, week, weekday));
  const traffic = trafficEffects(setup.twist);
  const demand = Math.round(demandFor(week, weekday) * traffic.demandFactor);
  const quota = quotaFor(demand, weekday);
  const baseMix = trafficMix(week, weekday);
  const shift = Math.min(baseMix.small - 0.05, traffic.mediumShift + traffic.largeShift);
  const mix = {
    small: baseMix.small - shift,
    medium: baseMix.medium + Math.min(shift, traffic.mediumShift),
    large: baseMix.large + Math.max(0, shift - traffic.mediumShift),
  };

  const longestRunway = Math.max(0, ...layout.runways.map((r) => RUNWAY_FITS[r.length]));
  const fittingStands = (size: SizeClass, purpose: Purpose) =>
    layout.stands.filter((s) => s.serves === (purpose === 'passenger' ? 'terminal' : 'cargoHub') && sizeRank(s.size) >= sizeRank(size));
  const reasonAgainst = (size: SizeClass, purpose: Purpose): TurnAwayReason | null =>
    sizeRank(size) > longestRunway ? 'noFittingRunway' : fittingStands(size, purpose).length === 0 ? 'noFittingStand' : null;

  const turnedAway: Record<TurnAwayReason, number> = { noFittingRunway: 0, noFittingStand: 0, standCapacity: 0 };
  const arrivals = new Map<string, number>();
  const overnightStandsLeft = new Map<string, Set<string>>(); // purpose → free stand ids for overnight aircraft
  const flights: ScheduledFlight[] = [];

  for (let i = 0; i < demand; i++) {
    let size = pickSize(rng, mix);
    const purpose: Purpose = rng.next() < SCHEDULE_RULES.cargoShare ? 'cargo' : 'passenger';
    const overnightRoll = rng.next();
    const minute = arrivalMinute(rng, traffic);
    const typeRoll = rng.next();

    let reason = reasonAgainst(size, purpose);
    if (reason && week <= 1 && !reasonAgainst('small', purpose)) {
      size = 'small';
      reason = null;
    }
    if (reason) {
      turnedAway[reason]++;
      continue;
    }
    const capKey = `${size}/${purpose}`;
    const cap = fittingStands(size, purpose).length * SCHEDULE_RULES.arrivalsPerStand[size];
    if ((arrivals.get(capKey) ?? 0) >= cap) {
      turnedAway.standCapacity++;
      continue;
    }
    arrivals.set(capKey, (arrivals.get(capKey) ?? 0) + 1);

    const types = TYPES_BY(size, purpose);
    const type = types[Math.floor(typeRoll * types.length)]!;
    // Overnight aircraft need a Stand free at 05:00; smallest fitting Stand first, like the simulation.
    let overnight = false;
    if (setup.includeOvernight !== false && overnightRoll < SCHEDULE_RULES.overnightShare) {
      if (!overnightStandsLeft.has(purpose)) overnightStandsLeft.set(purpose, new Set(fittingStands('small', purpose).map((s) => s.id)));
      const free = overnightStandsLeft.get(purpose)!;
      const stand = fittingStands(size, purpose)
        .filter((s) => free.has(s.id))
        .sort((a, b) => sizeRank(a.size) - sizeRank(b.size))[0];
      if (stand) {
        free.delete(stand.id);
        overnight = true;
      }
    }
    flights.push(overnight ? { id: '', type, arrivalMinute: 0, overnight: true } : { id: '', type, arrivalMinute: minute });
  }

  flights.sort((a, b) => a.arrivalMinute - b.arrivalMinute);
  const schedule = flights.map((f, i) => ({ ...f, id: `${f.type}-${i + 1}` }));
  const arrivalsBySize = { small: 0, medium: 0, large: 0 };
  const perHour = new Array<number>(24).fill(0);
  for (const f of schedule) {
    arrivalsBySize[AIRCRAFT_TYPES[f.type].size]++;
    if (!f.overnight) perHour[Math.floor(f.arrivalMinute / 60)]!++;
  }
  const total = turnedAway.noFittingRunway + turnedAway.noFittingStand + turnedAway.standCapacity;
  return {
    week,
    weekday,
    demand,
    quota,
    schedule,
    forecast: { demand, quota, arrivalsBySize, turnedAway: { ...turnedAway, total }, peakHour: perHour.indexOf(Math.max(...perHour)) },
  };
}
