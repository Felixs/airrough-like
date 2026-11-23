import { describe, expect, it } from 'vitest';
import { contractEffects, feeBonus, offerContracts, type ContractRef } from './contracts';
import { dayPlan, endDay, estimateDay, signContract, skipContracts, startLiveDay, startRun, type RunState } from './run';
import { applyChange, confirmBuild, nextPlotPrice, openBuild } from './build';

const finish = (run: RunState, movements: number) => {
  const live = startLiveDay(run);
  return endDay(run, { ...live, clock: { ...live.clock, minute: 24 * 60 }, movements });
};
const bossDay = (week: number): RunState => ({ ...startRun(7), week, weekday: 6, dayIndex: week * 7 - 1 });
const cargoShare = (run: RunState) => {
  const f = dayPlan(run).forecast.arrivalsByPurpose;
  const n = (r: Record<string, number>) => r.small! + r.medium! + r.large!;
  return n(f.cargo) / (n(f.cargo) + n(f.passenger));
};

describe('Airline Contract offers', () => {
  it('winning the Boss Day of Weeks 1–3 offers three Contracts', () => {
    for (const week of [1, 2, 3]) {
      const run = finish(bossDay(week), 999);
      expect(run.status).toBe('planning');
      expect(run.contractOffer?.length).toBe(3);
    }
  });

  it('a lost Boss Day, an ordinary Day and the Week 4 win offer none', () => {
    expect(finish(bossDay(2), 0).contractOffer ?? null).toBe(null);
    expect(finish({ ...startRun(7), week: 2, weekday: 3, dayIndex: 10 }, 999).contractOffer ?? null).toBe(null);
    expect(finish(bossDay(4), 999).contractOffer ?? null).toBe(null);
  });

  it('every Endless Week offers one', () => {
    expect(finish({ ...bossDay(5), endless: true }, 999).contractOffer?.length).toBe(3);
  });

  it('offers no Trade-off Contracts without their Unlockable, and at most one with it', () => {
    for (let seed = 1; seed < 40; seed++) {
      const locked = offerContracts({ seed, week: 2, signed: [], unlocks: [], hasLitRunway: true });
      expect(locked.some((c) => ['hubCarrier', 'heavyFreight', 'lowCostBase', 'expansionDeal'].includes(c.id))).toBe(false);
      const open = offerContracts({ seed, week: 2, signed: [], unlocks: ['tradeOffContracts', 'growthContracts'], hasLitRunway: true });
      expect(open.filter((c) => ['hubCarrier', 'heavyFreight', 'lowCostBase'].includes(c.id)).length).toBeLessThanOrEqual(1);
    }
  });

  it('never offers a signed Contract again (unless repeatable), nor Night Mail without a Lit Runway', () => {
    for (let seed = 1; seed < 40; seed++) {
      const offer = offerContracts({ seed, week: 3, signed: [{ id: 'freightPartner', tier: 1 }], unlocks: [], hasLitRunway: false });
      expect(offer.some((c) => c.id === 'freightPartner' || c.id === 'nightMail')).toBe(false);
    }
  });

  it('later Weeks offer stronger Contracts', () => {
    const fees = (tier: number) => feeBonus(contractEffects([{ id: 'freightPartner', tier }]), 'cargo', 'medium', 600, 0);
    expect(fees(1)).toBeCloseTo(1.2);
    expect(fees(3)).toBeCloseTo(1.3);
  });
});

describe('Signing or skipping', () => {
  const offered = (offer: ContractRef[]): RunState => ({ ...startRun(7), week: 2, contractOffer: offer });

  it('signing keeps the Contract and clears the offer; skipping pays $10,000', () => {
    const run = offered([{ id: 'freightPartner', tier: 1 }, { id: 'signingBonus', tier: 1 }, { id: 'landGrant', tier: 1 }]);
    const signed = signContract(run, 0);
    expect(signed.contracts).toEqual([{ id: 'freightPartner', tier: 1 }]);
    expect(signed.contractOffer).toBe(null);
    expect(signed.money).toBe(run.money);
    expect(skipContracts(run).money).toBe(run.money + 10_000);
    expect(skipContracts(run).contracts ?? []).toEqual([]);
  });

  it('a Signing Bonus pays once', () => {
    const run = offered([{ id: 'signingBonus', tier: 2 }]);
    expect(signContract(run, 0).money).toBe(run.money + 50_000);
  });

  it('a Land Grant makes the next Land Plot free, once', () => {
    const run = signContract(offered([{ id: 'landGrant', tier: 1 }]), 0);
    let session = openBuild(run);
    expect(nextPlotPrice(session)).toBe(0);
    session = applyChange(session, { kind: 'buyPlot', plot: { px: 3, py: 0 } });
    expect(nextPlotPrice(session)).toBe(20_000);
    const after = confirmBuild(session);
    expect(after.money).toBe(run.money);
    expect(nextPlotPrice(openBuild(after))).toBe(20_000);
  });
});

describe('What Contracts do to a Day', () => {
  const week2 = (contracts: ContractRef[] = []): RunState => ({ ...startRun(7), week: 2, weekday: 2, dayIndex: 9, contracts });

  it('Freight Partner brings more Cargo flights and they pay more', () => {
    expect(cargoShare(week2([{ id: 'freightPartner', tier: 1 }]))).toBeGreaterThan(cargoShare(week2()));
    const sim = startLiveDay(week2([{ id: 'freightPartner', tier: 1 }]));
    const cargo = sim.flights.find((f) => f.type.endsWith('F'));
    expect(cargo?.feeBonus).toBeCloseTo(1.2);
  });

  it('Cargo Conversion turns Passenger flights into Cargo without changing Demand', () => {
    const plain = dayPlan(week2());
    const converted = dayPlan(week2([{ id: 'cargoConversion', tier: 1 }]));
    expect(converted.demand).toBe(plain.demand);
    expect(converted.quota).toBe(plain.quota);
    expect(cargoShare(week2([{ id: 'cargoConversion', tier: 1 }]))).toBeGreaterThan(cargoShare(week2()));
  });

  it('Holiday Charter adds Passenger flights on the Rush Day only, without raising the Quota', () => {
    const charter: ContractRef[] = [{ id: 'holidayCharter', tier: 1 }];
    const rush = (contracts: ContractRef[]) => dayPlan({ ...week2(contracts), weekday: 5 });
    expect(rush(charter).demand).toBeGreaterThan(rush([]).demand);
    expect(rush(charter).quota).toBe(rush([]).quota);
    expect(dayPlan(week2(charter)).demand).toBe(dayPlan(week2()).demand);
  });

  it('Expansion Deal raises Demand and the Quota with it', () => {
    const deal = dayPlan(week2([{ id: 'expansionDeal', tier: 1 }]));
    expect(deal.demand).toBeGreaterThan(dayPlan(week2()).demand);
    expect(deal.quota).toBeGreaterThan(dayPlan(week2()).quota);
  });

  it('Low-cost Base raises the Quota by 5%', () => {
    expect(dayPlan(week2([{ id: 'lowCostBase', tier: 1 }])).quota).toBe(Math.ceil(dayPlan(week2()).quota * 1.05 - 1e-9));
  });

  it('fee bonuses show in the expected money and are earned in the Live Day', () => {
    const deal = week2([{ id: 'hubCarrier', tier: 1 }]);
    expect(estimateDay(deal).fees).toBeGreaterThan(0);
    const sim = startLiveDay(deal);
    expect(sim.flights.some((f) => (f.feeBonus ?? 1) > 1)).toBe(true);
  });

  it('Regional Shuttle shortens Small Turnarounds', () => {
    const sim = startLiveDay(week2([{ id: 'regionalShuttle', tier: 1 }]));
    expect(sim.flights.filter((f) => (f.turnaroundBonus ?? 1) < 1).length).toBeGreaterThan(0);
  });

  it('without Contracts the Schedule is unchanged', () => {
    const run = week2();
    expect(dayPlan({ ...run, contracts: [] }).schedule).toEqual(dayPlan(run).schedule);
  });
});
