/**
 * Balance lab: the experiments. Each asks one question by playing every listed player in every variant over the
 * same seeds; a variant is a set of tuning overrides (see tuning.ts) and the meta-progression to start with.
 */
import type { Overrides } from './tuning';

export interface Variant {
  readonly label: string;
  readonly overrides?: Overrides;
  /** Meta-progression: none (a first Run) or every Unlockable and Boost at its top level. */
  readonly meta?: 'none' | 'full';
}

export interface Experiment {
  readonly id: string;
  readonly title: string;
  /** The question it answers. */
  readonly question: string;
  readonly players: readonly string[];
  readonly variants: readonly Variant[];
}

/** Win-rate targets for the current tuning with no meta-progression (see docs/balance-lab.md). */
export const TARGETS = {
  idle: { win: [0, 0], lostBetweenDays: [2, 14] },
  reactive: { win: [0.25, 0.35] },
  planner: { win: [0.7, 0.8] },
  plannerFullMeta: { win: [0.9, 1] },
} as const;

const CURRENT: Variant = { label: 'current' };

export const EXPERIMENTS: readonly Experiment[] = [
  {
    id: 'baseline',
    title: 'Baseline: every player on the current tuning',
    question: 'How do the scripted players fare today, and does each land in its target band?',
    players: ['idle', 'reactive', 'planner', 'random'],
    variants: [CURRENT],
  },
  {
    id: 'meta',
    title: 'Meta-progression',
    question: 'How much do all Unlockables and Boosts lift the expert planner?',
    players: ['planner', 'reactive'],
    variants: [CURRENT, { label: 'all Unlockables & Boosts', meta: 'full' }],
  },
  {
    id: 'upgrade-value',
    title: 'Upgrade value',
    question: 'How much winning does each thing the planner buys add (win rate lost without it, per $1,000 it costs)?',
    players: ['planner', 'planner-no-lit', 'planner-no-tower', 'planner-no-secondRunway', 'planner-no-holdingBays', 'planner-no-ils'],
    variants: [CURRENT],
  },
  {
    id: 'stand-prices',
    title: 'Stand prices',
    question: 'How sensitive is winning to Stand prices?',
    players: ['reactive', 'planner'],
    variants: [
      { label: 'Stands −25%', overrides: { 'BUILD_COSTS.stand.small': 6_000, 'BUILD_COSTS.stand.medium': 12_000, 'BUILD_COSTS.stand.large': 27_000 } },
      CURRENT,
      { label: 'Stands +25%', overrides: { 'BUILD_COSTS.stand.small': 10_000, 'BUILD_COSTS.stand.medium': 20_000, 'BUILD_COSTS.stand.large': 45_000 } },
    ],
  },
  {
    id: 'land-price',
    title: 'Land Plot price',
    question: 'Land gets dearer with every plot (24k × n); does that wall off the second Runway?',
    players: ['planner'],
    variants: [
      { label: 'plots 12k × n', overrides: { 'BUILD_COSTS.plotBase': 12_000 } },
      CURRENT,
      { label: 'plots 36k × n', overrides: { 'BUILD_COSTS.plotBase': 36_000 } },
    ],
  },
  {
    id: 'boss-quota',
    title: 'Boss Day Quota',
    question: 'Is 90% of Demand on Boss Days the right squeeze?',
    players: ['reactive', 'planner'],
    variants: [{ label: 'Boss 85%', overrides: { 'SCHEDULE_RULES.bossQuotaShare': 0.85 } }, CURRENT, { label: 'Boss 95%', overrides: { 'SCHEDULE_RULES.bossQuotaShare': 0.95 } }],
  },
  {
    id: 'taxi-incidents',
    title: 'Taxiway Incident rate',
    question: 'Taxiway Incidents grow with every aircraft on the move; how often should they happen?',
    players: ['reactive', 'planner'],
    variants: [
      CURRENT,
      { label: 'half as often', overrides: { 'SAFETY.taxiIncidentPerAircraft': 0.00025 } },
      { label: 'a fifth as often', overrides: { 'SAFETY.taxiIncidentPerAircraft': 0.0001 } },
    ],
  },
  {
    id: 'traffic-growth',
    title: 'Traffic growth per Week',
    question: 'How steep should Demand rise from Week to Week?',
    players: ['reactive', 'planner'],
    variants: [{ label: '+15 flights/Week', overrides: { 'SCHEDULE_RULES.flightsPerWeek': 15 } }, CURRENT, { label: '+25 flights/Week', overrides: { 'SCHEDULE_RULES.flightsPerWeek': 25 } }],
  },
];

export function experimentById(id: string): Experiment {
  const e = EXPERIMENTS.find((x) => x.id === id);
  if (!e) throw new Error(`Unknown experiment: ${id}. Known: ${EXPERIMENTS.map((x) => x.id).join(', ')}`);
  return e;
}
