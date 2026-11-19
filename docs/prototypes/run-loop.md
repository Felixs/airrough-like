# Prototype: Run loop

**Question:** Over a 4-Week Run, do Money, Upkeep and the growing Traffic Mix force real Plan Mode choices (no free riches, no death spiral), and does the Run Calendar let the Player see a Boss Day coming and prepare?

**Prototype:** throwaway single page. Each Day auto-plays the Live Day sim (now with Holding Bays, landing-order Stands, a Schedule filtered to what the airport can handle, and Fuel Alerts at Radar 3). It has a Plan Mode shop with first-guess prices and Upkeep, Land Plots as space, a Run Calendar, Day reports, a Score Screen and 4 walkthroughs. Artifact "PROTOTYPE · Run loop": https://claude.ai/artifact/SuD6MMd81rWawAR8QjV5Mk

## Findings from scripted test players (8 seeds each, before playtest)

- **Never building loses** (normal mode), usually on a Week 2 or Week 3 Boss Day. **Building without looking at the Calendar** wins about 3 of 8. **Building and saving for the shown Boss Day** won 8 of 8 in normal mode and 3 of 8 in hard mode. The Run Calendar matters, as intended.
- **Money piles up if unspent** (≈400k by Week 3 when idle). Spending is optional, and the Boss Day punishes not spending.
- **Crash cascade:** one Crash on the only Runway blocks it for 1 h, the planes Holding above run out of fuel, and you get 3 Strikes within the hour. This can end a Run from one unlucky roll. Needs a decision.
- **Single-runway closures** (Infrastructure Twists) are near-certain Run losses without a second Runway or Manual Divert.
- **Space matters:** a second Runway needs a Land Plot first in normal mode.
- **Hard mode starves:** most traffic doesn't come; left alone it loses in Week 1 (2 Stands, no Holding Bays).
- Prototype tweaks: All-Rounder starts with 2 Medium Holding Bays (otherwise the single Cargo Hub Stand kills Week 1). The Crash share of errors was lowered from 3% to 1% to cut pure-luck losses.

## Verdicts (2026-11-19)

- **Normal-mode start:** All-Rounder gets 1 Medium Holding Bay and a second Medium Cargo Hub Stand (not 2 Holding Bays). Re-check with the same 8 seeds: idle still loses every Run, Calendar-aware play still wins 8 of 8.
- **Crash share lowered** (3% → 1% of errors): accepted.

- **New loss rule (replaces Strikes):** a Run is lost by missing a Daily Quota once. The Quota is a share of the Day's full Demand (before filtering), counted in Movements (each landing and takeoff), so an under-built airport can't reach it. See ADR 0002.
- **Crashes cost a Crash Fine:** based on Size Class and escalating with each further Crash in the same Week.
- **Airport Closed:** when no Runway is usable for any reason, low-fuel aircraft divert automatically instead of crashing. Closures hurt through the Quota and lost fees, and can't be used to skip a Boss Day. The proposed "Close the Airport" action is rejected.
- **Fire & Rescue Station:** new upgradeable building that shortens Crash/Incident blockages.
- **Weekday pressure: Strong.** About +50% daily flights, growing faster each Week; Saturday becomes a Rush Day at about 2× a weekday. An unbuilt airport should start failing by mid-Week 2.
- **Hard and Custom modes removed from v1** (parked in later-ideas). v1 has one Starting Airport.

## Round 2: new rules in the prototype (2026-11-19)

Implemented: Daily Quota (75% of Demand in Movements, 90% on Boss Days, one miss loses the Run), Crash Fines (Small 5k / Medium 15k / Large 40k, ×(1 + Crashes already this Week)), Airport Closed auto-divert, Fire & Rescue Station (levels 1–5 cut blockages 60 → 12 min), stronger Demand (30 + 20 per Week flights, Saturday Rush Day ×2), Runway Separation from Radar + Controller Training (landing 4 → 2 min, takeoff 3 → 1 min), and one Starting Airport.

Results over 8 seeds:
- **Quota share:** 60% was trivially met. At 80% even good builders died in Week 1–2. **75% weekdays + 90% Boss Day** gives the intended curve.
- **Never building** loses in Week 2 (Day 6–13) on every seed: weekdays now pressure the Player.
- **Sensible building without reading the Calendar** wins 5 of 8. All 3 losses are a Week 4 Thunderstorm Boss Day without ILS: the Airport is Closed for hours, nobody crashes, but the Boss Day Quota is missed.
- **Sensible building + preparing for the shown Boss Day** wins 8 of 8.
- **The Quota effectively forces Large aircraft by Week 2** (Long Runway 40k + Large Stands), because Large aircraft that can't come are missing Movements.

New open questions:
- **Late-game money explodes:** a sensible builder has ~90k at the start of Week 3, ~600k at the start of Week 4 and up to 1.6M by the end, with almost nothing left to buy. Prices and Upkeep don't scale with traffic. Needs scaling prices/Upkeep or more things to spend on.
- **Crash Fines are irrelevant late** for the same reason.
- **Separation steps** are coarse in a 1-minute simulation. The real game should use finer timing.

## Round 3: prices, Large timing, finer steps (2026-11-19)

Implemented: base prices ×2, and each extra copy of the same Stand, Holding Bay or Runway costs 25% more. Large aircraft appear only from Thursday of Week 2 (4% → 12% by the Week 2 Boss Day). The simulation steps every 15 s, with continuous Runway Separation (landing 4 → 2 min, takeoff 3 → 1.5 min).

Results over 8 seeds:
- **Money is meaningful now:** a sensible builder sits at 100–250k through Weeks 3–4 and spends about 2M over a Run (before: up to 1.6M unspent).
- Never building loses on the first Boss Day or in Week 2. Sensible building without reading the Calendar wins 3 of 8. Calendar-aware building wins 6 of 8.
- **New problem: Crash Fines can explode.** Linear escalation on Large fines (40k × n) plus a flood of Large aircraft gave 30+ Crashes and over 10M Debt on a Week 4 "Surprise rush hour" Boss Day. Fines need a cap or gentler escalation.
- **New problem: one Large Stand invites all Large traffic.** As soon as the airport can handle a Large aircraft at all, every Large flight in Demand comes, even if there is only one Large Stand. They circle and crash. Options: let the Schedule scale Large arrivals with Large capacity, or rely on Holding Bays plus the Fuel Alert.
- **Edge case:** an aircraft whose only fitting Runway is closed (e.g. Long R1 closed, R2 Medium open) is not covered by Airport Closed and can crash. Proposal: divert at minimum fuel when no Runway *that fits it* is usable.

## Round 4: fines, Stand-based traffic, per-size closure (2026-11-19)

Implemented:
- Crash Fines: Small 5k / Medium 10k / Large 20k, +50% for each earlier Crash that Week, capped at ×3.
- The Schedule caps each Size Class (per Purpose) by fitting Stands: about 10 Small, 8 Medium or 6 Large arrivals per Stand per Day. Extra flights don't come and show in the report as "not enough Stands of that size".
- A plane at minimum fuel diverts when no Runway that fits it is usable, not only when the whole airport is Closed.

Results over 8 seeds:
- The worst Debt dropped from 13M to about 0.5M, on an unprepared Week 4 "Surprise rush hour" Boss Day.
- Large arrivals now grow with Large Stands (e.g. Week 3: 7–23 Large per Day).
- Never building loses on the first Boss Day or in Week 2. Sensible building without reading the Calendar wins 2 of 8. Calendar-aware building wins 6 of 8. The two losses are a Week 2 Runway inspection missed by 5 Movements, and a Week 4 Surprise rush hour where runway capacity (not Stands) overflows.
- Open: Severity-4 "Surprise rush hour" may need a counter the Player can see coming (e.g. a second or third Runway), and the autopilot doesn't prepare for it. Worth checking in a real playtest.
