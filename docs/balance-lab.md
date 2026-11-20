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

## Experiments (`src/sim/lab/experiments.ts`)

Each plays its players in every variant over the same seeds. A variant is a set of overrides of the tuning tables
(`BUILD_COSTS`, `PRICES`, `UPKEEP`, `SCHEDULE_RULES`, `SAFETY`, `ATC`, `TIMINGS`, `AIRCRAFT_TYPES`, `SCORE`), by path,
e.g. `"BUILD_COSTS.stand.medium": 20000`, and the meta-progression to start with (none, or everything bought).
Current set: `baseline`, `meta`, `upgrade-value`, `stand-prices`, `land-price`, `boss-quota`, `taxi-incidents`,
`traffic-growth`. Add one by adding an entry.

## Targets (no meta-progression unless said)

| Player | Target |
|---|---|
| idle | always loses, between Day 3 and Day 14 |
| reactive | wins about 25–35% |
| planner (expert) | wins about 70–80% |
| planner with all Unlockables and Boosts | wins 90% or more |

## Findings so far (Nov 2026, 8 seeds; rerun with more on GitHub)

- The scripted players are still weaker than a good human: the planner wins **0%** with no meta (median 13 Days,
  lost mostly on the Week 2 weekend), the reactive player 0% (median 19 Days). With every Unlockable and Boost the
  planner wins **~50%**. Until the planner is a real expert, its numbers are a floor, not the expert target.
- **A second Runway is out of reach.** Losses are mostly "holding": on Rush and Boss Days one Runway can't land
  everyone before fuel runs out. A parallel Runway needs ~4 more Land Plots, and Land costs 24k × n (the 3rd–6th plot
  cost 72k–144k each), so the Runway with its Taxiways costs ~600k: more than the planner holds by Week 3.
- **Mayday pile-ups:** answering every low-fuel aircraft with a Mayday (as the plain auto-play did) stops every
  Runway again and again and turns a busy Day into a crash chain. The lab's player diverts while another Mayday waits.
- **Taxiway Incident spiral:** queues of waiting aircraft used to roll Taxiway Incidents too (62 on one Rush Day);
  now only aircraft on the move do.
