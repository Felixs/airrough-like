/**
 * Wind over a Day: seeded at the start, drifting a little every few hours, and turning round at a Wind Shift.
 * Runways land and take off into the wind; the Active Direction only switches when the tailwind gets too strong.
 */
import { createRandom, mixSeed } from './random';

export interface Wind {
  /** Where the wind blows from, degrees (0 = north, 90 = east). */
  readonly direction: number;
  readonly knots: number;
}

export interface WindSetup {
  readonly seed: number;
  /** Minutes when a Wind Shift turns the wind round. */
  readonly shifts?: readonly number[];
}

export const WIND_RULES = {
  /** A Runway changes direction once the tailwind for the current direction exceeds this. */
  maxTailwindKnots: 5,
  /** No new Movements on a Runway for this long while it changes direction. */
  changeoverMinutes: 5,
  sampleMinutes: 30,
} as const;

/** Wind every 30 minutes of the Day (index = minute / 30). */
export function windTimeline(setup: WindSetup): Wind[] {
  const rng = createRandom(mixSeed(setup.seed, 0x3171d));
  let direction = Math.round(rng.next() * 36) * 10;
  let knots = 4 + rng.int(15);
  const out: Wind[] = [];
  for (let slot = 0; slot < 48; slot++) {
    const minute = slot * WIND_RULES.sampleMinutes;
    if (slot > 0 && slot % 6 === 0) {
      // drift every 3 hours
      direction += (rng.next() - 0.5) * 60;
      knots = Math.max(2, Math.min(25, knots + rng.int(7) - 3));
    }
    for (const s of setup.shifts ?? []) if (s >= minute && s < minute + WIND_RULES.sampleMinutes) direction += 180;
    out.push({ direction: ((Math.round(direction / 10) * 10) % 360 + 360) % 360, knots });
  }
  return out;
}

/** Headwind component (negative = tailwind) for an aircraft moving on `heading`. */
export function headwind(wind: Wind, heading: number): number {
  return wind.knots * Math.cos(((wind.direction - heading) * Math.PI) / 180);
}

/** Landing headings: a horizontal Runway lands eastbound (09) forward or westbound (27) reversed. */
export function landingHeading(vertical: boolean, reverse: boolean): number {
  return vertical ? (reverse ? 0 : 180) : reverse ? 270 : 90;
}

/** Whether the Runway should now land in its reverse direction. */
export function wantsReverse(wind: Wind, vertical: boolean, currentlyReverse: boolean): boolean {
  const tail = -headwind(wind, landingHeading(vertical, currentlyReverse));
  return tail > WIND_RULES.maxTailwindKnots ? !currentlyReverse : currentlyReverse;
}

/** The designator in use, e.g. "27" or "18". */
export function activeDesignator(vertical: boolean, reverse: boolean): string {
  return vertical ? (reverse ? '36' : '18') : reverse ? '27' : '09';
}
