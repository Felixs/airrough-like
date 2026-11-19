# Prototype: Live Day

**Question:** When an airport is under-built, does it fail in a way the Player can see coming and understand, and do Plan Mode upgrades visibly fix it?

**Prototype:** throwaway single-page simulation of one Day with an abstract map (Taxiways are a travel time), 8 guided walkthroughs and free play. Artifact "PROTOTYPE · Live Day": https://claude.ai/artifact/U3KyjdSM1WajiZGzN1ZVZt

## Verdicts (2026-11-19)

- **A full Stand must not stop a landing.** Add Holding Bays next to Taxiways where landed aircraft wait. Stands are no longer reserved at landing; each landed aircraft takes the next free fitting Stand in landing order. Only if no Holding Bay is free does an aircraft stay in Holding.
- **Aircraft only fly to airports that can handle them.** The Schedule skips aircraft the airport can't serve (Week 1: swapped for Small aircraft; Week 2+: they just don't come). There is no fine. The penalty is lost income, and later Boss Days become hard to survive.
- **Plan ahead with the Run Calendar.** A 4-Week overview: the current Week is open with each Day's Forecast and its Boss Twist visible from Monday (e.g. a storm Boss Day means "build ILS"); later Weeks are greyed out.
- **Storm Boss Day without ILS can lose the Run.** This is intended, because the Player saw it coming in the Run Calendar.
- **Fuel emergencies:** no automatic divert. Escaping a fuel Crash needs Manual Divert (Admin Office) or Priority Landing (Airline Office). From Radar level 3, a Fuel Alert pauses the game when an aircraft runs low on fuel so the Player can act in time (no second roll).
- **Dusk:** evening flights still come and divert at 20:00 if there is no Lit/ILS Runway, so the Player feels the missing upgrade.
- **Midnight Curfew:** keep as designed, revisit in the real game. (Finding: Fuel Reserves of 40–55 min are shorter than the 22:00→24:00 window, so the 24:00 divert rarely fires.)
- **Rush Turnaround** looked too weak in a fuel emergency (halving the remaining time came too late). Revisit when balancing.

Parked: an Emergency Action to shut down a specific Runway (see later-ideas).
