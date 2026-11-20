/**
 * Twists: announced modifiers on a Day. Every Boss Day has a Boss Twist from one Twist Family at the Week's
 * Severity; weekdays sometimes get a Severity-1 Twist. Effects are plain inputs to the Schedule and the
 * simulation *(numbers are first guesses)*.
 */
import { createRandom, mixSeed } from './random';
import type { RunwayWindow } from './simulation';

export type TwistFamily = 'weather' | 'infrastructure' | 'surge';

export interface TwistRef {
  readonly family: TwistFamily;
  /** 1–4. */
  readonly severity: number;
}

export interface Twist extends TwistRef {
  readonly name: string;
  readonly description: string;
  readonly boss: boolean;
}

export const FAMILIES: readonly TwistFamily[] = ['weather', 'infrastructure', 'surge'];
export const FAMILY_NAME: Record<TwistFamily, string> = { weather: 'Weather', infrastructure: 'Infrastructure', surge: 'Traffic Surge' };

/** Names and descriptions by Family and Severity 1–4. */
export const BOSS_TWISTS: Record<TwistFamily, ReadonlyArray<{ readonly name: string; readonly description: string }>> = {
  weather: [
    { name: 'Windy', description: 'More Go-Arounds and Pilot Errors.' },
    { name: 'Heavy Rain & Crosswind', description: 'Higher error chances; a Wind Shift closes every Runway for 15 minutes.' },
    { name: 'Storm', description: 'For about three hours only ILS Runways can take landings.' },
    { name: 'Thunderstorm', description: 'ILS-only landings for hours, and the airport closes completely for an hour.' },
  ],
  infrastructure: [
    { name: 'Taxiway works', description: 'Taxiing is slower all Day.' },
    { name: 'Runway inspection', description: 'The main Runway closes for an hour.' },
    { name: 'Runway closure', description: 'The main Runway closes for four hours.' },
    { name: 'Power outage', description: 'No Runway lights or ILS all Day.' },
  ],
  surge: [
    { name: 'Extra flights', description: '15% more flights.' },
    { name: 'More Medium', description: '25% more flights, more of them Medium.' },
    { name: 'Heavy Day', description: '40% more flights, many of them Large.' },
    { name: 'Surprise rush hour', description: '50% more flights in sharp peaks.' },
  ],
};

export const TWIST_RULES = { weekdayChance: 0.2, maxSeverity: 4 } as const;

export function describeTwist(t: TwistRef, boss: boolean): Twist {
  const info = BOSS_TWISTS[t.family][t.severity - 1]!;
  return { ...t, ...info, boss };
}

/** How many Boss Twists a Boss Day stacks: one, then two from Week 5 and three from Week 7 (Endless). */
export function bossTwistCount(week: number): number {
  return week >= 7 ? 3 : week >= 5 ? 2 : 1;
}

/** Every Twist on a Day of a Run (Endless Boss Days stack several). Seeded, so the Run Calendar can show them. */
export function twistsFor(seed: number, week: number, weekday: number): Twist[] {
  if (weekday === 6) {
    const rng = createRandom(mixSeed(seed, week, 0xb055));
    const families = [...FAMILIES];
    const out: Twist[] = [];
    for (let i = 0; i < bossTwistCount(week); i++) {
      const family = families.splice(rng.int(families.length), 1)[0]!;
      out.push(describeTwist({ family, severity: Math.min(TWIST_RULES.maxSeverity, week) }, true));
    }
    return out;
  }
  const one = twistFor(seed, week, weekday);
  return one ? [one] : [];
}

/** The (first) Twist on a Day of a Run, or null. */
export function twistFor(seed: number, week: number, weekday: number): Twist | null {
  if (weekday === 6) return twistsFor(seed, week, weekday)[0] ?? null;
  const rng = createRandom(mixSeed(seed, week, weekday, 0x7715));
  if (rng.next() >= TWIST_RULES.weekdayChance) return null;
  return describeTwist({ family: rng.pick(FAMILIES), severity: 1 }, false);
}

export interface TrafficEffects {
  readonly demandFactor: number;
  /** Share moved from Small to Medium / Large in the Traffic Mix. */
  readonly mediumShift: number;
  readonly largeShift: number;
  /** Spread of the morning and evening peaks in minutes, and the share of flights in each peak. */
  readonly peakSpread: number;
  readonly peakShare: number;
}

const NO_TRAFFIC_EFFECT: TrafficEffects = { demandFactor: 1, mediumShift: 0, largeShift: 0, peakSpread: 75, peakShare: 0.4 };

type TwistInput = TwistRef | readonly TwistRef[] | null | undefined;
const asList = (t: TwistInput): readonly TwistRef[] => (!t ? [] : Array.isArray(t) ? t : [t as TwistRef]);

/** Traffic effects of one or several Twists (combined). */
export function trafficEffects(input: TwistInput): TrafficEffects {
  return asList(input).map(oneTraffic).reduce((a, b) => ({
    demandFactor: a.demandFactor * b.demandFactor,
    mediumShift: a.mediumShift + b.mediumShift,
    largeShift: a.largeShift + b.largeShift,
    peakSpread: Math.min(a.peakSpread, b.peakSpread),
    peakShare: Math.max(a.peakShare, b.peakShare),
  }), NO_TRAFFIC_EFFECT);
}

function oneTraffic(t: TwistRef): TrafficEffects {
  if (t.family !== 'surge') return NO_TRAFFIC_EFFECT;
  switch (t.severity) {
    case 1: return { ...NO_TRAFFIC_EFFECT, demandFactor: 1.15 };
    case 2: return { ...NO_TRAFFIC_EFFECT, demandFactor: 1.25, mediumShift: 0.15 };
    case 3: return { ...NO_TRAFFIC_EFFECT, demandFactor: 1.4, largeShift: 0.15 };
    default: return { ...NO_TRAFFIC_EFFECT, demandFactor: 1.5, peakSpread: 35, peakShare: 0.45 };
  }
}

export interface SimulationEffects {
  readonly riskMultiplier: number;
  readonly windows: readonly RunwayWindow[];
  readonly taxiSpeedFactor: number;
  readonly noLights: boolean;
}

const NO_SIM_EFFECT: SimulationEffects = { riskMultiplier: 1, windows: [], taxiSpeedFactor: 1, noLights: false };

/** Simulation inputs for one or several Twists (combined). The Weather Station (level 1–5) softens Weather. */
export function simulationEffects(input: TwistInput, seed: number, weatherStationLevel: number, deIcing = false): SimulationEffects {
  return asList(input).map((t) => oneSimulation(t, seed, weatherStationLevel, deIcing)).reduce((a, b) => ({
    riskMultiplier: a.riskMultiplier * b.riskMultiplier,
    windows: [...a.windows, ...b.windows],
    taxiSpeedFactor: Math.min(a.taxiSpeedFactor, b.taxiSpeedFactor),
    noLights: a.noLights || b.noLights,
  }), NO_SIM_EFFECT);
}

function oneSimulation(t: TwistRef, seed: number, weatherStationLevel: number, deIcing: boolean): SimulationEffects {
  if (t.family === 'surge') return NO_SIM_EFFECT;
  const rng = createRandom(mixSeed(seed, t.severity, FAMILIES.indexOf(t.family), 0xef));
  const at = (fromHour: number, toHour: number) => Math.round((fromHour + rng.next() * (toHour - fromHour)) * 60);
  if (t.family === 'infrastructure') {
    switch (t.severity) {
      case 1: return { ...NO_SIM_EFFECT, taxiSpeedFactor: 0.6 };
      case 2: {
        const from = at(9, 17);
        return { ...NO_SIM_EFFECT, windows: [{ kind: 'closed', from, to: from + 60, runway: 0 }] };
      }
      case 3: {
        const from = at(8, 14);
        return { ...NO_SIM_EFFECT, windows: [{ kind: 'closed', from, to: from + 240, runway: 0 }] };
      }
      default: return { ...NO_SIM_EFFECT, noLights: true };
    }
  }
  // the Weather Station softens weather risk; a De-icing pad takes off another 30%
  const soften = Math.max(0.4, 1 - 0.15 * (weatherStationLevel - 1)) * (deIcing ? 0.7 : 1);
  const shorten = Math.max(0.5, 1 - 0.1 * (weatherStationLevel - 1));
  const risk = [0.3, 0.6, 0.8, 1.0][t.severity - 1] ?? 1;
  const windows: RunwayWindow[] = [];
  if (t.severity === 2 || t.severity === 4) {
    const shift = at(9, 18);
    windows.push({ kind: 'closed', from: shift, to: shift + 15 });
  }
  if (t.severity >= 3) {
    const from = at(8, 15);
    const length = Math.round(180 * shorten);
    windows.push({ kind: 'ilsOnly', from, to: from + length });
    if (t.severity === 4) {
      const closeFrom = from + Math.round(length / 3);
      windows.push({ kind: 'closed', from: closeFrom, to: closeFrom + Math.round(60 * shorten) });
    }
  }
  return { ...NO_SIM_EFFECT, riskMultiplier: 1 + risk * soften, windows };
}
