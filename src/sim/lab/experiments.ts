/**
 * Balance lab: the experiments. Each asks one question by playing every listed player in every variant over the
 * same seeds; a variant is a set of tuning overrides (see tuning.ts) and the meta-progression to start with.
 */
import { BOOSTS, UNLOCKABLES } from '../meta';
import type { MetaSpec } from './play';
import type { Overrides } from './tuning';

export interface Variant {
  readonly label: string;
  readonly overrides?: Overrides;
  /** Meta-progression: none (a first Run), every Unlockable and Boost at its top level, or a chosen set. */
  readonly meta?: MetaSpec;
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
    id: 'meta-split',
    title: 'Meta-progression, one item at a time',
    question: 'What does each Unlockable and each Boost (at its top level) add on its own?',
    players: ['planner'],
    variants: [
      CURRENT,
      ...UNLOCKABLES.map((u): Variant => ({ label: `+ ${u.name}`, meta: { unlocks: [u.id] } })),
      // Boosts that need a building come with it
      ...BOOSTS.map((b): Variant => ({ label: `+ ${b.name} ×${b.maxLevel}`, meta: { boosts: { [b.id]: b.maxLevel }, unlocks: b.needs ? [b.needs] : [] } })),
    ],
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
    question: 'What should a Land Plot cost, so a second Runway is reachable by Week 2 without making Land trivial?',
    players: ['reactive', 'planner'],
    variants: [
      { label: 'flat 16k', overrides: { 'BUILD_COSTS.plotBase': 16_000 } },
      CURRENT,
      { label: 'flat 24k', overrides: { 'BUILD_COSTS.plotBase': 24_000 } },
      { label: 'rising 24k × n (old)', overrides: { 'BUILD_COSTS.plotGrowth': 1 } },
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
