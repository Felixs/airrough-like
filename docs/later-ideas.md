# Later ideas (backlog)

Ideas not in the game yet, roughly in order of interest. Reviewed 2026-11-21. The game's focus is building,
upgrading and planning around what the simulation throws at the Player, not micromanaging it; ideas that add
micromanagement sit at the end.

## Next up

- **Airline Contracts (reward after a Boss Day)**: after winning a Week, the Player picks one of three Contracts (or
  skips for $10,000) that steer the traffic for the rest of the Run and pay a bonus. Designed 2026-11-23:
  [`airline-contracts.md`](airline-contracts.md).
- **Delay penalties**: flights that arrive or leave late earn lower fees (or lower Score). Since Incidents and Crashes
  no longer cost money, this is the downside of an airport built too small: lots of Holding Bays let it take more
  flights, but they wait and pay less. Open: what counts as late (Holding time, time waiting for a Stand, a late
  departure) and how steep the cut is.
- **VIP Twist Family**: a VIP flight (private jet → charter → state visit as Severity rises). Handling it well earns
  a Score and Air Miles bonus; there is no money penalty for losing it.

## Later

- **Terminal capacity**: Terminals and Cargo Hubs (and possibly staff such as ground crew) handle so many passengers
  or so much cargo per hour; going over it slows Turnarounds. Replaces the separate staff and building-throughput
  ideas and the full passenger simulation (dropped as too heavy for this game).
- **Custom start**: a Main Menu builder where the Player lays out their own starting airport on the same Land Plots,
  with the money the default Starting Airport would cost (or a Player-set amount, with Air Miles scaled down for more
  money). A New Run then starts from the default Starting Airport or one of the Player's own.
- **Hard mode (Regional Field)**: starts with a Grass strip and 2 Small Stands, for bonus Air Miles. Needs its own
  traffic rule to be tough but beatable (e.g. the first Week mostly Small aircraft, fading to normal by Week 3).
  Undecided whether it is wanted.
- **Blender aircraft models**: the 3D view (ADR 0003) builds aircraft in code from their real dimensions. Models made
  in Blender (glTF) would add detail when the free camera is zoomed right in.
- **Bigger Large Stands**: at 16 m per tile, Large aircraft are drawn at about 70%, overhanging 4-tile Stands, so wide-bodies
  look only a little longer than narrow-bodies. 5 × 4-tile Large Stands would let them be drawn nearer real size; a
  build-rules and balance change.

## Unlikely (kept as a reminder)

- **Routing Rules**: Player-set rules for the ATC Tower (e.g. "Runway 2 cargo only", "Runway 1 arrivals only").
  Adds the kind of micromanagement the game avoids for now.

## Rejected

- Close the Airport action: it would let the Player skip Boss Days; the automatic Airport Closed state covers it.
- Runway shutdown Emergency Action: no use case; Infrastructure Twists already close Runways.
