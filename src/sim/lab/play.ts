/**
 * Balance lab: plays one Run with a scripted player and records what happened, Day by Day.
 */
import { BOOSTS, emptyMeta, UNLOCKABLES, type MetaState } from '../meta';
import { dayPlan, dayTwists, endDay, estimateDay, signContract, skipContracts, startLiveDay, startRun, WEEKS_TO_WIN, type RunState } from '../run';
import { acknowledgeAlert, daySettled, finishDay, resolveFuel, stepSimulation } from '../simulation';
import { daysAhead, type Player, type Purchase } from './players';
import { withTuning, type Overrides } from './tuning';

export interface DayResult {
  readonly day: number;
  readonly week: number;
  readonly weekday: number;
  readonly quota: number;
  readonly movements: number;
  /** Movements / Quota. */
  readonly margin: number;
  readonly moneyAfter: number;
  /** Flights turned away before the Day (no Stand / Runway for them). */
  readonly turnedAway: number;
  /** The most Movements the Schedule allowed. */
  readonly maxMovements: number;
  readonly diversions: Readonly<Record<string, number>>;
  readonly crashes: number;
  readonly incidents: number;
  readonly twists: readonly string[];
}

/** What cost the Day its Quota, judged from the last Day of a lost Run. */
export type LossCause = 'capacity' | 'darkness' | 'holding' | 'curfew' | 'crashes' | 'throughput';

export interface RunResult {
  readonly player: string;
  readonly variant: string;
  readonly seed: number;
  readonly won: boolean;
  readonly daysSurvived: number;
  /** Day index (0 = Week 1 Monday) of the Day the Quota was missed; null when won. */
  readonly lostOn: number | null;
  readonly lossCause: LossCause | null;
  readonly days: readonly DayResult[];
  readonly purchases: readonly Purchase[];
  readonly finalMoney: number;
  readonly stands: number;
  readonly runways: number;
  /** Airline Contracts signed, in order. */
  readonly contracts: readonly string[];
}

/**
 * How a scripted player answers an Airline Contract offer: ignore it (as before Contracts existed), always skip,
 * sign the first one, or sign the best fit (most money over the next Week at today's airport, against skipping).
 */
export type ContractPolicy = 'ignore' | 'skip' | 'first' | 'best';

/** What signing (or skipping) is worth over the next Week, at the airport as it is. */
function contractValue(run: RunState): number {
  let fees = 0;
  for (let d = 0; d < 7; d++) fees += estimateDay(daysAhead(run, d)).fees;
  return run.money + fees + 20_000 * (run.freePlots ?? 0) * 0.5;
}

export function answerOffer(run: RunState, policy: ContractPolicy): RunState {
  if (!run.contractOffer || policy === 'ignore') return { ...run, contractOffer: null };
  if (policy === 'skip') return skipContracts(run);
  if (policy === 'first') return signContract(run, 0);
  let best = skipContracts(run);
  let bestValue = contractValue(best);
  run.contractOffer.forEach((_, i) => {
    const signed = signContract(run, i);
    const v = contractValue(signed);
    if (v > bestValue) [best, bestValue] = [signed, v];
  });
  return best;
}

/**
 * Plays a Live Day the way a sensible Player answers the low-fuel question: a Mayday when no other Mayday is
 * waiting (every Runway stops for it), otherwise Divert, so Maydays never pile up and stall the airport. Other
 * alerts are acknowledged (Emergency Alerts take the second roll).
 */
export function playLiveDay(run: RunState): RunState {
  let sim = startLiveDay(run);
  while (sim.clock.minute < 24 * 60) {
    if (sim.pendingAlert?.kind === 'fuel') sim = resolveFuel(sim, sim.mayday.length ? 'divert' : 'mayday');
    else if (sim.pendingAlert) sim = acknowledgeAlert(sim);
    else sim = daySettled(sim) ? finishDay(sim) : stepSimulation(sim);
  }
  return endDay(run, sim);
}

/** Meta-progression to start a Run with: none, everything, or a chosen set (one Unlockable or Boost to price it). */
export type MetaSpec = 'none' | 'full' | { readonly unlocks?: readonly string[]; readonly boosts?: Readonly<Record<string, number>> };

/** Meta-progression for an experiment: none, every Unlockable and every Boost at its top level, or a chosen set. */
export function metaFor(kind: MetaSpec): MetaState {
  if (kind === 'none') return emptyMeta();
  if (typeof kind === 'object') return { ...emptyMeta(), unlocks: [...(kind.unlocks ?? [])] as MetaState['unlocks'], boosts: { ...(kind.boosts ?? {}) } as MetaState['boosts'] };
  return {
    ...emptyMeta(),
    unlocks: UNLOCKABLES.map((u) => u.id),
    boosts: Object.fromEntries(BOOSTS.map((b) => [b.id, b.maxLevel])),
  };
}

export function lossCause(d: DayResult): LossCause {
  if (d.maxMovements < d.quota) return 'capacity';
  const lost: Array<[LossCause, number]> = [
    ['darkness', (d.diversions.dark ?? 0) * 2],
    ['holding', ((d.diversions.noRunway ?? 0) + (d.diversions.lowFuel ?? 0) + (d.diversions.manual ?? 0)) * 2],
    ['curfew', (d.diversions.curfew ?? 0) * 2],
    ['crashes', d.crashes * 2 + d.incidents],
  ];
  const [cause, n] = lost.sort((a, b) => b[1] - a[1])[0]!;
  return n >= Math.max(1, d.quota - d.movements) / 2 ? cause : 'throughput';
}

/** Plays a Run of up to `WEEKS_TO_WIN` Weeks with the player's Plan Mode, under the tuning overrides. */
export function playRun(player: Player, seed: number, opts: { overrides?: Overrides; meta?: MetaSpec; variant?: string; contracts?: ContractPolicy } = {}): RunResult {
  return withTuning(opts.overrides ?? {}, () => {
    let run: RunState = startRun(seed, metaFor(opts.meta ?? 'none'));
    const days: DayResult[] = [];
    const purchases: Purchase[] = [];
    const maxDays = WEEKS_TO_WIN * 7;
    while (run.status === 'planning' && days.length < maxDays) {
      if (run.contractOffer) run = answerOffer(run, opts.contracts ?? 'best');
      run = player.plan(run, purchases);
      const forecast = dayPlan(run).forecast;
      const twists = dayTwists(run).map((t) => t.name);
      run = playLiveDay(run);
      const r = run.history[run.history.length - 1]!;
      days.push({
        day: days.length, week: r.week, weekday: r.weekday, quota: r.quota, movements: r.movements, margin: r.movements / Math.max(1, r.quota),
        moneyAfter: r.moneyAfter, turnedAway: forecast.turnedAway.total, maxMovements: forecast.maxMovements,
        diversions: r.diversionsByReason, crashes: r.crashes, incidents: r.highlights.filter((h) => h.kind !== 'crash').length, twists,
      });
    }
    const won = run.status === 'won';
    const last = days[days.length - 1];
    return {
      player: player.id, variant: opts.variant ?? 'current', seed, won, daysSurvived: run.stats.daysSurvived,
      lostOn: run.status === 'lost' && last ? last.day : null,
      lossCause: run.status === 'lost' && last ? lossCause(last) : null,
      days, purchases, finalMoney: run.money, stands: run.layout.stands.length, runways: run.layout.runways.length,
      contracts: (run.contracts ?? []).map((c) => c.id),
    };
  });
}
