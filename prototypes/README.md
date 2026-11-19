# Prototypes (throwaway)

Throwaway prototypes from the design sessions. They answered specific questions; the decisions they produced live in `docs/prototypes/*.md`, the glossary (`CONTEXT.md`) and the ADRs (`docs/adr/`). Don't build the game on this code.

| Folder | Question | Findings |
|---|---|---|
| `live-day/` | Does a single Live Day (Holding, Fuel Reserve, Stands, errors, Curfew) fail in a readable way? | `docs/prototypes/live-day.md` |
| `run-loop/` | Do Money, Upkeep, Daily Quota and Boss Days make a 4-Week Run work? | `docs/prototypes/run-loop.md` |
| `ui-canvas/` | What should the Live Day, Plan Overview and Build screens look like? | `docs/prototypes/ui.md` |

## Running them

- **Live Day:** open `live-day/PROTOTYPE-live-day.html` in a browser.
- **Run loop:** open `run-loop/PROTOTYPE-run-loop.html`.
  - After changing `sim.js` or `shell.html`, rebuild with `python3 run-loop/tools/build_run.py`.
  - Scripted test players: `node run-loop/tools/run_bot.mjs <idle|greedy|smart> allrounder <seed>`.
- **UI canvas:** the generator scripts that produced the design canvas "AAB · UI directions" on claude.ai. Direction B (ATC Console) is the accepted baseline; `scene5.py` and `design_b5.py` are the final version.
  - Run `python3 ui-canvas/design_gen.py <Artboard>.dc.html` to write the artboard HTML into `ui-canvas/out/project/`.
  - Artboard names: `Main`, `A-Plan`, `B-Live`, `B-Plan`, `B-Build`, `C-Live`, `C-Plan`.
