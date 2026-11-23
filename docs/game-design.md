# Game design: the game as it is built

This is the spec of **Airport Auto Battler as it plays today**, written so the game could be rebuilt on another stack
(e.g. Godot) without reading the TypeScript. Terms are defined in [`CONTEXT.md`](../CONTEXT.md); why things are the
way they are lives in [`adr/`](adr/), and the prototype logs under [`prototypes/`](prototypes/) are history.
Content lists are in [`v1-content.md`](v1-content.md), Unlockables and Boosts in [`meta-progression.md`](meta-progression.md).

Exact tuning numbers live in plain data tables in `src/sim/` (named below as `file → TABLE`); a port copies those
tables as they are. Numbers quoted here are the current values.

## The loop

A **Run** is up to 4 Weeks of 7 Days (`run.ts → WEEKS_TO_WIN`). Each Day is **Plan Mode** (buy and build, read the
Forecast and Run Calendar) followed by a **Live Day** the Player watches but does not steer, except with Emergency
Actions. Missing one Daily Quota loses the Run ([ADR 0002](adr/0002-daily-quota-loss-condition.md)); surviving Week 4
wins it, and the Run may continue in Endless mode. Every Day ends with a Day report; a finished Run ends on the Score
Screen, which turns Score into Air Miles for the meta-progression.

## Time

- A Day runs 05:00–24:00 in fixed steps of 15 in-game seconds (`clock.ts`). At 1× a Day lasts about 2.5 real minutes
  (1× is 450× real time); speeds are pause, Live (real time: one game minute per real minute, for watching traffic),
  1×, 2×, 4×, 8×. The last of 1×–8× played at is remembered for the next Day. Aircraft are drawn gliding between
  steps, so they move smoothly even at Live speed.
- Auto-slow (option): while any aircraft is landing or taking off, the game runs at 1×.
- Operating hours (`simulation.ts → HOURS`): no Movements before 06:00; from 20:00 (dusk) only Lit or ILS Runways
  work; no new arrivals after 22:00; anything still airborne at 24:00 is Diverted (Curfew).
- **Night departures:** after dusk a departure only leaves its Stand for a fitting Lit or ILS Runway. One already
  taxiing to, or holding short of, a Runway that can't be used at night goes to a reachable fitting Lit/ILS Runway
  instead; if there is none it turns round to a free fitting Stand (Contact or Remote; else a Holding Bay), stays
  overnight and leaves the next morning.
- When the game's tab is hidden the browser stops drawing, so the Day pauses; the Options switch "Keep the Day running
  while the game's tab is hidden" runs it on in the background instead.
- The Day ends early once nothing more can happen (last departure gone, the rest parked overnight).
- The game is deterministic: one Run Seed (shown, copyable, replayable) drives every random roll through a seeded RNG.

## The map

- A tile grid (`layout.ts → WORLD`): 96 × 64 tiles, cut into square Land Plots of 16 × 16. The Run starts owning
  plots 0–2 × 0–1 (48 × 32 tiles); more plots are bought in Build Mode, each bordering owned land, at a flat 20,000
  each (`BUILD_COSTS.plotBase`; Cheaper Land Boosts lower it). Plots used to cost 24,000 × how many had been bought,
  which put a second Runway (about 4 plots) out of reach before Week 3.
- **Starting Airport** (`layout.ts → startingAirport`), laid out to grow: a Medium Asphalt Runway (x 6–41, rows
  24–27) with a connector at each end, a parallel Taxiway (rows 18–20, x 6–41), and an apron lane (rows 11–13,
  x 7–43) joined to it by two links (x 15–17 and x 33–35). Along the apron, west to east: the ATC Tower (x 2–4), the
  Terminal (x 8–17) with 2 Small + 1 Medium Contact Stands and room under it for one more, then 12 tiles of **room to
  grow between the two buildings**: two Terminal wings eastward (x 18–23) and two Cargo Hub wings westward
  (x 24–29); then the Cargo Hub (x 30–36) with 1 Medium + 1 Small, and a Small and a Medium Holding Bay (x 39–43). The apron lane already runs the whole frontage, so
  growing the buildings needs only wings (3 × 4, free to build, no Unlockable) and the Contact Stands under them: the
  first place to expand, before Remote Stands or a new pier. (The buildings sit near the middle so taxi routes to the
  Runway stay short; a first version with them at the west end cost the balance lab's players several Days.)
- Structures are axis-aligned tile rectangles: Runway, Taxiway, Terminal, Cargo Hub, Stand, Holding Bay, ATC Tower,
  Support Buildings (Ramp Agent Station, Admin Office, Airline Office, Fire & Rescue Station, Fuel Farm, De-icing Pad).
- **Taxiways** are 3 tiles wide. Touching collinear Taxiway pieces merge into one; so do Terminal or Cargo Hub wings of
  the same height.
- **Stands** are 3 tiles deep and 2 / 3 / 4 wide (Small / Medium / Large); Holding Bays use the same footprints
  (`build.ts → FOOTPRINT`). Each opens on one side, its **facing**, onto the Taxiway tile right in front of the middle
  of that side. On placement the facing is chosen automatically: the side with a Taxiway in front, preferring the side
  away from its building. The footprint turns with the facing.
- A **Contact Stand** is attached when it shares at least one full tile of edge with its Terminal or Cargo Hub, on any
  side. Remote Stands stand free (an Unlockable), cost 75% of a Contact Stand and turn aircraft round 2× slower: a
  stopgap, worse than a Contact Stand (lowered from 50% and 1.5× after the balance lab found them the one item that
  won Runs on its own).
- Build Mode tools: Taxiway, Stands, Holding Bay, Runways, Buildings, Land, Move, Demolish. Tools with variants show
  them as small tiles under the tools, grouped (Stands: Terminal / Cargo × Contact / Remote, each Small / Medium /
  Large; Holding Bays by size; Runways: new 09-27 or 18-36, Medium or Long, Grass strips, Lengthen; Buildings: main
  Terminal / Cargo Hub, wings and Support Buildings). Each tile has a top-down picture, its name and its price;
  tiles that are locked or cost more than the money left after pending changes are greyed out and can't be picked.
  After something is placed the cursor is free (nothing follows it) until the next tool or tile is picked; Demolish
  stays on so several things can be cleared in a row.
- **Main buildings:** a whole Terminal (10 × 4 tiles) or Cargo Hub (7 × 4) can always be built, anywhere and as
  many as wanted, standing alone and with no Unlockable (`build.ts → MAIN_BUILDING`). A wing (3 × 4, smaller) must
  touch a building of its kind; it needs no Unlockable (the Terminal wing and Cargo Hub wing Unlockables were retired
  and their 400 Air Miles each refunded). Price 1,500 per tile. (The Second Terminal Unlockable was
  retired; owners get its 1,500 Air Miles back.)
- **Runway end zones:** nothing (Taxiways included) may be built in the 4 tiles past each end of a Runway, across
  its full width (`layout.ts → RUNWAY_END_CLEAR_TILES`); a new or lengthened Runway also needs its own end zones
  clear. The zones may reach into land not bought yet. Build Mode shows them as red hatching.
- **Zoom and pan in Build Mode:** the wheel or a pinch zooms toward the cursor (from the whole map down to about 12
  tiles across); the right or middle mouse button, Shift-drag or two fingers move the map; the left button (or one
  finger) builds.
- Build Mode: placements are checked (owned land, no overlap, Taxiway access, attachment, Runway end zones) and priced before they are
  confirmed; Demolish refunds what building the same thing again would cost (so removing and rebuilding is free); Move keeps a structure and re-checks it at the new place.
  Changes are pending until confirmed. Leaving Build Mode (switching to Overview or pressing Start Day) with pending
  changes asks: build them (if they can't be built, the reason shows and the Player stays), discard them, or keep
  building.

## Taxiing

- The taxi network is every Taxiway tile; routes are cheapest paths over 4-connected tiles where a step along the
  **centre line** (the yellow line: the middle row/column of each strip, extended into the strips it joins) costs 1 and
  any other tile 6, so aircraft keep to the yellow line and leave it only to turn into a Stand or onto a Runway connector.
  A route into a Stand ends
  with a straight walk from the entry tile to the Stand's centre; aircraft park nose-in, facing away from the open side.
- Aircraft taxi at 6 tiles per minute on straight Taxiway (`TIMINGS.taxiTilesPerMinute`), Large aircraft 15% slower
  (`taxiSpeedFactor`), all slower under the Taxiway-works Twist. A tile where the route turns takes longer to cross
  (`turnTileCost`: 1.3 tiles' worth for Small, 1.6 Medium, 2 Large), as real airliners taxi at about 20 kt straight
  and 10 kt in turns, wide-bodies the most carefully.
- **Taxi Incidents**: the more aircraft taxi at once, the likelier one is stopped by an Incident (lowered by Ground
  Radar). Only aircraft on the move count; ones standing in a queue don't. It stays put for the blockage time (20 min, shortened by the Fire & Rescue Station). While it stands there
  it **closes the whole width of the Taxiway around it**. Every other aircraft whose route runs through the closure
  first looks for a detour round it; if there is none, it stops just short of the closure and waits. Later aircraft
  queue behind the ones already waiting (each only waits for those that started waiting before it, so queues never
  lock up), and all carry on once the Incident is cleared. Waiting aircraft show "Waiting" on their flight strip.
- **In-trail spacing:** every aircraft on the Taxiways claims the tiles round it (2 tiles for Large aircraft, else 1).
  A taxiing aircraft stops short of any aircraft ahead on its route that stands still (holding short, taking off,
  stopped by an Incident), goes the same way, or waits in line and started waiting before it did. So departures line up
  behind the hold point instead of stacking, and lines never wait on each other in a circle. An aircraft taking off
  keeps its hold point claimed until it is airborne or has left the Runway.
- **No passing head-on:** two aircraft that would reach the same tile in opposite directions within 3 tiles' worth of
  taxiing of each other, within the next 16 tiles, would meet. One gives way: the one not yet on the other's path, else the one that has another
  way round, else the one with the later id. It takes another Taxiway if there is one (crossing the other's path only
  well before or after it), otherwise it waits short of the other's path until it has passed. The way round must
  keep clear of the other's whole Taxiway: moving over into the next row of the same 3-wide Taxiway and passing
  doesn't count.

## Runways, wind and direction

- **Designators** (`layout.ts → runwayNames`): horizontal Runways are 09/27, vertical ones 18/36, numbered for the
  direction aircraft land. Parallel Runways get letters as seen on approach (ICAO): two L R, three L C R; from four on
  they are split into groups of up to three and each further group takes the next number (09L 09R 10L 10R). The letter
  swaps at the other end (09L is 27R). The names are painted on the Runway ends (number upright for the landing pilot,
  letter under it), shown on the hold-short signs ("09L-27R") and in the Runway chip.
- Lengths Short / Medium / Long are 24 / 36 / 48 tiles (`BUILD_COSTS.runwayTiles`); a Runway fits aircraft up to
  Small / Medium / Large. **Paved Runways are Medium (80k) or Long (160k); Short is only the Grass strip** (12k, no
  Unlockable): Small aircraft only, daylight only, Pilot Errors ×1.3, never lit, and it can't be lengthened (a longer
  Runway has to be built paved). A paved Runway can be lengthened to Long for the price difference, on either end:
  clicking its west (north) half grows it that way, its east (south) half the other way; the far end stays put.
  Surfaces: Grass, Asphalt, Lit (night operations), ILS (bad-weather landings, fewer Pilot Errors). The Runway Surface
  is an airport-wide upgrade: buying the next level (Asphalt → Lit → ILS) upgrades every paved Runway, and a new paved
  Runway is built with the airport's surface; Grass strips stay Grass. (Paved Short Runways were dropped: they did
  what a Grass strip does. Ones already built keep working and can be lengthened. The Grass strip Unlockable was
  retired; owners get its 300 Air Miles back.)
- **Wind** (`wind.ts`) is random per Day, sampled every 30 minutes and drifting slowly; the Wind Shift Twist turns it
  round. Each Runway lands and takes off into the wind: once the tailwind for its current direction exceeds 5 kt it
  changes direction, and no Movements use it for a 5-minute changeover.
- **Runway Exits**: smaller aircraft need less Runway (`taxi.ts → ROLL_TILES`: 12 / 30 / 44 tiles). A landing aircraft
  leaves at the first connector past its roll distance, measured from the threshold in use. Departures hold short at
  the first connector of the active direction, or make an **Intersection Departure**: any later connector with at
  least the aircraft's takeoff run of Runway ahead (`taxi.ts → TAKEOFF_TILES`: 18 / 30 / 44 tiles) may be used, and
  the departure taxis to whichever of these hold points is the shortest taxi from its Stand. The Tower clears
  departures in the order they reached a hold point, whichever one it is. If the Runway turns round, a departure whose
  hold point no longer has enough Runway ahead goes to the new full-length hold point.
- **Clear exit before landing:** a landing aircraft can take any connector past its landing roll, in the order it
  reaches them; it takes the first that is clear and rolls on past blocked ones. An exit is clear when the first 6
  tiles of the taxi route from it hold no aircraft that is stopped, holding short or waiting in line, no departure is
  on its way to hold short there, and no Incident closes the way to the Stand without a way round. The Tower only
  clears a landing when some exit is clear; otherwise the arrival stays in Holding and the Runway goes to waiting
  departures. If every exit gets blocked while an aircraft is on final, it goes around.

## Flights and ATC

- The Schedule (`schedule.ts → SCHEDULE_RULES`) makes the Day's arrivals from Demand (30 flights + 20 per Week, scaled
  by weekday, ×2 on the Saturday Rush Day), split by Traffic Mix and Purpose and capped by fitting Stands (8–10
  arrivals per Stand by Size Class) and Runways. On the first three Days of a Run, a flight that finds its Stands full
  comes as a Small aircraft instead if Small Stands have room, so an airport left as it is gets through its first Days
  (balance target: unbuilt, it survives at least the first two Days and is lost within the first two Weeks).
- Phases: scheduled → holding → landing → taxi in → (Holding Bay) → on Stand (Turnaround 25 / 40 / 60 min) → taxi out →
  hold short → takeoff → departed; or crashed / diverted.
- The ATC Tower gives each Runway to one aircraft at a time with Runway Separation (landing 4 → 2 min, takeoff 3 →
  1.5 min, improved by Radar and Controller Training). A landed aircraft takes the next free fitting Stand in landing
  order, the smallest that fits first (a bigger one only when no smaller one is free), else a free Holding Bay (also
  smallest first); if neither is free it keeps holding. Low-fuel aircraft get priority; a departure
  held short over 3 minutes goes before normal arrivals.
- **Holding fuel**: each arrival rolls the minutes it can wait in Holding (`schedule.ts → holdingFuelMinutes`): Small
  30–50, Medium 35–55, Large 45–75 (+5 with a Fuel Farm). Real flights hold on their contingency fuel (at least 5% of
  the trip, so long-haul aircraft can hold longer) plus extra fuel the airline loads; alternate fuel and the 30-minute
  final reserve are what they divert on. An aircraft that runs dry while no fitting Runway is usable is Diverted.

## Safety

- Each landing and takeoff rolls ATC Error (1.25%, −15% per Controller Training level, +40% per aircraft over Radar
  capacity) and Pilot Error (0.75%, by surface). An error becomes Go-Around 80% / Incident 19% / Crash 1% on landing,
  Rejected Takeoff 85% / Incident 14% / Crash 1% on takeoff (`simulation.ts → SAFETY`).
- **Rejected Takeoff** (also the takeoff Incident): the aircraft accelerates, aborts and brakes to a stop within its
  roll distance from where it lined up (`ROLL_TILES` 12 / 30 / 44: a Small aircraft stops early, a Large one uses
  nearly all of a Long Runway), leaves at the next connector past that point (or the last one) and taxis back to the
  hold point with the shortest taxi, joining the end of the departure queue.
- **Stories:** every Go-Around, Rejected Takeoff, Incident and Crash gets one line saying what happened, shown in the
  alert and the Day report (`stories.ts → STORIES`): Tower-caused or crew-caused for landings and takeoffs (a vehicle
  on the Runway, a blocked radio call; wind shear, a bird strike, an engine fire warning), and ground trouble on the
  Taxiways (a broken-down tug, a fuel truck in the way, debris). The line is picked from the event itself (seed,
  flight, time), never from the Day's random rolls, so it changes no outcome and a replayed seed tells the same story.
- **Blockages are the only penalty:** Incidents and Crashes cost no money. They block their Runway (or, for a Taxiway
  Incident, the Taxiway round the stopped aircraft) for a time set by the aircraft's Size Class (`simulation.ts →
  SAFETY.blockMinutes`, Small / Medium / Large): Taxiway Incident 10 / 15 / 20 min, Runway Incident 15 / 20 / 30,
  Crash 45 / 60 / 90; each one varies ±30%, picked from the event itself (seed, flight, time) so it draws nothing
  from the Day's random rolls. Fire & Rescue levels cut blockages to as little as 20%. The alert says until when the
  Runway or Taxiway is closed. (Tried against flat 20 / 60 min and a harsher table on 20 unbuilt Runs: the table by
  size played the same as flat times; the harsher one lost a Run on Day 1.)
- From Radar 3/4 the game pauses before an imminent Crash and a second roll can save the aircraft. The game can also
  pause on Incidents, Crashes and Diversions (option).

## Emergency Actions

Rush Turnaround (Ramp Agent Station), Manual Divert (Admin Office), Priority Landing (Airline Office), each with a
cooldown (`simulation.ts → ACTIONS`).

## Low fuel and Mayday

- When a Holding aircraft's fuel drops below 10 minutes the game always pauses (whatever the Radar level or the
  pop-up option) and the Player chooses:
  - **Divert:** it leaves at once. No fees, no Movement, no fine.
  - **Mayday landing:** it lands next. Every Runway stops for it: no other landing or takeoff starts anywhere until it
    is down. Its landing rolls the usual error chances, but a Go-Around becomes a Crash (no fuel to try again). It
    lands even with no Stand or Holding Bay free and then waits by its exit until one frees up. Several Maydays land in
    the order they were declared.
- An aircraft that reaches 5 minutes of fuel while no fitting Runway is usable is still diverted automatically.

## Economy, Quota and Twists

- Money starts at 30,000 (`run.ts → STARTING_MONEY`). Each flight pays an Arrival Fee when unloading finishes and a
  Departure Fee on takeoff (`aircraft.ts → AIRCRAFT_TYPES`). Upkeep is paid at 24:00 (`run.ts → UPKEEP`). Prices are in
  `build.ts → BUILD_COSTS` and `plan.ts → PRICES`. Prices are fixed: a fifth Medium Stand costs what the first did.
  (Costing each extra copy 25% more was dropped as confusing; a typical Week-2 expansion of two Medium Stands, a
  second Medium Runway and a Large Stand costs about 148k instead of 188k.)
- Daily Quota: 75% of the Day's Demand in Movements, 90% on the Sunday Boss Day.
- **Plan Mode Overview** is a dashboard for the next Day, in tabs Overview · Build · Last Day (the Last Day tab shows
  the previous Day's report, Summary and Details, again).
  - **Money Warnings** run across the top (`plan.ts → moneyWarnings`), worst first, each with an icon, what it costs
    in fees (Arrival + Departure Fees of the flights lost, at the typical fee of their size and Purpose), the fix and a
    button (Buy for an upgrade, else Build): the Quota can't be met (even a perfect Day — two Movements per arrival,
    one per overnight aircraft — falls short: red, first); flights that won't come for want of a long enough Runway,
    a Stand big enough at their building, or because the fitting Stands are booked up (each Stand takes about
    10 Small / 8 Medium / 6 Large arrivals a Day), per Purpose with the sizes; evening arrivals (after 20:00) that
    divert without a fitting Lit or ILS Runway (fix: buy Lit). With none, a green line says nothing costs money.
  - **Forecast** in sections: Quota (Daily Quota, most Movements possible), Traffic (Demand, flights coming and turned
    away, peak hour, a Passenger / Cargo × S / M / L table), Money (expected fees, Upkeep, net, money after).
  - **Run Calendar**, large: one button per Day with the Quota big, the Demand ("D 30"), marks for Boss Day ♛, Rush
    Day ⇈ and each Twist's family icon (☁ ⚠ ▲), ✓ / ✗ on played Days, a legend under it; locked Weeks show 🔒.
    Clicking a Day shows it in the **Day detail** card below (the next Day at first): Quota, Demand, result or number
    of Twists as tiles, each Twist with family, Severity and description, and what Rush and Boss Days mean.
  - **Upgrades** grouped Runways (Runway Surface 💡), ATC Tower (Radar 📡, Ground Radar 🛰, Weather Station 🌦,
    Controller Training 🎧), Safety (Fire & Rescue 🚒), each with its icon, price and effect; **Suggested** keeps the
    tips that are not about money tomorrow (Lit Runways, Radar 3, Fire & Rescue).
- **Expected money** (Plan Mode Forecast): the fees the next Day earns if every flight that comes is handled —
  each arrival's Arrival Fee, and the Departure Fee of every aircraft that can still leave that Day (its Turnaround
  ends before dusk, or a fitting Lit/ILS Runway works tonight; overnight aircraft count too). Arrivals after 20:00
  with no fitting Lit/ILS Runway divert and earn nothing. Upkeep is taken off for
  the expected net and the money after the Day. Lost fees from Incidents, Crashes and Diversions are not included.
- Twists (`twists.ts`, Severity 1–4 rising with the Week): Weather, Infrastructure and Traffic Surge families, shown in
  advance on the Run Calendar.

## Presentation

- **View:** the airfield in realistic 3D (ADR 0003). In a Live Day the map fills the whole window and the top bar,
  flight strips, Tower panel and hour bars float over it (the strips and the Tower panel collapse to narrow rails).
  The camera is free: it starts close over the airport, tilted (about 55° from straight down) and framing most of
  it; dragging turns it round, the right button or two fingers move it, the wheel or a pinch zooms (from about 35 m
  to three times the starting distance), and it can't go below about 20° above the ground or wander far off the map.
  "⌂ View" (key V) goes back to the starting view. Far away the airfield fades into haze under a sky that follows the
  Day. Build Mode looks straight down at the whole map without perspective (tiles stay square) and can zoom and pan
  (Controls). Scale: a tile is 16 m, so Medium aircraft fit their 3-tile Stands at real size.
- **Lighting:** physically based materials (painted metal with a clear coat, glass, concrete, grass), a sun that moves
  from east to west through the Day and casts real shadows, sky reflections on paint and glass, tone mapping and a
  soft glow round lights; at the best quality also soft contact shadows where things meet (ambient occlusion). The sun
  is the strong light and the sky only a weaker, cooler fill, so sunlit and shaded sides differ clearly. Glazing is
  tinted mirror glass: by day it shows the sky (lighter towards the top of each pane, pale blue-grey on the façades,
  pale green on the Tower cab) with its bars and floor slabs as matt paint; at night the lit interior shows through.
  The sky the scene reflects is blue overhead, coloured at the horizon (gold at sunrise and sunset) and dull ground
  colour below the horizon.
- **Ground:** mown grass with trees outside a perimeter fence round everything built. Runways are painted asphalt with
  side stripes, centre line, threshold bars, aiming points, rubber in the touchdown zones and their designators upright
  for the landing pilot. Taxiways are one paved surface of light concrete slabs, the same as the aprons and Stands (only
  Runways are dark asphalt); a Taxiway is 3 tiles wide for aircraft, but
  along a side facing open ground its paving (and its blue edge lights) are drawn half a tile in, so a plain Taxiway
  looks 2 tiles wide, half a Runway; where it meets a Stand, Holding Bay, Runway or another Taxiway it is paved right up
  to it. The outside corners of Taxiway ends and turns are rounded (radius half a tile), and every inside corner of a
  junction or turn has a curved fillet about one tile across. Yellow centre lines
  join with curved corners and curved lead-offs at T-junctions (a line never runs on past a corner or junction into
  the end of the strip it meets) and stop at the hold-short lines (two solid and two dashed
  yellow lines across the drawn paving, with a red sign such as "09-27" beside them).
- **Stands and Holding Bays** are concrete pads with a curved yellow lead-in from the lane in front, a stop bar and
  their number (or B1, B2…) at the open side left of the lead-in line; Stands have a red dashed outline, Holding Bays a
  yellow one. Contact Stands at a Terminal get a jet bridge: a rotunda by the building on the left of a parked aircraft,
  a tunnel on a wheeled leg and a cab. At rest it points out along the Stand, angled away from it; once a Medium or
  Large aircraft has stopped on the Stand it swings out until the cab meets the aircraft's front left door, and swings
  back when the aircraft leaves (Small aircraft use stairs: the bridge stays at rest). While an aircraft is on its Stand, ground vehicles stand round it: a pushback tug at
  the nose, belt loaders with a baggage tug and two to four container carts at its holds, often ground power, and for
  Medium and Large aircraft often a fuel truck under the wing and a catering truck at the rear door.
- **Buildings** stand up in 3D at real size (inspired by Berlin Brandenburg Terminal 1, Frankfurt's cargo centres and
  the German standard control tower). Each is turned so its airside faces its Stands or Holding Bays (else a Taxiway,
  else south) and stays inside its footprint, apart from the Terminal's roof edge reaching 2 m over the airside.
  At night glass glows warm from inside and lamps light up.
  - **Terminal** ("Deck"): gate lounges behind glass at apron level, a light stone floor band, a hall about 20 m tall
    glazed with horizontal bars, stone end walls with tall slot windows, and one flat roof deck over everything on
    slender steel columns (a row along the airside and one along the landside, where the deck shelters a drop-off
    kerb). On the roof: three skylight bands (glowing at night), roof plant and TERMINAL; downlights in the deck's
    underside. Wings look the same and join it seamlessly.
  - **Cargo Hub:** a 15 m hall in silver ribbed cladding with a teal band, a dark 30 m high-bay warehouse at the back
    of long hubs, a three-storey glass office head at one end, roller doors on the airside (open ones lit orange at
    night) with yellow lintels and bollards under a canopy with sodium lights, skylights, roof plant and CARGO.
  - **ATC Tower:** a white two-storey base with ribbon windows, a slim round white shaft with a lit stair slit, flared
    equipment floors with a lit window band, a 12-sided cab of outward-sloping green-tinted glass (a faint green glow
    at night), a roof disc with antennas and a radar dome, red obstruction lights, and TWR on the ground.
  - **Support Buildings**, each with its name on the ground in front: Fire & Rescue Station (white with a red band,
    glazed bay doors lit white at night, a drill tower, two crash tenders on the forecourt, a blue beacon); Admin
    Office (four glass storeys behind stone fins); Airline Office (three glass storeys under a bronze crown); Ramp
    Agent Station (a low building with an orange roof edge and a vehicle shed with tugs and baggage carts); Fuel Farm
    (white tanks with a blue band in a bund wall, a pipe rack and a pump house); De-icing Pad (blue-lined pad, two
    boom trucks, glycol tanks).
  - Flood masts stand at the front corners of Terminals and Cargo Hubs; at night their heads glow and the first four
    light the apron round them (real lights, so aircraft and vehicles there are lit too).
- **Grass strips** look like mown grass, not paving: a lighter green strip with mowing bands across it, white
  boundary markers along both edges and a row at each threshold, small designators, no centre line and never lights
  (the Runway Surface upgrade leaves them grass, and its offer says so when the airport has one).
- **Runway lights follow the surface:** none on Grass and Asphalt; white edge and green threshold lights when Lit;
  approach lights added with ILS.
- **Day and night:** during the Live Day the light follows the clock (`clock.ts → daylight`): dark until 05:30, a warm
  sunrise to 07:30, full daylight until 18:30, low warm evening light to 20:00, dark from 21:00. The sun rises in the
  east at 06:00 about 5° high, peaks near 58° at 13:00 and sets in the west at 20:00. Golden hour follows the sun's
  height (strongest below about 12°, gone above about 34°, so roughly 06:00–08:00 and 18:00–20:00): the sunlight turns
  gold and stays strong, so shadows are long and crisp and the walls facing the sun glow, while the sky overhead stays
  blue (a cool fill in the shadows) and only the horizon turns gold. The haze in the distance is pale blue by day and a
  light peach at golden hour (never brown), slightly thinner then; at night it is dark blue. Midday has a little more
  contrast than the rest of the Day. At night the sun gives way to dim blue moonlight, and lights, lit windows and
  glass glow, and pools of warm light lie on the ground: a wide one under every flood mast, a softer one on every
  Stand and a row of small ones along each side of a building that meets paving. The pools are painted on the ground,
  not real lights (aircraft over them are not lit by them, and anything standing on them hides them); they fade in
  with the lit windows at dusk and out at dawn. Plan Mode and Build Mode are in daylight.
- **Aircraft** (`render/aircraftModels.ts`) are 3D models built from each type's real dimensions, with a painted
  livery: Caravan (high wing, nose propeller; the freighter with a belly pod), Q400 (high wing, two propellers,
  T-tail), A320 (rounded nose, sharklets), B737 (pointed nose, split-scimitar winglets), A350 (curled wingtips, dark
  cockpit mask), B777 (raked wingtips, very large engines, blade tail cone), B747-8F (upper-deck hump, four engines).
  Passenger aircraft have rows of cabin windows that light up at night; freighters have none. Liveries are five
  made-up airlines (one of two per passenger type, by the flight's airline; freighters all fly the cargo one), with
  titles, a tail emblem and coloured winglets. Large aircraft are drawn at about 70% of their real size, overhanging
  their 4-tile Stands a little. The gear is down below a third of the climb.
- **Aircraft lights:** red (left) and green (right) wingtip navigation lights and a white tail light at night whenever
  not parked; a flashing red beacon while moving; white strobes double-flashing on the Runway; a landing-light beam
  at night on the Runway and in the air.
- Aircraft in Holding are not drawn; they appear only in the flight strips.
- **Landings and takeoffs:** a landing comes in from 60 world units before the threshold, descending steadily
  to touchdown 2 tiles past it (the first eighth or so of the landing time), then brakes evenly to its exit. A takeoff
  accelerates from its hold point, lifts off after 80% of its takeoff run and climbs until it leaves 60 units past the
  Runway end. The aircraft really rises (up to 45 world units at the edge of the airfield), nose up when climbing,
  with its shadow on the ground below. A Rejected Takeoff speeds up and brakes smoothly to its exit without lifting off.
  Between the simulation's 15-second steps aircraft glide from where they were to where they are. Onto a Stand or
  Holding Bay an aircraft follows the lead-in: a smooth turn off the lane onto the centre line, then straight in, nose
  first. Leaving, it is pushed back straight out along the centre line, tail first, then turns onto the lane.
- **Quality:** the view starts at High (sharp on high-density screens, detailed shadows, edge smoothing, glow) and
  steps down by itself to Medium (normal resolution, coarser shadows, no glow) and then Low (lower resolution, no
  shadows) when frames stay below 45 per second for two seconds. Adding `?quality=high` (or `medium`, `low`) to the
  game's address fixes the level instead.
- **Day report and Score Screen** open on a **Summary** tab and keep the full numbers on a **Details** tab. The Day
  report's Summary shows the Quota result with Movements against the Quota as a bar, then three tiles (Net today with
  the money now; Landed with how many diverted; Safety: Crashes and Incidents, or ✓), and under both tabs the next Day
  with its Twists and the button to plan it. Details lists money (fees, Upkeep, net), traffic (landed by Purpose,
  diversions by reason, parked overnight, busiest hour), every Crash and Incident with its time, and the Run Seed. The
  Score Screen's Summary shows Score, Air Miles earned and Days survived (and, after a loss, how many Movements the last
  Day was short); its Details hold the Run totals and the last Day's details.

## Controls and accessibility

- **Keys in a Live Day:** Space pauses / resumes (to the speed before), 1–5 pick Live / 1× / 2× / 4× / 8×, and D / M
  answer the low-fuel decision (Divert / Mayday), V resets the camera. Build Mode: T S B R U L M D pick tools, 1–9 pick a variant tile, Enter
  confirms, Ctrl Z undoes, Esc frees the cursor; the arrow keys move the map, + and − zoom, F shows the whole map. Buttons name their keys; the Main Menu lists them.
- **Options while playing:** a ⚙ Options button in the Plan Mode header and the Live Day top bar (key O) opens the
  same Options as the Main Menu (speed, pop-ups, music, background running, reduce motion) as a dialog; a running Day
  pauses while it is open and resumes at its speed when it closes (Esc, Close or a click outside). Reset progress
  stays in the Main Menu.
- **Finding an aircraft:** clicking a flight strip (Inbound, Holding or Ground) or an alert about an aircraft picks
  it: its strip is outlined in yellow (the rail opens and scrolls to it) and on the map it gets a gently pulsing yellow
  ring round it (steady with Reduce motion). Clicking it again drops it; it is dropped by itself when
  the aircraft leaves. Picking a Holding aircraft also makes it the target of Manual Divert and Priority Landing.
  Enter or Space on a focused strip or alert does the same.
- **Never colour alone:** Stands and Holding Bays in the side panel say their state in words and a symbol (○ free,
  ◐ due with the arriving callsign, ● with the parked callsign); played Days on the Run Calendar carry ✓ or ✗;
  alerts start with what happened (CRASH, MAYDAY, …).
- **Text** is at least 11 px; the palette keeps every text colour at 6:1 contrast or better on the dark panels.
- **Screen sizes:** below 1200 px wide the side panels narrow and the top bar wraps; below 900 px the map no longer
  fills the window and the Live Day stacks (map on top, flight strips and Tower panel below), Plan Mode becomes one column and Build Mode puts its tools above
  the map.
- **Reduce motion** (Options; follows the system setting until changed): aircraft beacons glow steadily and strobes
  stay off instead of flashing.
- **Music** (Options): three lo-fi 8-bit loops of about a minute each, made live from notes rather than recordings
  (`audio/music.ts → SONGS`): "Tower at Night" (A minor, 72 BPM, 16 bars), "Gate Lounge" (D major, 84 BPM, 20 bars),
  "Red-eye" (E minor, 66 BPM, 16 bars). Each is a one-chord-per-bar progression with a soft square-wave chord pad, a
  triangle bass (root, fifth, root), noise drums (kick on 1 and 3, snare on 2 and 4, hats on the eighths), a
  square-wave melody written from the song's own seed (so it sounds the same every time; it rests for the first two
  bars and the last one), swung eighths, a low-pass filter and a faint vinyl crackle. The Player picks a song (it
  loops), Random (a different random song after each one ends; the default) or Off, and a volume (default 40%). Music
  starts with the first click or key press, and pauses while the tab is hidden unless the Day keeps running there.
- **Unlockables & Boosts:** items that need more Air Miles are dimmed with their price in red; one line above the lists
  says how many Air Miles the Player has. The Main Menu's Play tab also shows the career (Runs played, Air Miles,
  Unlockables and Boost levels owned, the cheapest next item) and the controls.
