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

## Commands

- `npm test` — run all Vitest tests
- `npm run typecheck` — `tsc --noEmit`
- `npm run headless -- --seed 1 --turns 500 --preset small` — run an AI-vs-AI game headless

## Layout

- `src/sim/` — simulation core
- `src/data/` — content JSON and its loader
- `src/ai/` — agents; they return `Command[]`
- `src/runner/` — headless runner
- `tests/` — Vitest tests; `golden.test.ts` pins a seeded replay, `soak.test.ts` is the milestone 1 exit test
