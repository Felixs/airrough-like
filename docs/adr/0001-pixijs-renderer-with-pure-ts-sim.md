# PixiJS v8 renderer over a pure TypeScript simulation

The game runs in the browser as pixel-art 2D top-down with slight depth. We render with PixiJS v8 (renderer only), keep all game logic in a pure TypeScript simulation with no rendering imports (fixed timestep, seeded randomness), and build the Plan Mode UI and HUD in the DOM. We chose this over Phaser 4 because a clean sim/render split keeps the logic unit-testable and lets speed controls simply run more ticks; we accept writing our own camera, input and tilemap loading.

## Considered Options

- **Phaser 4**: faster first playable, but its scene/game-object model pulls logic into the engine.
- **three.js with a pixel shader**: rejected; depth is faked with 3/4-view sprites, Y-sorting and altitude-scaled shadows instead.
