# Prototype: UI direction

**Question:** What should the Live Day and Plan Mode screens look like on desktop?

**Prototype:** design canvas "AAB · UI directions" (https://claude.ai/artifact/KcVhhreJRvpWiL3unLCLmM) with three directions: A Classic Sim, B ATC Console, C Diorama Deck. Each has a Live Day and a Plan Mode screen over the same pixel-art airport.

## Verdict (2026-11-19)

**Direction B, the ATC Console, is chosen.** The Player liked:
- the flight strips (Inbound / Holding / Ground)
- Emergency Actions as a panel
- Alerts
- the Stands overview
- the Movements-per-hour bar against the Daily Quota
- the Plan Mode overview (Run Calendar + upgrades)

Changes asked for, now in v2:
- **Less clutter:** secondary numbers move into hover tooltips.
- **Zoomed-out airfield** on a true tile grid (1 tile = 8 px):
  - Runway: 3 tiles wide.
  - Taxiway: 2 tiles wide, fits every aircraft.
  - Stands: 2×2 tiles, Large 3×3.
  - Aircraft sprites sized to fit those.
- **No overflights:** aircraft only show on final approach, landing, takeoff, taxiing, in Holding Bays or on Stands. Holding aircraft appear only in the strips.
- **Build Mode**, a Plan Mode tab next to Overview, with:
  - a tool palette: Runways, Taxiway, Holding Bay, Stands, Buildings, Land, Demolish
  - drag-to-place taxiways showing tile count, cost and Upkeep
  - green/red placement ghosts with reasons and a checks list
  - locked land shown with its plot price
  - a pending total with Confirm
  - keyboard hints

## Round 3 (2026-11-19)

Feedback on v2:
- The map should take all the space between the side panels.
- The left panel (Inbound / Holding / Ground) should collapse; the right panel with Emergency Actions stays.
- The art was too chunky and pixel-y; planes were too big and stands didn't look real.
- Taxiways stay a single size that fits every aircraft.
- Taxiway centre lines must connect: curved corners, and T-junctions with a straight through-line plus curved lead-offs on both sides.
- Keep the hold lines and add runway designators.

v3:
- **Art:** smooth vector top-down art (PixiJS can render this as easily as pixel art).
- **Planes:** about 10 / 15 / 21 units long for Small / Medium / Large, inside 16 / 22 / 30-wide stands.
- **Stands:** nose-in, with a curved yellow lead-in off the apron taxilane, a stop bar, a stand number and the stand outline.
- **Taxiway lines:** connected, curved centre lines, including lead-on curves onto the runway centreline.
- **Runway:** hold-short markings (2 solid + 2 dashed) with red location signs ("09-27"); runway markings with threshold bars, "09"/"27" designators, aiming points and centreline; edge, threshold and approach lights.
- **Taxiway edge lights:** blue.
- **Live Day:** the left panel collapses to a 48 px rail with counts; the map is about 1050 px wide.
- **Build Mode:** the map is about 1160 px wide with floating Pending/Checks panels. A dragged taxiway preview shows the connecting curves that will be added automatically.

## Round 4 (2026-11-19)

Feedback on v3:
- The centre line must not continue past the hold line.
- Aircraft art should be more realistic and a bit smaller.
- Taxiways must span Large wingspans.
- The ATC tower should be clearly visible, and buildings should show what they are.
- No trees inside the airport.
- Add a Move tool (free for now).
- Plan Overview and the collapsible sidebar are good as they are.

v4:
- **Aircraft:** realistic vector shapes, 9 / 13 / 18 units long:
  - turboprop (Small)
  - narrowbody (Medium)
  - twin-engine widebody (Large)
  - four-engine 747 with upper deck (Large)

  Each has a shaded fuselage, swept wings with winglets, engines, tailplanes, cockpit windows and a tail colour.
- **Surfaces:** taxiways are 20 units wide (the widest Large span is about 18) and the runway is 30.
- **Centre lines** stop at the hold-short lines.
- **Tower:** an ATC tower with base, shaft, octagonal glass cab, antenna and a long shadow.
- **Fire & Rescue station:** between Taxiway A and the runway, with bay doors, a cross on the roof and two fire trucks.
- **Cargo Hub:** container stacks and a truck.
- **Map labels:** TWR, TERMINAL, CARGO, FIRE & RESCUE, BAYS.
- **Perimeter fence:** trees grow only outside it.
- **Build view:** land outside the fence is dimmed with a "buy Land Plot" hint, and there is a free Move tool, shown moving the ATC tower.

## Round 5 (2026-11-19)

Feedback on v4:
- The buildings looked flat next to the realistic aircraft.
- Stands were too big for the new aircraft sizes; aircraft must park nose-in up to the stop bar (the yellow T).
- Aprons must be the same tarmac as the taxiways, and the apron links should look like taxiways.
- Blue edge lights belong on both sides of the links and along the whole main taxiway, but not across T-junction mouths.
- Runway lights (white edge, green threshold) stay as they are.

v5:
- **Buildings:** oblique 3D boxes, lit from the north-west, with visible south walls and south-east shadows, plus roof detail:
  - Terminal: panels, skylight strip, AC units, glass curtain wall with mullions.
  - Cargo Hub: ribbed roof, vents, loading docks with yellow door frames.
  - Fire & Rescue: open bays, two fire trucks with light bars.
  - Tower: box base and a shaded shaft.
- **Stands:** smaller (17 wide for Medium, 22 for Large, 13 for Small), with aircraft parked nose at the stop bar under the jet bridges.
- **Aprons:** tarmac, the same as the taxiways.
- **Edge lights:** blue on both sides of Taxiway A, the apron links and the runway connectors, following the end-corner curves, with gaps at junction mouths.

## Round 6: accepted as the v1 baseline (2026-11-19)

The Player accepted this look as the starting point for v1. Final fixes:
- **Runway signs:** every hold-short sign reads "09-27".
- **No aircraft labels on the map;** aircraft details live in the flight strips. Runway and wind chips stay.
- **Stand numbers** sit inside the stand outline, in the corner away from the taxilane.
- **Terminal** extended so every jet bridge connects to it. Contact vs Remote (free-standing) Stands are visible.
- **Build rule:** a Stand's footprint is its marked outline plus a small clearance on every side, used for overlap checks and the placement ghost.
