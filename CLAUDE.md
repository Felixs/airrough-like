# Working on Airport Auto Battler

- Domain language is in `CONTEXT.md` (a glossary only); decisions in `docs/adr/`, design notes in `docs/`.
- `docs/game-design.md` is the spec of the game as built.
- Game logic lives in `src/sim/` (pure TypeScript, unit-tested); `src/render/` and `src/ui/` only draw it.

## README screenshots

The [Screenshots workflow](.github/workflows/screenshots.yml) is manual (Actions → Screenshots → Run workflow on a
branch); it regenerates `docs/screenshots/*.png` and commits them to that branch. Nothing waits on it. Keep it working:
if a screen is added, renamed or its flow changes, update `scripts/screenshots.mjs` and the table in `README.md` in
the same change.

## Balance

Tuning changes are checked with the balance lab (`docs/balance-lab.md`): `node scripts/balance.mjs <experiment>`
locally or the manual Balance lab workflow; it reports win rates of scripted players against the targets there.

## Tests

Locally, run the tests for the area you changed (plus a typecheck). CI runs the full suite on every PR; that run is the
gate before merging.

## Keep the design docs in step with the game

The docs are the game's portable spec: someone moving the game to another engine (e.g. Godot) should be able to
rebuild it from `docs/game-design.md`, `CONTEXT.md` and the tuning tables in `src/sim/` alone. So every change to
rules, numbers, flows or visuals updates the doc that describes it **in the same change**, in engine-neutral terms
(what happens and what the player sees, not how the TypeScript does it). New terms go into `CONTEXT.md`; a doc that a
change makes wrong is corrected, not appended to. Docs that are also in the claude.ai Project get the same update there.

## Deploying

Pages (`.github/workflows/pages.yml`) deploys on every push to main. Keep `[skip ci]` out of every commit message:
a squash merge copies all branch commit messages into the merge commit, and `[skip ci]` there skips the deploy.
Commits pushed by a workflow (e.g. a screenshots run) start no workflows, so run CI on such a branch head by hand
(`gh api -X POST repos/Felixs/airrough-like/actions/workflows/ci.yml/dispatches -f ref=<branch>`).
