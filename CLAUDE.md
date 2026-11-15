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
- **Hand-placed workers and limits sit on top of a governor.** `colony.pinned` holds workers the governor must leave in place and `colony.capped` the most it may put on an output (a fixed number, null for none); `governorAllocation` honours both and assigns everyone else. The sliders send `placeWorkers`, which turns one number into a pin or a cap; `adjustWorkers` and `capWorkers` set them outright. `setAllocation` and switching to Manual clear both.
- **What counts as idle is decided in the sim.** `idleReport` feeds both the turn report and the End Turn warning; full-app tests set `accord.skipIdleWarning` in localStorage so they can play straight through.
- **Morale is a list of causes, not a number to set.** Change it with `addColonyMorale` / `addEmpireMorale` and an event kind from `rules.morale.events`; `colony.morale` is recomputed from `moraleBreakdown`. The fixture runs morale at full strength with no guard bonus so older expectations hold.
- **Minor races live in `system.minor` until they join or fall.** A member's bonus comes from `empire.members`, kept in step on joining and on capture. The fixture's `tiny` preset has no minors; use `newGame(seed, 'peopled')` or place one by hand.
- **Diplomacy is judged on what an empire knows.** Treaties are public; offers, opinions of third parties, orders and counter-intel are not, and `redactFor` strips them. Commands that the turn report should mention push onto `state.pendingEvents`.
- **Espionage resolves with the turn, not in the command.** `runOperation` only pays and queues; the seeded roll happens in `resolveOperations`, so the AI planning on a redacted copy cannot learn the outcome. Tests force an outcome by setting `rules.intel.baseChance` and `catchBase`.
- **Credits are an empire stock with a traced income.** `creditIncome` returns the lines; spending goes through `buyOut`, `giftCredits`, `buyMembership` and `hireMercenaries`. A bought membership is a pledge in `state.pledges` that joins when the turn resolves, so the buyer gains no sight mid-turn.
- **What makes a power different is data.** `faction.traits`, and `faction` on a building or hull, live in `src/data`; the fixture leaves every trait off, so tests switch on the one they are about.
- **Cloaking only changes what is seen.** `cloakedFrom` feeds `getEmpireView` and `redactFor`; no command's legality may depend on a rival fleet. Allies are never fooled.
- **Victories are rules data.** `rules.victory` sets the research, wealth and score victories (0 turns one off, as the fixture does); domination scales with the number of empires through `dominationShareOf`. `victoryPaths` gives the UI one empire's own progress.
- **Balance is measured, not guessed.** `npm run balance` plays all five powers across the machine's cores; try numbers with `--tweak "path=value;..."` before editing `src/data`. The bar is every power at 15-25% over 1,000 games with no stalls; the last full result is in `reports/balance-1000.txt`. AI defence ranges live in `ai.json` under `defence`.
- **Combat is exact in rule tests.** The fixture sets `minRollPercent` to 100 so every shot does full damage; tests that are about randomness lower it themselves.
- **Long AI runs are opt-in.** `npm test` plays 4 full AI games for the conquest exit test; `npm run test:long` plays 20. Use `npm run batch` when tuning.
- **Founding a colony is two steps for everyone.** `coloniseSystem` is legal only where the fleet already is; from a distance it fails with `notThere`, which also tells an agent the system is one it could settle on arrival.
- **Agents return only legal commands.** `playTurn` throws on an illegal one. Check with `validateCommand` against a working copy, as `baselineAgent` does.
- **What stops Skip Ahead is decided in `src/game/skip.ts`.** `turnNeedsPlayer` is the one place that says which events and idle items need the player; `session.skipAhead` publishes one snapshot for the whole stretch. A new event type that needs no decision goes in its `ROUTINE` list.
- **Hotkeys are data in `src/ui/hotkeys.ts`.** `hotkeyAction` is pure and tested; the help page lists `HOTKEYS`, so a new key is added there and nowhere else. Keys do nothing while a window is open, except Escape.
- **Saves in the browser go through `src/game/persistence.ts`:** one autosave plus `SLOT_COUNT` slots, every access guarded so the game runs without storage.
- **Disabled buttons explain themselves with the sim's own message:** call `validateCommand` and show its `message` rather than re-deriving the rule in the UI.
- **PixiJS stays inside `src/ui/map/mapRenderer.ts`,** which `GalaxyMap` loads with a dynamic import so PixiJS is not in the first download. Pan, zoom and hit-testing live in `camera.ts` as pure functions with tests.

## Commands

- `npm run dev` — Vite dev server at http://localhost:5173
- `npm run build` — typecheck and build the static site into `dist/`
- `npm test` — run all Vitest tests (about a minute)
- `npm run test:long` — the 20-game conquest exit test (several minutes)
- `npm run typecheck` — `tsc --noEmit`
- `npm run balance -- --games 1000 --jobs 10` — the five-power balance report (about 30 minutes for 1,000 games); add `--tweak "rules.victory.wealthCredits=12000"` to trial a change
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
