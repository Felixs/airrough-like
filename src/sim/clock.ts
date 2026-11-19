/** A Day runs from 05:00 to 24:00 in fixed simulation steps. Pure: no rendering or DOM. */

export const DAY_START_MINUTE = 5 * 60;
export const DAY_END_MINUTE = 24 * 60;
/** One simulation step is 15 in-game seconds. */
export const STEP_MINUTES = 0.25;
/** At 1× the simulation runs 30 steps per real second (a Day lasts about 2.5 real minutes). */
const STEPS_PER_REAL_SECOND = 30;

export const SPEEDS = [0, 1, 2, 4] as const;
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
