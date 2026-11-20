# Working on Airport Auto Battler

- Domain language is in `CONTEXT.md` (a glossary only); decisions in `docs/adr/`, design notes in `docs/`.
- Game logic lives in `src/sim/` (pure TypeScript, unit-tested); `src/render/` and `src/ui/` only draw it.

## Keep the README screenshots up to date

Every change that touches the UI (anything under `src/ui/`, `src/render/`, `index.html` or the styles) must leave the README
screenshots current. The [Screenshots workflow](.github/workflows/screenshots.yml) regenerates `docs/screenshots/*.png`
on every push that changes `src/` and commits them to the same branch; check its run before merging. If a screen is
added, renamed or its flow changes, update `scripts/screenshots.mjs` and the table in `README.md` in the same change.
