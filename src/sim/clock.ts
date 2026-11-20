/** A Day runs from 05:00 to 24:00 in fixed simulation steps. Pure: no rendering or DOM. */

export const DAY_START_MINUTE = 5 * 60;
export const DAY_END_MINUTE = 24 * 60;
/** One simulation step is 15 in-game seconds. */
export const STEP_MINUTES = 0.25;
/** At 1× the simulation runs 30 steps per real second (a Day lasts about 2.5 real minutes). */
const STEPS_PER_REAL_SECOND = 30;

export const SPEEDS = [0, 1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

export function parseSpeed(value: string | undefined): Speed | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const n = Number(value);
  return SPEEDS.find((s) => s === n);
}

export interface Day {
  /** Minutes since 00:00. */
  readonly minute: number;
  /** Real milliseconds not yet turned into a step (carried between frames). */
  readonly pendingRealMs: number;
}

export function createDay(): Day {
  return { minute: DAY_START_MINUTE, pendingRealMs: 0 };
}

export function formatClock(day: Day): string {
  const m = Math.floor(day.minute);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function isDayOver(day: Day): boolean {
  return day.minute >= DAY_END_MINUTE;
}

/** Advances the Day by `realMs` of real time at the given speed, in whole fixed steps, stopping at 24:00. */
export function advance(day: Day, realMs: number, speed: Speed): Day {
  if (isDayOver(day)) return day;
  const realMsPerStep = 1000 / STEPS_PER_REAL_SECOND;
  const total = day.pendingRealMs + realMs * speed;
  const stepsLeft = (DAY_END_MINUTE - day.minute) / STEP_MINUTES;
  const steps = Math.min(stepsLeft, Math.floor(total / realMsPerStep + 1e-9));
  return { minute: day.minute + steps * STEP_MINUTES, pendingRealMs: total - steps * realMsPerStep };
}

/** Night darkness the map is drawn under (0 = full daylight). */
export const NIGHT_DARKNESS = 0.6;

/**
 * How the light falls at a time of day: `darkness` (0 in full daylight, up to NIGHT_DARKNESS at night) and `warmth`
 * (0 = blue night, 1 = the orange of sunrise and sunset). Dark until 05:30, sunrise to 07:30, full day until 18:30,
 * low evening light until 20:00, dark again from 21:00.
 */
export function daylight(minute: number): { darkness: number; warmth: number } {
  const ramp = (from: number, to: number) => Math.min(1, Math.max(0, (minute - from) / (to - from)));
  const h = (hours: number) => hours * 60;
  if (minute < h(6.5)) return { darkness: NIGHT_DARKNESS - (NIGHT_DARKNESS - 0.25) * ramp(h(5.5), h(6.5)), warmth: 0.8 * ramp(h(5.5), h(6.5)) };
  if (minute < h(7.5)) return { darkness: 0.25 * (1 - ramp(h(6.5), h(7.5))), warmth: 0.8 };
  if (minute < h(18.5)) return { darkness: 0, warmth: 0 };
  if (minute < h(20)) return { darkness: 0.3 * ramp(h(18.5), h(20)), warmth: 0.8 };
  return { darkness: 0.3 + (NIGHT_DARKNESS - 0.3) * ramp(h(20), h(21)), warmth: 0.8 * (1 - ramp(h(20), h(21))) };
}
