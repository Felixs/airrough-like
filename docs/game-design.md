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

- A Day runs 05:00–24:00 in fixed steps of 15 in-game seconds (`clock.ts`). At 1× a Day lasts about 2.5 real minutes;
  speeds are pause, 1×, 2×, 4×, 8×. The last speed played at (not pause) is remembered for the next Day.
- Auto-slow (option): while any aircraft is landing or taking off, the game runs at 1×.
- Operating hours (`simulation.ts → HOURS`): no Movements before 06:00; from 20:00 (dusk) only Lit or ILS Runways
  work; no new arrivals after 22:00; anything still airborne at 24:00 is Diverted (Curfew).
- **Night departures:** after dusk a departure only leaves its Stand for a fitting Lit or ILS Runway. One already
  taxiing to, or holding short of, a Runway that can't be used at night goes to a reachable fitting Lit/ILS Runway
  instead; if there is none it turns round to a free fitting Stand (Contact or Remote; else a Holding Bay), stays
  overnight and leaves the next morning.
- The Day ends early once nothing more can happen (last departure gone, the rest parked overnight).
- The game is deterministic: one Run Seed (shown, copyable, replayable) drives every random roll through a seeded RNG.

## The map

- A tile grid (`layout.ts → WORLD`): 96 × 56 tiles, cut into Land Plots of 16 × 14. The Run starts owning plots
  0–2 × 0–1; more plots are bought in Build Mode.
- Structures are axis-aligned tile rectangles: Runway, Taxiway, Terminal, Cargo Hub, Stand, Holding Bay, ATC Tower,
  Support Buildings (Ramp Agent Station, Admin Office, Airline Office, Fire & Rescue Station, Fuel Farm, De-icing Pad).
- **Taxiways** are 3 tiles wide. Touching collinear Taxiway pieces merge into one; so do Terminal or Cargo Hub wings of
  the same height.
- **Stands** are 3 tiles deep and 2 / 3 / 4 wide (Small / Medium / Large); Holding Bays use the same footprints
  (`build.ts → FOOTPRINT`). Each opens on one side, its **facing**, onto the Taxiway tile right in front of the middle
  of that side. On placement the facing is chosen automatically: the side with a Taxiway in front, preferring the side
  away from its building. The footprint turns with the facing.
- A **Contact Stand** is attached when it shares at least one full tile of edge with its Terminal or Cargo Hub, on any
  side. Remote Stands stand free (an Unlockable) and turn round 1.5× slower.
- Build Mode: placements are checked (owned land, no overlap, Taxiway access, attachment) and priced before they are
  confirmed; Demolish refunds the base price; Move keeps a structure and re-checks it at the new place.
  Changes are pending until confirmed. Leaving Build Mode (switching to Overview or pressing Start Day) with pending
  changes asks: build them (if they can't be built, the reason shows and the Player stays), discard them, or keep
  building.

## Taxiing

- The taxi network is every Taxiway tile; routes are cheapest paths over 4-connected tiles where a step along the
  **centre line** (the yellow line: the middle row/column of each strip, extended into the strips it joins) costs 1 and
  any other tile 6, so aircraft keep to the yellow line and leave it only to turn into a Stand or onto a Runway connector.
  A route into a Stand ends
  with a straight walk from the entry tile to the Stand's centre; aircraft park nose-in, facing away from the open side.
- Aircraft taxi at 6 tiles per minute (`TIMINGS.taxiTilesPerMinute`), slower under the Taxiway-works Twist.
- **Taxi Incidents**: the more aircraft taxi at once, the likelier one is stopped by an Incident (lowered by Ground
  Radar). It stays put for the blockage time (20 min, shortened by the Fire & Rescue Station). While it stands there
  it **closes the whole width of the Taxiway around it**. Every other aircraft whose route runs through the closure
  first looks for a detour round it; if there is none, it stops just short of the closure and waits. Later aircraft
  queue behind the ones already waiting (each only waits for those that started waiting before it, so queues never
  lock up), and all carry on once the Incident is cleared. Waiting aircraft show "Waiting" on their flight strip.
- **In-trail spacing:** every aircraft on the Taxiways claims the tiles round it (2 tiles for Large aircraft, else 1).
  A taxiing aircraft stops short of any aircraft ahead on its route that stands still (holding short, taking off,
  stopped by an Incident), goes the same way, or waits in line and started waiting before it did. So departures line up
  behind the hold point instead of stacking, and lines never wait on each other in a circle. An aircraft taking off
  keeps the hold point claimed until it is airborne (a Rejected Takeoff returns there).
- **No passing head-on:** two aircraft that would reach the same tile in opposite directions within 3 tiles' worth of
  taxiing of each other, within the next 16 tiles, would meet. One gives way: the one not yet on the other's path, else the one that has another
  way round, else the one with the later id. It takes another Taxiway if there is one (crossing the other's path only
  well before or after it), otherwise it waits short of the other's path until it has passed.
- A Ground Stop (Emergency Action) freezes all taxiing for 5 minutes.

## Runways, wind and direction

- Lengths Short / Medium / Long are 24 / 36 / 48 tiles (`BUILD_COSTS.runwayTiles`); a Runway fits aircraft up to
  Small / Medium / Large. A Runway can be lengthened one class at a time for the price difference, on either end:
  clicking its west (north) half grows it that way, its east (south) half the other way; the far end stays put. Surfaces: Grass (Small only, daylight), Asphalt, Lit (night operations), ILS (bad-weather
  landings, fewer Pilot Errors).
- **Wind** (`wind.ts`) is random per Day, sampled every 30 minutes and drifting slowly; the Wind Shift Twist turns it
  round. Each Runway lands and takes off into the wind: once the tailwind for its current direction exceeds 5 kt it
  changes direction, and no Movements use it for a 5-minute changeover.
- **Runway Exits**: smaller aircraft need less Runway (`taxi.ts → ROLL_TILES`: 12 / 30 / 44 tiles). A landing aircraft
  leaves at the first connector past its roll distance, measured from the threshold in use. Departures hold short at
  the first connector of the active direction.
- **Clear exit before landing:** the Tower only clears a landing when the aircraft's way off the Runway is clear: the
  first 6 tiles of its taxi route from the exit hold no aircraft that is stopped, holding or waiting in line, and no
  Incident closes its way to the Stand without a way round. Otherwise the arrival stays in Holding and the Runway goes
  to waiting departures. If the exit gets blocked while an aircraft is on final, it goes around.

## Flights and ATC

- The Schedule (`schedule.ts → SCHEDULE_RULES`) makes the Day's arrivals from Demand (30 flights + 20 per Week, scaled
  by weekday, ×2 on the Saturday Rush Day), split by Traffic Mix and Purpose and capped by fitting Stands and Runways.
- Phases: scheduled → holding → landing → taxi in → (Holding Bay) → on Stand (Turnaround 25 / 40 / 60 min) → taxi out →
  hold short → takeoff → departed; or crashed / diverted.
- The ATC Tower gives each Runway to one aircraft at a time with Runway Separation (landing 4 → 2 min, takeoff 3 →
  1.5 min, improved by Radar and Controller Training). A landed aircraft takes the next free fitting Stand in landing
  order, the smallest that fits first (a bigger one only when no smaller one is free), else a free Holding Bay (also
  smallest first); if neither is free it keeps holding. Low-fuel aircraft get priority; a departure
  held short over 3 minutes goes before normal arrivals.
- Fuel Reserves 40 / 45 / 55 min; an aircraft that runs dry while no fitting Runway is usable is Diverted.

## Safety

- Each landing and takeoff rolls ATC Error (1.25%, −15% per Controller Training level, +40% per aircraft over Radar
  capacity) and Pilot Error (0.75%, by surface). An error becomes Go-Around 80% / Incident 19% / Crash 1% on landing,
  Rejected Takeoff 85% / Incident 14% / Crash 1% on takeoff (`simulation.ts → SAFETY`).
- Incidents cost money and block the Runway 20 min; Crashes cost an escalating Crash Fine and block it 60 min; Fire &
  Rescue levels cut blockages to as little as 20%.
- From Radar 3/4 the game pauses before an imminent Crash and a second roll can save the aircraft. The game can also
  pause on Incidents, Crashes and Diversions (option).

## Emergency Actions

Ground Stop (always), Rush Turnaround (Ramp Agent Station), Manual Divert (Admin Office), Priority Landing (Airline
Office), each with a cooldown (`simulation.ts → ACTIONS`).

## Economy, Quota and Twists

- Money starts at 30,000 (`run.ts → STARTING_MONEY`). Each flight pays an Arrival Fee when unloading finishes and a
  Departure Fee on takeoff (`aircraft.ts → AIRCRAFT_TYPES`). Upkeep is paid at 24:00 (`run.ts → UPKEEP`). Prices are in
  `build.ts → BUILD_COSTS` and `plan.ts → PRICES`; each extra copy of a Stand, Holding Bay or Runway costs 25% more.
- Daily Quota: 75% of the Day's Demand in Movements, 90% on the Sunday Boss Day.
- **Expected money** (Plan Mode Forecast): the fees the next Day earns if every flight that comes is handled —
  each arrival's Arrival Fee, and the Departure Fee of every aircraft that can still leave that Day (its Turnaround
  ends before dusk, or a fitting Lit/ILS Runway works tonight; overnight aircraft count too). Upkeep is taken off for
  the expected net and the money after the Day. Incidents, Crash Fines and Diversions are not included.
- Twists (`twists.ts`, Severity 1–4 rising with the Week): Weather, Infrastructure and Traffic Surge families, shown in
  advance on the Run Calendar.

## Presentation

- **View:** top-down, oblique 3D buildings with shadows to the south-east, dark muted palette, yellow Taxiway markings,
  blue Taxiway edge lights. Taxiways are paved like the Runway: a darker outer edge, concrete slabs with joints and
  weathered patches, darker tyre rubber along the centre line, and lighter shoulders with a faint edge line on sides
  facing open ground. The ATC Tower stands up in the same oblique 3D: base building, tapered two-tone shaft, catwalk,
  glass cab with mullions under an overhanging roof, radar dome and a mast with a red light. Names TERMINAL and CARGO are written on the roofs; Stands show their number and Holding
  Bays B1, B2… inside, in the corner away from the Taxiway; both have a curved yellow lead-in and a stop bar.
- **Runway lights follow the surface:** none on Grass and Asphalt; white edge and green threshold lights when Lit;
  approach lights added with ILS.
- **Day and night:** during the Live Day a tint follows the clock (`clock.ts → daylight`): dark until 05:30, a warm
  sunrise to 07:30, full daylight until 18:30, low warm evening light to 20:00, dark from 21:00.
- **Aircraft** (`render/flights.ts`): each type has its own top-down silhouette, sized by its length (Caravan 8,
  Q400 11, A320 12.5, B737 13.5, A350 17, B777 18.5, B747 19 world units; a tile is 8):
  - Caravan: straight high wing, single nose propeller. Q400: straight high wing, two propellers, T-tail.
  - A320: rounded nose, livery-painted sharklets. B737: pointed nose, split-scimitar winglets, engines further inboard.
  - A350: curled wingtips and the dark cockpit "mask". B777: raked wingtips, very large engines, blade tail cone.
  - B747-8F: upper-deck hump, four engines.
  - Passenger aircraft show window lines; freighters have none. The tail colour is the livery.
- **Aircraft lights** glow above the night tint and fade in as it gets dark: red (left) and green (right) wingtip
  navigation lights and a white tail light whenever not parked on a Stand; a flashing red beacon while moving; white
  strobes double-flashing and a landing-light beam on the Runway; a short taxi-light beam while taxiing.
- Aircraft in Holding are not drawn; they appear only in the flight strips.
