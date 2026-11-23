# Babylon.js for a realistic 3D renderer over the pure TypeScript simulation

Supersedes the renderer choice in [ADR 0001](0001-pixijs-renderer-with-pure-ts-sim.md); the pure TypeScript simulation, the balance lab and the DOM UI stay.

The airfield is drawn in realistic 3D with Babylon.js (Apache 2.0) instead of PixiJS 2D: physically based materials, a sun that moves through the Day with real shadows, sky reflections, night lighting and aircraft that really climb and descend. The game stays in the browser. We chose the realistic look after prototyping four looks (realistic, low-poly, toy diorama, ink outline) in Babylon.js, and we are not trying three.js: Babylon.js gives the look with its built-in features (PBR, shadows, glow, tone mapping), and the Player preferred its result.

In a Live Day the map fills the window under floating panels and the camera is free (orbit, pan, zoom) with perspective, starting close over the airport; Build Mode keeps a straight-down view without perspective, which can zoom and pan, so tiles stay square and easy to click. (A fixed top-down camera was tried first, but it read as the 2D game in 3D.) Aircraft and buildings are built in code from the game's own dimensions (1 tile = 16 m) with canvas-painted textures, so there are no model files; every aircraft is drawn as instances of one model per type and livery. A performance spike drew a Week 4 airport (36 Stands, ~30–40 aircraft at once) at 8× in about 4.4 ms per frame, so quality only steps down (shadows, resolution) on slow machines.

## Considered Options

- **three.js:** dropped; more assembly for the same look, and the Player preferred Babylon.js's result.
- **Godot (native):** dropped with the browser-first decision; it would mean rewriting the simulation.
- **Keep PixiJS 2D:** dropped; it can't give the realistic look.
- **Blender (glTF) models:** not needed for the top-down camera; kept as a later idea for close-ups.
