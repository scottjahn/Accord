# Accord — working rules

Read `DESIGN.md` for the game design and milestone list.

## Rules

- **The sim is pure and deterministic.** Code in `src/sim/` imports nothing from outside `src/sim/` (no UI, no Node APIs, no npm packages). `tests/purity.test.ts` enforces this.
- **All randomness goes through `src/sim/rng.ts`.** Never call `Math.random()` or read the clock in the sim. The RNG state lives in `GameState.rng`.
- **State is plain JSON.** No classes, Maps, Sets, Dates or `undefined` values in `GameState`. Stocks and progress are integers with explicit rounding.
- **Sim functions do not mutate their inputs.** `submitCommand` and `processTurn` clone the state and return the new one.
- **Clients use `src/sim/index.ts` only.** The UI, the AI and the headless runner all play through the same command API.
- **Every rule change ships with a test.** Rule tests use the fixed content in `tests/fixture.ts`, so balance edits in `src/data/` never break them.
- **Content is data.** Factions, buildings, planet types, presets and rule numbers live in `src/data/*.json`, validated by `validateContent`.
- **Every number is traceable.** Outputs are returned as `OutputBreakdown` with one line per cause.

- **The UI does no game maths.** Screens show what `getColonyEconomy` and `forecastColony` return and change the game only through `session.dispatch`. If the UI needs a new number, add it to the sim with a test.
- **Fog of war goes through `getEmpireView`.** The UI draws from it and agents must decide from it (or from `empire.knownSystems`); never show or act on a rival's state that the view hides.
- **AI players get a redacted state.** `runAgent` passes `redactFor(state, empire)`, never the real state, and `tests/ai/redact.test.ts` proves hidden changes cannot alter the AI's commands. Anything new that fog should hide must be removed in `src/sim/redact.ts`.
- **AI tuning is data.** Personality weights live in `src/data/ai.json`; measure a change with `npm run batch` before and after.
- **Agents return only legal commands.** `playTurn` throws on an illegal one. Check with `validateCommand` against a working copy, as `baselineAgent` does.
- **Disabled buttons explain themselves with the sim's own message:** call `validateCommand` and show its `message` rather than re-deriving the rule in the UI.
- **PixiJS stays inside `src/ui/map/mapRenderer.ts`.** Pan, zoom and hit-testing live in `camera.ts` as pure functions with tests.

## Commands

- `npm run dev` — Vite dev server at http://localhost:5173
- `npm run build` — typecheck and build the static site into `dist/`
- `npm test` — run all Vitest tests
- `npm run typecheck` — `tsc --noEmit`
- `npm run headless -- --seed 1 --turns 500 --preset small` — run an AI-vs-AI game headless
- `npm run batch -- --games 20 --turns 100 --a standard --b baseline` — play many AI-vs-AI games and compare the two agents

## Layout

- `src/sim/` — simulation core
- `src/data/` — content JSON and its loader
- `src/ai/` — AI players: `standardAgent.ts` runs the strategic, operational and tactical layers; `baselineAgent.ts` is the reference opponent
- `src/game/` — client logic with no React: the session store, turn orchestration, autosave
- `src/ui/` — React screens, plus the PixiJS galaxy map in `ui/map/`
- `src/runner/` — headless runner
- `tests/` — Vitest tests; `golden.test.ts` pins a seeded replay, `soak.test.ts` is the milestone 1 exit test, `ui/humanTurn.test.tsx` is the milestone 2 exit test (UI tests run in jsdom with the map stubbed)
