# Airport Auto Battler

A browser roguelite where the Player designs and grows an airport through repeated Day cycles until it misses a Daily Quota.

## Language

### Structure of play

**Run**:
One full attempt, from a fresh Starting Airport until a Daily Quota is missed (or the Player stops after winning four Weeks), followed by the Score Screen and a fresh start.
_Avoid_: Game, campaign, round

**Day**:
One cycle within a Run from 05:00 to 24:00, with traffic ramping up through the day and dying down toward the Curfew.
_Avoid_: Run, shift, level

**Curfew**:
The night closure: no flights before 06:00, no new arrivals entering Holding after 22:00, and every aircraft still airborne at 24:00 is Diverted.
_Avoid_: Night ban, no-fly time

**Week**:
Seven consecutive Days, Monday to Sunday, with traffic ramping up across the Week. Crash Fines reset when a Week ends.
_Avoid_: Stage, chapter

**Rush Day**:
The Saturday of each Week, with about twice the traffic of a normal weekday.
_Avoid_: Peak day, busy day

**Boss Day**:
The Sunday of each Week; the hardest Day of that Week.
_Avoid_: Boss battle, final day

**Daily Quota**:
The minimum number of Movements the airport must handle in a Day, set as a share of that Day's Demand and shown in the Run Calendar. Missing it once loses the Run.
_Avoid_: Target, goal, minimum

**Movement**:
One landing or one takeoff; the unit the Daily Quota counts.
_Avoid_: Flight handled, operation

**Schedule**:
The flights that actually come on a Day: the Day's Demand minus aircraft the airport can't handle, and capped per Size Class by how many fitting Stands the airport has (one Large Stand can't attract a flood of Large aircraft). In Week 1 turned-away flights are swapped for Small aircraft; from Week 2 on they simply don't come, so an under-built airport earns less and struggles to reach the Daily Quota. The Player cannot change it.
_Avoid_: Timetable, traffic plan

**Demand**:
All the flights the difficulty curve wants to send on a Day, before the Schedule removes those the airport can't handle. It grows every Day and peaks on Rush and Boss Days.
_Avoid_: Traffic, full schedule

**Traffic Mix**:
The share of Small, Medium and Large aircraft the difficulty curve asks for on a Day; it shifts toward larger aircraft each Week.
_Avoid_: Plane mix, size distribution

**Run Calendar**:
The overview of all four Weeks of a Run. The current Week is open, showing each Day's Forecast and its Boss Twist from the first Monday so the Player can plan ahead; later Weeks are greyed out.
_Avoid_: Week overview, timeline, map

**Forecast**:
The rough summary of the next Day's Schedule shown in Plan Mode (flight count, size mix, peak hours, Boss Twist).
_Avoid_: Preview, timetable

**Twist**:
An announced modifier on a Day, always shown in the Forecast. Weekdays have a small chance of a Severity-1 Twist.
_Avoid_: Event, mutator, emergency, condition

**Boss Twist**:
The Twist that every Boss Day has, on top of peak traffic. Each Boss Twist belongs to a Twist Family and has a Severity matching the Week (e.g. Weather: Windy in Week 1, Heavy Rain/Crosswind in Week 2, Storm in Week 3, Thunderstorm in Week 4).
_Avoid_: Event, mutator, emergency

**Twist Family**:
A group of Boss Twists that share one theme and scale in Severity. Families: Weather, Infrastructure (Taxiway works up to power outage), Traffic Surge (extra flights up to surprise rush hour).
_Avoid_: Twist category, twist type

**Severity**:
The intensity level (1–4) of a Boss Twist, matching the Week it can appear in.
_Avoid_: Difficulty, tier

**Wind Shift**:
A Twist moment when the wind turns round, so every Runway has to change its Active Direction.
_Avoid_: Runway change, wind change

**Active Direction**:
Which way a Runway is used: aircraft land and take off into the wind (e.g. 09 or 27). The ATC Tower turns a Runway round only when the tailwind gets too strong, with a short changeover in which the Runway takes no new Movements.
_Avoid_: Runway heading, orientation

**Runway Exit**:
A Taxiway connector where landing aircraft leave the Runway. Each aircraft takes the first Exit its Size Class can reach after its landing roll; smaller aircraft can use Exits part-way along.
_Avoid_: Turn-off, high-speed exit

**Endless Mode**:
Optional continuation of a Run after it has been won by surviving four Weeks; played for score until the Run is lost. Traffic keeps rising and Boss Days stack multiple Severity-4 Boss Twists.
_Avoid_: Free play, overtime

**Plan Mode**:
The pause between Days where the Player builds, upgrades and spends money.
_Avoid_: Build phase, shop, downtime

**Live Day**:
The short real-time playthrough of a Day, during which only limited Emergency Actions are possible.
_Avoid_: Simulation, battle

**Emergency Action**:
A Player intervention available during a Live Day, each on its own cooldown. Building is not an Emergency Action.
_Avoid_: Ability, power, skill

**Ground Stop**:
Emergency Action that freezes all taxiing briefly to untangle a jam; always available, long cooldown (about once or twice a Day).
_Avoid_: Freeze, halt

**Rush Turnaround**:
Emergency Action that shortens one aircraft's Turnaround; requires a Ramp Agent Station.
_Avoid_: Speed up, quick turn

**Manual Divert**:
Emergency Action that sends one Holding aircraft away before its Fuel Reserve runs out; requires an Admin Office.
_Avoid_: Divert button, reroute

**Priority Landing**:
Emergency Action that moves one Holding aircraft to the front of the landing queue; requires an Airline Office.
_Avoid_: Fast-track, skip queue

**Fire & Rescue Station**:
An Unlockable building, placed in Build Mode and upgraded in Plan Mode (levels 1–5), that shortens how long Crashes and Incidents block Runways and Taxiways.
_Avoid_: Fire station, crash crew, first responders

**Support Building**:
A small building whose only job is to enable an Emergency Action (Ramp Agent Station, Admin Office, Airline Office). Improving the actions themselves (e.g. shorter cooldowns) is a Boost.
_Avoid_: Utility building, facility

**Emergency Alert**:
An automatic pause triggered when a Crash from an error is about to happen, giving the Player one chance to intervene for a second roll. Radar level 3 covers ATC Errors, level 4 adds Pilot Errors. It does not guarantee prevention, and some Crashes give no Alert at all.
_Avoid_: Warning, slow-mo, save

**Fuel Alert**:
An automatic pause, unlocked at Radar level 3, when a Holding aircraft's Fuel Reserve runs low, so the Player can use Emergency Actions (e.g. Manual Divert, Priority Landing) in time. It gives no second roll.
_Avoid_: Fuel warning, low-fuel pause

**ATC Tower**:
The building that automatically routes every aircraft (Runway, taxi route, Stand). Its Tower Modules decide how many aircraft it can handle and how often it makes mistakes.
_Avoid_: Tower, controller, air traffic control

**Tower Module**:
An upgradeable part of the ATC Tower covering one area: Radar (airborne capacity), Ground Radar (fewer Taxiway Incidents, smoother taxi routing), Weather Station (handling storms), Controller Training (lower base ATC Error chance).
_Avoid_: Tower level, tower upgrade

**Runway Separation**:
The minimum time a landing or takeoff occupies a Runway before the next Movement can use it. Upgrading Radar and Controller Training shortens it, raising each Runway's throughput.
_Avoid_: Spacing, interval, slot time

**Routing Rule**:
A Player-set constraint the ATC Tower follows (e.g. "Runway 2 is cargo only"); unlocked later, not available at the start.
_Avoid_: Policy, setting

**Land Plot**:
A purchasable chunk of grid tiles adjacent to the airport; the Run starts with a small one and more are bought in Plan Mode.
_Avoid_: Land, area, zone, expansion

### Meta-progression

**Air Miles**:
The meta-currency awarded at the end of a Run. Spent in the Main Menu on Unlockables and Boosts.
_Avoid_: Meta-currency, points, gems

**Unlockable**:
A building or feature bought once with Air Miles that is available in every later Run (e.g. Remote Stands, Terminal wings, Support Buildings, Fire & Rescue Station, Tower Modules level 4–5). What the airport needs to run at all (Runways, Taxiways, Contact Stands, Holding Bays, every Runway Surface) is never locked. Boosts for a locked building stay locked until it is unlocked.
_Avoid_: Milestone, unlock, achievement

**Boost**:
A permanent bonus bought with Air Miles in levels, applied from the next Run: stat Boosts (e.g. higher fees, lower Upkeep, faster Turnaround) and starting Boosts (e.g. Starting Money, a starting Holding Bay, better starting Radar).
_Avoid_: Upgrade (that is a Plan Mode purchase), perk, buff, Starting Perk

**Main Menu**:
The screen the game opens on and returns to after a Run: Continue (when a Run is saved), New Run, Unlockables & Boosts, Options, About (with How to play).
_Avoid_: Title screen, home

**Money**:
The in-Run currency earned from fees and spent in Plan Mode; it does not survive the Run.
_Avoid_: Cash, credits, gold

### Aircraft

**Aircraft Type**:
A real-world aircraft model (e.g. Cessna 208, A320, B747-8F), each belonging to one Size Class and one Purpose.
_Avoid_: Plane type, model, archetype

**Size Class**:
Small, Medium or Large; determines which runways and stands an Aircraft Type can use.
_Avoid_: Category, weight class

**Purpose**:
Passenger or Cargo; determines whether a flight needs a Terminal or a Cargo Hub.
_Avoid_: Role, flight type

### Airfield

**Runway**:
A strip where aircraft take off and land, defined by a Runway Length and a Runway Surface.
_Avoid_: Strip, lane

**Crosswind**:
Wind blowing across a Runway rather than along it; raises Go-Around and Pilot Error chances, so Runways in both orientations (horizontal and vertical) pay off.
_Avoid_: Side wind

**Runway Length**:
Short, Medium or Long; a Runway serves its matching Size Class and every smaller one.
_Avoid_: Runway size, runway class

**Runway Surface**:
The upgrade tier of a Runway: Grass (Small only, daylight only), Asphalt (daylight, clear weather), Lit (adds night operations), ILS (adds bad-weather landings and lowers pilot-error chance).
_Avoid_: Runway type, runway level

**Taxiway**:
Tiles connecting Runways to Stands, along which aircraft move on the ground. There is one width, which fits every Size Class.
_Avoid_: Road, path

**Move**:
Relocating an existing building in Plan Mode's Build view; free of charge in v1.
_Avoid_: Relocate, drag

**Terminal**:
The building serving Passenger flights; Contact Stands attach to it.
_Avoid_: Gate building, concourse

**Cargo Hub**:
The building serving Cargo flights; Contact Stands attach to it.
_Avoid_: Cargo ramp, cargo terminal, warehouse

**Building Size**:
Small, Medium or Large tier of a Terminal or Cargo Hub; larger means more and bigger Contact Stands and faster Turnaround.
_Avoid_: Building level, tier

**Stand**:
A parking spot sized Small, Medium or Large where one aircraft stays for its Turnaround. Aircraft are not given a Stand when they land: each landed aircraft takes the next free Stand that fits, in landing order.
_Avoid_: Gate, parking spot, slot

**Holding Bay**:
A buildable waiting spot (Small, Medium or Large) next to a Taxiway, where a landed aircraft waits until a fitting Stand frees up. If no Holding Bay is free either, the aircraft stays in Holding. Holding Bays are numbered B1, B2, B3…
_Avoid_: Penalty box, waiting apron, parking

**Contact Stand**:
A Stand directly attached to a Terminal or Cargo Hub (touching it along at least one full tile, on any side); fastest Turnaround. It opens onto the Taxiway in front of it.
_Avoid_: Gate, jet bridge

**Remote Stand**:
A Stand placed away from the building, served by bus or vehicle; slower Turnaround. An Unlockable.
_Avoid_: Apron spot, overflow parking

**Turnaround**:
The time an aircraft spends on a Stand unloading and loading before it can leave.
_Avoid_: Boarding, dwell time

### Economy

**Arrival Fee**:
Money earned when an aircraft finishes unloading passengers or cargo on its Stand; amount depends on Aircraft Type.
_Avoid_: Landing fee, income

**Departure Fee**:
Money earned when an aircraft takes off; amount depends on Aircraft Type.
_Avoid_: Takeoff fee, handling fee

**Upkeep**:
The daily running cost of every building and Runway, paid at the end of each Day.
_Avoid_: Maintenance, running costs, expenses

**Debt**:
A negative money balance; allowed, but nothing can be built or upgraded while in Debt.
_Avoid_: Bankruptcy, overdraft

**Demolish**:
Removing a building or Runway in Plan Mode for a 50% refund, which also removes its Upkeep.
_Avoid_: Sell, delete

### Safety

**Crash**:
A catastrophic event (fuel exhaustion while Holding, mid-air collision, crash on a Runway) that destroys an aircraft, blocks the Runway until cleared, and costs a Crash Fine.
_Avoid_: Accident, failure

**Crash Fine**:
The Money penalty for a Crash, based on the aircraft's Size Class and rising with each further Crash in the same Week, up to a cap.
_Avoid_: Strike, penalty

**Airport Closed**:
The state when no Runway is usable for any reason (Crash, Twist, darkness). No Movements happen. The same protection applies per aircraft: a Holding aircraft that reaches minimum fuel while no Runway that fits it is usable is Diverted instead of Crashing.
_Avoid_: Shutdown, lockdown

**Incident**:
A non-fatal mishap (e.g. ground collision on a Taxiway, runway overrun) that costs money and blocks tiles for a while. On a Taxiway it closes the Taxiway round the stopped aircraft: others detour round it or wait in line until it is cleared.
_Avoid_: Minor crash, mishap

**Holding**:
Circling in the air near the airport while waiting to land (no Runway free, or neither a Stand nor a Holding Bay free).
_Avoid_: Queue, circling, waiting

**Fuel Reserve**:
The countdown an arriving aircraft has while Holding; when it runs low the aircraft jumps to the front of the landing queue, and at zero it Crashes (or is Diverted if the Airport is Closed).
_Avoid_: Fuel, timer

**Diversion**:
An aircraft leaving for another airport instead of landing: at dusk when no Lit/ILS Runway fits it, at the Curfew, at minimum fuel while the Airport is Closed or no Runway that fits it is usable, or by Manual Divert. Its fees and Movements are lost.
_Avoid_: Reroute, cancellation

**ATC Error**:
A mistake by the ATC Tower at a risky moment (landing, takeoff, Runway crossing); its chance falls as the Tower is upgraded.
_Avoid_: Controller mistake

**Pilot Error**:
A mistake by an aircraft's crew at a risky moment; its chance falls with better Runway Surfaces (e.g. ILS).
_Avoid_: Human error

**Go-Around**:
An aborted landing after which the aircraft returns to Holding; the most common, harmless result of an error.
_Avoid_: Missed approach, abort

**Risk Meter**:
The visible indicator of how likely errors currently are, so Crashes never feel random.
_Avoid_: Danger level, threat

### People

**Starting Airport**:
The layout every Run begins with. In v1 there is one: Medium Asphalt Runway, small Terminal, small Cargo Hub with two Stands, one Medium Holding Bay and an ATC Tower.
_Avoid_: Difficulty, map, scenario

**Player**:
The person playing; designs and manages the airport.
_Avoid_: User

**Score Screen**:
The end-of-Run view: like the Day report for the last Day, marked won or lost, plus the Run's totals, Score and Air Miles awarded. "Finish Run" leads to the Main Menu; a won Run can continue into Endless Mode instead.
_Avoid_: Game over screen, results page

**Score**:
The result of a Run, combining Days survived, Movements handled and total Money earned; Air Miles are derived from it.
_Avoid_: Points, rating
