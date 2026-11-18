# Airport Auto-Battler

A 2D top-down roguelike airport game. Planes are the enemy: you set how many arrive
per minute and expand your airport, and the planes land, park and take off on their own.
Three crashes end the run.

This is the **M1 core-loop prototype**, drawn with simple shapes.

## Run it

Open the folder in **Godot 4.3+** (Project Manager → Import → `project.godot`) and press F5.

## What's in the prototype

- Starting airfield (50 × 50 tiles): 1 short runway, the minimum taxiway, a terminal with 4 medium stands
- Planes in 3 sizes: small (Cessna), medium (A321/A220), heavy (A380)
- Arrivals wait in a holding pattern with a 90 s fuel timer (the ring around each plane)
- The tower hands out the single runway: departures first, low-fuel arrivals as emergencies
- Each plane needs a free stand that fits it, stays there for its turnaround (10 / 20 / 40 s),
  pays its fee ($300 / $600 / $1,200), then pushes back, taxis out and takes off
- Slider: arrivals per minute (1–30). One runway handles about 4 per minute
- Buy a 5th medium stand ($3,000), a large stand ($7,000) and the long runway ($15,000).
  Heavies arrive once you own the long runway and a large stand
- A plane that runs out of fuel crashes; 3 crashes end the run, then you can restart
- Speed: pause, 1×, 2×, 3×

## Testing without a window

```bash
# simulate 15 minutes at 4 arrivals/min and print the result
godot --headless --path . -- --selftest rate=4 seconds=900
# same, with every upgrade bought at the start
godot --headless --path . -- --selftest rate=6 seconds=900 stands runway
# save a screenshot after 120 s of play (needs a display, e.g. xvfb-run)
godot --path . -- --shot=shot.png rate=6 after=120
```
