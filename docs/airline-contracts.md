# Airline Contracts (design notes)

Agreed with the Player on 2026-11-23 and built the same day. The rules as built are in
[`game-design.md`](game-design.md#airline-contracts); this note keeps why, and what the balance lab found.

## Why

After a Boss Day nothing new happens: the next Week is just more traffic. Contracts are a reward for winning a Week
(like the reward between acts in Slay the Spire) and a way to steer the traffic, so the Player knows which way to grow
the airport for the rest of the Run.

## When and how

- After winning the Boss Day of Weeks 1, 2 and 3 (three picks a Run), and after every Week in Endless Mode.
- Right after the Boss Day's Day report, a "Week won: pick a Contract" screen shows **three** Contract cards: each
  with its bonus, its traffic change and any catch. The Player picks one, or skips and gets **$10,000** instead.
- A signed Contract lasts for the rest of the Run. Contracts stack.
- At most one of the three offered has a catch; it is marked **Trade-off**.
- Later Weeks offer stronger versions: bonuses ×1 after Week 1, ×1.25 after Week 2, ×1.5 after Week 3.

## What a Contract does

- **Traffic:** most Contracts only reshape the traffic (the same number of flights, a different Purpose or Size Class
  mix). A few **growth** Contracts also add flights (e.g. +10% Demand, which raises the Daily Quota with it) for a
  bigger bonus.
- **Bonus:** mostly higher fees for the contracted flights; some give money once, or a free item (e.g. a Land Plot).
- **Catch (Trade-off Contracts only):** a real downside, allowed only when the upside is big enough to balance it.

## Starter pool (about 8, available from the first Run)

| Contract | Effect |
|---|---|
| Freight Partner | +50% Cargo flights; Cargo fees +20% |
| Cargo Conversion | 25% of Passenger flights become Cargo; Cargo fees +10% (every Contract pays something) |
| Wide-body Deal | +10% Large aircraft; Large fees +25% |
| Regional Shuttle | +20% Small aircraft; Small Turnaround −20% |
| Night Mail | some extra Cargo arrivals after 20:00 paying double (only offered with a Lit Runway) |
| Holiday Charter | Passenger flights on the Rush Day ×1.3, their fees +30% that Day |
| Signing Bonus | +$40,000 once; traffic unchanged |
| Land Grant | the next Land Plot bought is free |

## Unlockable Contracts (Air Miles)

Trade-off and growth Contracts are Unlockables, for example:

| Contract | Effect | Catch |
|---|---|---|
| Hub Carrier | Passenger fees +40% | Cargo flights −30% |
| Heavy Freight | +30% Large Cargo; Cargo fees +40% | Large Turnaround +15% |
| Low-cost Base | +25% Small and Medium Passenger flights; their fees +15% | Daily Quota +5% |
| Expansion Deal (Growth) | +15% Demand, the Quota rising with it; all fees +15% | |

## Where Contracts show

- Plan Mode Overview: a Contracts row with an icon per Contract (details on hover or tap).
- The Forecast's traffic numbers already include the Contracts' changes.
- Day report: a line with what Contracts earned that Day.

## Balance

The balance lab's scripted players pick Contracts too (first offered, best fit, or skip). Target: Contracts raise the
planner player's win rate by 5–10 points, not more.

First run (23 Nov 2026, 30 seeds): best fit takes the planner from 7% to 20% (+13 points), signing the first one or
skipping adds 3; Trade-off and Growth Contracts add nothing more for the scripted players. Slightly over the target
but within the noise; details in [`balance-lab.md`](balance-lab.md).
