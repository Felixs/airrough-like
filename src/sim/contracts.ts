/**
 * Airline Contracts: after winning a Week's Boss Day the Player signs one of three Contracts (or skips for money).
 * A Contract lasts the rest of the Run: it reshapes which flights come (or adds some) and pays a bonus, mostly as
 * higher fees on the flights it is about. Trade-off and growth Contracts are Unlockables. See docs/airline-contracts.md.
 * Numbers are first guesses, checked with the balance lab.
 */
import type { Purpose } from './aircraft';
import type { SizeClass } from './layout';
import type { UnlockableId } from './meta';
import { createRandom, mixSeed } from './random';

export type ContractId =
  | 'freightPartner' | 'cargoConversion' | 'widebodyDeal' | 'regionalShuttle' | 'nightMail' | 'holidayCharter'
  | 'signingBonus' | 'landGrant' | 'hubCarrier' | 'heavyFreight' | 'lowCostBase' | 'expansionDeal';

/** Standard Contracts are there from the first Run; trade-off and growth ones are Unlockables. */
export type ContractKind = 'standard' | 'tradeOff' | 'growth';

/** A fee bonus: flights matching every given field pay `factor` × their fees. */
export interface FeeRule {
  readonly purpose?: Purpose;
  readonly size?: SizeClass;
  /** Only flights arriving at or after this minute. */
  readonly fromMinute?: number;
  /** Only on this weekday (0 = Monday). */
  readonly weekday?: number;
  readonly factor: number;
}

/** Flights a Contract adds on top of Demand (they don't raise the Daily Quota). */
export interface ExtraFlights {
  /** As a share of the Day's Demand. */
  readonly share: number;
  readonly purpose?: Purpose;
  /** Size mix of the extra flights; the Day's own mix when not given. */
  readonly mix?: Readonly<Record<SizeClass, number>>;
  /** Arrival window in minutes; the usual morning and evening peaks when not given. */
  readonly window?: readonly [number, number];
  readonly weekday?: number;
}

/** What all signed Contracts together do to a Day. */
export interface ContractEffects {
  /** × the share of Cargo flights. */
  readonly cargoShareFactor: number;
  /** Share of the remaining Passenger flights that come as Cargo instead. */
  readonly cargoConversion: number;
  /** Added to the Traffic Mix (then scaled back to 100%). */
  readonly sizeAdd: Readonly<Record<SizeClass, number>>;
  /** Share of Cargo flights that come as Large aircraft. */
  readonly cargoLargeShare: number;
  /** × Demand; these flights count towards the Daily Quota. */
  readonly demandFactor: number;
  /** × the Daily Quota. */
  readonly quotaFactor: number;
  readonly extras: readonly ExtraFlights[];
  readonly fees: readonly FeeRule[];
  readonly turnaround: readonly { readonly size: SizeClass; readonly factor: number }[];
}

export const NO_CONTRACT_EFFECTS: ContractEffects = {
  cargoShareFactor: 1, cargoConversion: 0, sizeAdd: { small: 0, medium: 0, large: 0 }, cargoLargeShare: 0,
  demandFactor: 1, quotaFactor: 1, extras: [], fees: [], turnaround: [],
};

export interface ContractDef {
  readonly id: ContractId;
  readonly name: string;
  readonly icon: string;
  readonly kind: ContractKind;
  /** What it gives, at a strength tier (1 after Week 1 … 3 after Week 3 and in Endless). */
  readonly describe: (tier: number) => string;
  /** The downside of a Trade-off Contract. */
  readonly catch?: string;
  readonly effects: (tier: number) => Partial<ContractEffects>;
  /** Money paid once on signing. */
  readonly money?: (tier: number) => number;
  /** Free Land Plots on signing. */
  readonly freePlots?: number;
  /** Can be signed more than once in a Run. */
  readonly repeatable?: boolean;
  /** Only offered when this holds (e.g. a Lit Runway for night flights). */
  readonly needsLitRunway?: boolean;
}

/** Bonuses grow with the Week a Contract is won in: ×1 after Week 1, ×1.25 after Week 2, ×1.5 after Week 3. */
export const tierScale = (tier: number) => 1 + 0.25 * (Math.min(3, Math.max(1, tier)) - 1);
const bonus = (base: number, tier: number) => 1 + base * tierScale(tier);
const pct = (base: number, tier: number) => `+${Math.round(base * tierScale(tier) * 100)}%`;

export const CONTRACT_RULES = {
  /** Money for skipping the pick. */
  skipMoney: 10_000,
  offered: 3,
  /** Last Week (of the regular four) after which a Contract is offered; Endless Weeks always offer one. */
  lastRegularWeek: 3,
} as const;

export const CONTRACTS: readonly ContractDef[] = [
  {
    id: 'freightPartner', name: 'Freight Partner', icon: '📦', kind: 'standard',
    describe: (t) => `+50% Cargo flights; Cargo fees ${pct(0.2, t)}`,
    effects: (t) => ({ cargoShareFactor: 1.5, fees: [{ purpose: 'cargo', factor: bonus(0.2, t) }] }),
  },
  {
    id: 'cargoConversion', name: 'Cargo Conversion', icon: '🔁', kind: 'standard',
    describe: (t) => `25% of Passenger flights come as Cargo; Cargo fees ${pct(0.1, t)}`,
    effects: (t) => ({ cargoConversion: 0.25, fees: [{ purpose: 'cargo', factor: bonus(0.1, t) }] }),
  },
  {
    id: 'widebodyDeal', name: 'Wide-body Deal', icon: '✈', kind: 'standard',
    describe: (t) => `+10% Large aircraft; Large fees ${pct(0.25, t)}`,
    effects: (t) => ({ sizeAdd: { small: 0, medium: 0, large: 0.1 }, fees: [{ size: 'large', factor: bonus(0.25, t) }] }),
  },
  {
    id: 'regionalShuttle', name: 'Regional Shuttle', icon: '🛩', kind: 'standard',
    describe: (t) => `+20% Small aircraft; Small Turnaround −${Math.round(20 * tierScale(t))}%`,
    effects: (t) => ({ sizeAdd: { small: 0.2, medium: 0, large: 0 }, turnaround: [{ size: 'small', factor: 1 - 0.2 * tierScale(t) }] }),
  },
  {
    id: 'nightMail', name: 'Night Mail', icon: '🌙', kind: 'standard', needsLitRunway: true,
    describe: (t) => `Extra Cargo arrivals 20:00–21:45; Cargo arriving after 20:00 pays ${pct(1, t)}`,
    effects: (t) => ({
      extras: [{ share: 0.08, purpose: 'cargo', mix: { small: 0.5, medium: 0.5, large: 0 }, window: [20 * 60, 21 * 60 + 45] }],
      fees: [{ purpose: 'cargo', fromMinute: 20 * 60, factor: bonus(1, t) }],
    }),
  },
  {
    id: 'holidayCharter', name: 'Holiday Charter', icon: '🏖', kind: 'standard',
    describe: (t) => `Rush Day: +30% Passenger flights, their fees ${pct(0.3, t)}`,
    effects: (t) => ({ extras: [{ share: 0.22, purpose: 'passenger', weekday: 5 }], fees: [{ purpose: 'passenger', weekday: 5, factor: bonus(0.3, t) }] }),
  },
  {
    id: 'signingBonus', name: 'Signing Bonus', icon: '💰', kind: 'standard', repeatable: true,
    describe: (t) => `$${(40_000 * tierScale(t)).toLocaleString('en-US')} once; traffic unchanged`,
    effects: () => ({}),
    money: (t) => Math.round(40_000 * tierScale(t)),
  },
  {
    id: 'landGrant', name: 'Land Grant', icon: '🗺', kind: 'standard', repeatable: true,
    describe: () => 'Your next Land Plot is free',
    effects: () => ({}),
    freePlots: 1,
  },
  {
    id: 'hubCarrier', name: 'Hub Carrier', icon: '🏢', kind: 'tradeOff', catch: 'Cargo flights −30%',
    describe: (t) => `Passenger fees ${pct(0.4, t)}`,
    effects: (t) => ({ cargoShareFactor: 0.7, fees: [{ purpose: 'passenger', factor: bonus(0.4, t) }] }),
  },
  {
    id: 'heavyFreight', name: 'Heavy Freight', icon: '🏗', kind: 'tradeOff', catch: 'Large Turnaround +15%',
    describe: (t) => `30% of Cargo flights come as Large aircraft; Cargo fees ${pct(0.4, t)}`,
    effects: (t) => ({ cargoLargeShare: 0.3, fees: [{ purpose: 'cargo', factor: bonus(0.4, t) }], turnaround: [{ size: 'large', factor: 1.15 }] }),
  },
  {
    id: 'lowCostBase', name: 'Low-cost Base', icon: '🎫', kind: 'tradeOff', catch: 'Daily Quota +5%',
    describe: (t) => `+25% Small and Medium Passenger flights, their fees ${pct(0.15, t)}`,
    effects: (t) => ({
      extras: [{ share: 0.25, purpose: 'passenger', mix: { small: 0.5, medium: 0.5, large: 0 } }],
      fees: [{ purpose: 'passenger', size: 'small', factor: bonus(0.15, t) }, { purpose: 'passenger', size: 'medium', factor: bonus(0.15, t) }],
      quotaFactor: 1.05,
    }),
  },
  {
    id: 'expansionDeal', name: 'Expansion Deal', icon: '📈', kind: 'growth',
    describe: (t) => `+15% Demand (the Daily Quota rises with it); all fees ${pct(0.15, t)}`,
    effects: (t) => ({ demandFactor: 1.15, fees: [{ factor: bonus(0.15, t) }] }),
  },
];

/** The Unlockable each kind of Contract needs. */
export const CONTRACT_UNLOCK: Readonly<Record<ContractKind, UnlockableId | null>> = {
  standard: null, tradeOff: 'tradeOffContracts', growth: 'growthContracts',
};

export const contractDef = (id: ContractId): ContractDef => CONTRACTS.find((c) => c.id === id)!;

/** A Contract on offer or signed, with the strength it came with. */
export interface ContractRef {
  readonly id: ContractId;
  readonly tier: number;
}

/** Everything the signed Contracts do together. */
export function contractEffects(signed: readonly ContractRef[] | undefined): ContractEffects {
  let e: ContractEffects = NO_CONTRACT_EFFECTS;
  for (const ref of signed ?? []) {
    const p = contractDef(ref.id).effects(ref.tier);
    e = {
      cargoShareFactor: e.cargoShareFactor * (p.cargoShareFactor ?? 1),
      cargoConversion: 1 - (1 - e.cargoConversion) * (1 - (p.cargoConversion ?? 0)),
      sizeAdd: {
        small: e.sizeAdd.small + (p.sizeAdd?.small ?? 0),
        medium: e.sizeAdd.medium + (p.sizeAdd?.medium ?? 0),
        large: e.sizeAdd.large + (p.sizeAdd?.large ?? 0),
      },
      cargoLargeShare: 1 - (1 - e.cargoLargeShare) * (1 - (p.cargoLargeShare ?? 0)),
      demandFactor: e.demandFactor * (p.demandFactor ?? 1),
      quotaFactor: e.quotaFactor * (p.quotaFactor ?? 1),
      extras: [...e.extras, ...(p.extras ?? [])],
      fees: [...e.fees, ...(p.fees ?? [])],
      turnaround: [...e.turnaround, ...(p.turnaround ?? [])],
    };
  }
  return e;
}

/** × fees for one flight under the signed Contracts. */
export function feeBonus(e: ContractEffects, purpose: Purpose, size: SizeClass, arrivalMinute: number, weekday: number): number {
  return e.fees.reduce((f, r) =>
    (r.purpose === undefined || r.purpose === purpose) && (r.size === undefined || r.size === size) &&
    (r.fromMinute === undefined || arrivalMinute >= r.fromMinute) && (r.weekday === undefined || r.weekday === weekday)
      ? f * r.factor : f, 1);
}

/** × Turnaround for one flight under the signed Contracts. */
export function turnaroundBonus(e: ContractEffects, size: SizeClass): number {
  return e.turnaround.reduce((f, r) => (r.size === size ? f * r.factor : f), 1);
}

/** What the offer may contain. */
export interface OfferContext {
  readonly seed: number;
  /** The Week just won. */
  readonly week: number;
  readonly signed: readonly ContractRef[];
  readonly unlocks: readonly UnlockableId[];
  readonly hasLitRunway: boolean;
}

/** Three Contracts to pick from after winning `week`: at most one Trade-off, none already signed (unless repeatable). */
export function offerContracts(ctx: OfferContext): ContractRef[] {
  const tier = Math.min(3, ctx.week);
  const pool = CONTRACTS.filter((c) => {
    const unlock = CONTRACT_UNLOCK[c.kind];
    return (!unlock || ctx.unlocks.includes(unlock)) &&
      (c.repeatable || !ctx.signed.some((s) => s.id === c.id)) &&
      (!c.needsLitRunway || ctx.hasLitRunway);
  });
  const rng = createRandom(mixSeed(ctx.seed, ctx.week, 0xc0de));
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const out: ContractRef[] = [];
  for (const c of shuffled) {
    if (out.length >= CONTRACT_RULES.offered) break;
    if (c.kind === 'tradeOff' && out.some((o) => contractDef(o.id).kind === 'tradeOff')) continue;
    out.push({ id: c.id, tier });
  }
  return out;
}

/** One line for a Contract: what it gives, and its catch. */
export function contractSummary(ref: ContractRef): string {
  const def = contractDef(ref.id);
  return def.catch ? `${def.describe(ref.tier)}. Catch: ${def.catch}` : def.describe(ref.tier);
}
