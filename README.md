# Airport Auto-Battler

A 2D top-down roguelike airport game. Planes are the enemy: you set how many arrive
per minute and expand your airport, and the planes land, park and take off on their own.
Three crashes end the run.

This is a prototype drawn with simple shapes. It covers milestone 1 (core loop) and
milestone 2 (free building on the grid).

## Run it

Open the folder in **Godot 4.3+** (Project Manager → Import → `project.godot`) and press F5.

## What's in the prototype

- Starting airfield (50 × 50 tiles): 1 short runway, the minimum taxiway, a terminal with 4 medium stands
- Planes in 3 sizes: small (Cessna), medium (A321/A220), heavy (A380)
- Arrivals wait in a holding pattern with a 90 s fuel timer (the ring around each plane)
- The tower hands out each runway to one plane at a time: departures first, low-fuel arrivals as emergencies
- Each plane needs a free stand that fits it, stays there for its turnaround (10 / 20 / 40 s),
  pays its fee ($300 / $600 / $1,200), then pushes back, taxis out and takes off
- Slider: arrivals per minute (1–30). One runway handles about 4 per minute
- Build anywhere on the 50 × 50 grid:
  - Taxiway, $150 per tile (drag to paint)
  - Short runway (20 tiles, small and medium planes), $8,000
  - Long runway (32 tiles, all planes), $20,000. Press R to rotate the landing direction
  - Medium stand (2 × 2), $3,000, and large stand (3 × 3, needed for heavies), $7,000. A stand must touch a taxiway
  - Bulldoze, which returns 50% of the cost. Anything a plane is using can't be removed
- Pieces take time to build (taxiway 1 s per tile, runway 20/40 s, stand 15 s)
- Planes find their own way over your taxiways (A* pathfinding). A runway needs a taxiway
  next to its first 4 tiles (where departures wait) and an exit taxiway further along.
  Small planes need 6 runway tiles before they can exit, medium 12 and heavy 20
- Heavies start arriving once you have a working long runway and a large stand
- A plane that runs out of fuel crashes; 3 crashes end the run, then you can restart
- Speed: pause, 1×, 2×, 3×

## Testing without a window

```bash
# simulate 15 minutes at 4 arrivals/min and print the result
godot --headless --path . -- --selftest rate=4 seconds=900
# same, with a second (long) runway, taxiways and more stands built at the start
godot --headless --path . -- --selftest rate=6 seconds=900 expand
# save a screenshot after 120 s of play (needs a display, e.g. xvfb-run)
godot --path . -- --shot=shot.png rate=6 after=120 [expand]
```

## Releases

GitHub Actions builds the Windows executable and publishes it on the repository's
Releases page (`.github/workflows/release.yml`). To ship a new version, bump
`config/version` in `project.godot` (and the versions in `export_presets.cfg`) and push to
`main`: the workflow publishes `v<version>` if that release doesn't exist yet. Pushing a
`v*` tag yourself works too.
