# Balance lab

How we check that the game is fair and tune its numbers. The game logic (`src/sim/`) is pure and seeded, so the lab
plays whole Runs headless, thousands at a time, with **scripted players**, under **tuning overrides**, and reports how
often each player wins, when and why Runs are lost, and where the money went.

## Running it

- Locally: `npm install`, then `node scripts/balance.mjs [experiment ...|all] --seeds 30 [--workers N]`. It compiles
  `src/sim` into `.balance/` and writes `balance-report/index.html` (tables and charts), `summary.md` and
  `results.json` (every Run, Day by Day).
- On GitHub: Actions → **Balance lab** → Run workflow (pick branch, experiments, seeds). The summary shows on the run
  page; the full report is the `balance-report` artifact.
- A small **balance gate** runs with the normal tests (`src/sim/lab/lab.test.ts`): an idle player must lose within
  the first two Weeks and survive at least two Days.

## Scripted players (`src/sim/lab/players.ts`)

They play Plan Mode; the Live Day plays itself, as for a Player who uses no Emergency Actions. Low fuel: a Mayday when
no other Mayday is waiting, otherwise Divert. Building goes through the game's own build rules (`placer.ts`): a Stand
where one fits, else a new **pier** (a whole Terminal or Cargo Hub, a Taxiway lane in front, a connector to the
network, Land bought as needed), a longer Runway, a **parallel second Runway** below the first (with its Taxiway and a
loop round the old Runway's end), Holding Bays.

| Player | Policy |
|---|---|
| `idle` | builds and buys nothing |
| `reactive` | fixes tomorrow's Money Warnings when it can afford to; Radar 2 with spare money |
| `planner` | the expert reference: Lit first, then Stands for every flight that would be turned away in the next 3 Days and on the Week's Boss Day (saving up when a pier is needed), Long Runway for Large aircraft, Radar 3 + Controller Training 2, ILS before an ILS-only storm, a second Runway once the busiest Day ahead needs more than ~130 Movements per Runway, Holding Bays, then the rest |
| `planner-no-…` | the planner leaving something out (`lit`, `tower`, `secondRunway`, `holdingBays`, `ils`), to measure its value |
| `random` | on half the Days, one random affordable thing |

**Airline Contracts:** every player answers a Contract offer the same way, set per variant (default `best`):
`ignore` (as before Contracts existed: no Contract, no money), `skip` (+$10,000), `first` (sign the first one) or
`best` (sign whichever earns the most over the next Week at the airport as it is, counting one-off money and half a
plot's price for a free Land Plot, against skipping).

## Experiments (`src/sim/lab/experiments.ts`)

Each plays its players in every variant over the same seeds. A variant is a set of overrides of the tuning tables
(`BUILD_COSTS`, `PRICES`, `UPKEEP`, `SCHEDULE_RULES`, `SAFETY`, `ATC`, `TIMINGS`, `AIRCRAFT_TYPES`, `SCORE`), by path,
e.g. `"BUILD_COSTS.stand.medium": 20000`, and the meta-progression to start with (none, or everything bought).
Current set: `baseline`, `meta`, `meta-split`, `growth`, `upgrade-value`, `stand-prices`, `land-price`, `boss-quota`,
`taxi-incidents`, `traffic-growth`, `contracts`. Add one by adding an entry.

## Targets (no meta-progression unless said)

| Player | Target |
|---|---|
| idle | always loses, between Day 3 and Day 14 |
| reactive | wins about 25–35% |
| planner (expert) | wins about 70–80% |
| planner with all Unlockables and Boosts | wins 90% or more |

## Findings so far (20 Nov 2026: all experiments, 30 seeds each, 1,230 Runs in 29 minutes on GitHub)

| Player | Win rate (95% CI) | Median Days survived | Lost most on |
|---|---|---|---|
| idle | 0% | 5 | W1 Sat |
| random | 0% | 6 | W1 Sat |
| reactive | 0% (0–11%) | 19 | W3 Sat |
| planner | 3% (1–17%) | 13 | W2 Sun |
| planner, all Unlockables & Boosts | 47% (30–64%) | 27 | W4 Sun |

- **The scripted players are still weaker than a good human** (you reached the last Boss Day). Read the planner as a
  floor, not the expert target, until it plays better (see next steps).
- **The Week 2 Boss Day is a wall for one Runway.** Almost every loss is "holding": on the busiest Days a single
  Runway can't land everyone before fuel runs out. The planner never gets its second Runway built: the planner without
  it does just as well, because a parallel Runway needs ~4 more Land Plots and Land costs 24k × n (the 3rd–6th plot
  72k–144k each), about 600k with its Taxiways.
- **Land price matters most:** plots at 12k × n lift the planner from 3% to 13%; 36k × n drops it to 0%. Stands −25%
  also gives 13%; a Boss Quota of 85% gives 10%.
- **Meta-progression is strong:** all Unlockables and Boosts take the planner from 3% to 47%. Fire & Rescue, Remote
  Stands and Starting Money are likely the big ones (the next experiment should split them).
- **Taxiway Incident rate barely matters** any more since queues no longer roll them; traffic growth +25/Week ends
  every Run in Week 2.
- **Mayday pile-ups:** answering every low-fuel aircraft with a Mayday (as the plain auto-play did) stops every
  Runway again and again and turns a busy Day into a crash chain. The lab's player diverts while another Mayday waits.
- **Taxiway Incident spiral:** queues of waiting aircraft used to roll Taxiway Incidents too (62 on one Rush Day);
  now only aircraft on the move do.

### Second run (21 Nov 2026, Land now flat 20k, 30 seeds)

- Flat Land alone doesn't move the planner (3%; 16k flat 7%): its money goes to **piers** first. Each new pier is a
  whole Terminal (60k) or Cargo Hub plus ~40k of Taxiway, because the Starting Airport has room for only 3 more
  Contact Stands. It reaches its second Runway (≈ 280k with flat Land) only in Week 3.
- **What each item adds on its own** (planner, from 3%): Remote Stands **23%** (cheap Stands without a pier), Higher
  fees ×3 17%, Cheaper Taxiways ×3 17%, Starting Holding Bay 13%, Better starting Radar 13%, Starting Money ×3 10%,
  Cheaper Land ×3 10%. Support Buildings, Fire & Rescue and Tower 4–5 show nothing because the planner doesn't
  build or use them yet (a gap in the bot, not proof they're worthless).
- So the cost of **adding Stands** is the real wall, more than Land: Remote Stands at 300 Air Miles are by far the
  best buy, and a first Run without them gets stuck.

### Third run (21 Nov 2026: room to grow, free wings, Remote Stands 75% / 2×, flat Land; 30 seeds)

| Player | Win rate (95% CI) | Median Days survived | Lost most on |
|---|---|---|---|
| idle | 0% | 5 | W1 Sat |
| reactive | 0% (0–11%) | 17 | W3 Sat |
| planner | **13% (5–30%)** | **27** | W4 Sun |
| planner + Remote Stands | 17% (7–34%) | 20 | W3 Sun |
| planner, all Unlockables & Boosts | 23% (12–41%) | 27 | W4 Sun |

- Growing the buildings with wings carries the planner to the last Boss Day: median from Day 13 to Day 27, wins 3% → 13%.
- Remote Stands no longer decide Runs (+4 points, within the noise; at the old 50% / 1.5× the same).
- Meta-progression now lifts the planner by about 10 points instead of 44: no single buy is a must-have.
- Still below the targets (planner 70–80%): most losses are "holding" on the last Boss Days. Next: a smarter planner
  (second Runway timing, Holding Bays, using Support Buildings) before judging the late-game difficulty.

## Next steps

1. Decide how adding Stands should work on a first Run: cheaper Taxiways, Remote Stands always available (and the
   Unlockable replaced), or more room for Contact Stands in the Starting Airport. Then re-run.
2. Make the planner build and use Support Buildings and Fire & Rescue, so those items can be priced too.
3. Keep improving the planner towards a real expert (layouts, timing), then check the targets again.
