# Working on Airport Auto Battler

- Domain language is in `CONTEXT.md` (a glossary only); decisions in `docs/adr/`, design notes in `docs/`.
- `docs/game-design.md` is the spec of the game as built.
- Game logic lives in `src/sim/` (pure TypeScript, unit-tested); `src/render/` and `src/ui/` only draw it.

## Keep the README screenshots up to date

Every change that touches the UI (anything under `src/ui/`, `src/render/`, `index.html` or the styles) must leave the README
screenshots current. The [Screenshots workflow](.github/workflows/screenshots.yml) regenerates `docs/screenshots/*.png`
on every push to a branch other than main that changes `src/`, and commits them to the same branch; check its run before merging. If a screen is
added, renamed or its flow changes, update `scripts/screenshots.mjs` and the table in `README.md` in the same change.

## Keep the design docs in step with the game

The docs are the game's portable spec: someone moving the game to another engine (e.g. Godot) should be able to
rebuild it from `docs/game-design.md`, `CONTEXT.md` and the tuning tables in `src/sim/` alone. So every change to
rules, numbers, flows or visuals updates the doc that describes it **in the same change**, in engine-neutral terms
(what happens and what the player sees, not how the TypeScript does it). New terms go into `CONTEXT.md`; a doc that a
change makes wrong is corrected, not appended to. Docs that are also in the claude.ai Project get the same update there.

## Deploying

Pages (`.github/workflows/pages.yml`) deploys on every push to main. Keep `[skip ci]` out of every commit message:
a squash merge copies all branch commit messages into the merge commit, and `[skip ci]` there skips the deploy.
Commits pushed by a workflow (e.g. the screenshots) start no workflows, so run CI on such a branch head by hand
(`gh api -X POST repos/Felixs/airrough-like/actions/workflows/ci.yml/dispatches -f ref=<branch>`).
