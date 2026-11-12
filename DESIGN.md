# Accord — Space 4X Design Doc

Nov 11, 2026 · @Scott

## Name

**Recommendation: Accord of Stars**, shortened to *Accord* day to day. It captures BotF's real theme: rival powers deciding whether the galaxy ends in union or conquest. It reads as a Trek homage without using any trademarked words.

## Vision and pillars

A turn-based galactic 4X that plays like BotF felt in 1999: five asymmetric powers, a living galaxy of minor races, and wars you win as often through spies and treaties as through fleets. Modern UI, an AI that actually plays the game, and no memory leaks.

1. **Asymmetric powers.** Each faction wins differently and has a distinct economy, not just a stat tweak.
2. **Minor races are the board.** The fight is over who absorbs, protects or conquers the neutral worlds.
3. **Intel is a weapon.** Espionage and sabotage are a full second front, not a sideshow.
4. **Readable turns.** Every number the player sees can be traced to its cause in one click.
5. **Finishable games.** A standard game ends in 4 to 6 hours.

**Keep from BotF:** sector-grid map, system-level build queues, morale, tech eras that visibly change ship hulls, tactical combat orders (engage, raid, retreat), minor-race membership.

**Fix from BotF:** passive AI, Defiant-style unit spam, opaque morale math, late-game micromanagement of every system, and crashes.

## Core systems

Eight systems carry the game; the first four make the MVP, the rest layer on once the AI can play a full game.

| System | BotF original | Accord design | Phase |
| --- | --- | --- | --- |
| Galaxy | Square sector grid, star systems with planets | Square-sector grid (fast pathfinding, easy AI), 80 to 200 systems, seeded generation | MVP |
| Economy | Population works food, industry, energy, intel, research | Same five outputs per system; population assigned by sliders with automation presets | MVP |
| Research | Fields with levels, eras unlock buildings and hulls | 6 fields x 10 levels; each era unlocks a hull tier and one signature building per faction | MVP |
| Ships and fleets | Build per system, move by sector, range limits | Fleets with supply range from owned systems; refit old hulls instead of scrapping | MVP |
| Combat | Tactical orders resolved automatically | Auto-resolved with orders (engage, raid, retreat, protect transports); deterministic seeded rolls; full combat log | Phase 2 |
| Minor races | Annex by diplomacy, conquest or membership | Each minor has wants (tech, protection, trade); membership grants a unique bonus | Phase 2 |
| Diplomacy | Treaties, gifts, demands, alliances | Treaties as contracts with terms and break penalties; AI remembers betrayals | Phase 3 |
| Intel | Sabotage, steal research, incite unrest | Intel points spent on operations against a target's defence; counter-intel as a real investment | Phase 3 |

Morale stays: it scales every output per system and is moved by visible, listed events (victories, treaties broken, unrest).

## The five powers

Five original powers, each echoing one BotF archetype through its economy rather than its look. The MVP ships two: the Concord and the Vashran Dominate.

| Power | Archetype | Economy twist | Wins by |
| --- | --- | --- | --- |
| The Concord | Idealist union | Minor races join voluntarily; morale crashes if it attacks first | Membership and research |
| Vashran Dominate | Warrior honour culture | Conquest fuels morale; peace slowly erodes it | Military |
| The Veiled Throne | Secretive empire | Double intel output; cloaked hulls from era 3 | Espionage and opportunism |
| Kessic Union | Militarised order | Cheap fast industry, low morale ceiling, strong garrisons | Attrition and holding ground |
| Orrin Exchange | Merchant guilds | Credits buy anything, including minor races and mercenaries | Wealth victory |

Each power gets one unique building per era and one unique ship role. Names are placeholders; rename freely.

## AI opponents

The AI is the make-or-break system, so it is built in from milestone 1 and plays through the same command API as the human, with no cheats at Normal difficulty.

- **Utility AI in three layers.** Strategic (every 10 turns: pick a posture such as expand, tech, war or turtle), operational (every turn: assign budgets to economy, fleets and intel), tactical (per fleet and per system: build, move, attack).
- **Personality weights per power.** The Vashran score war options higher and value betrayal memory longer; the Orrin score trade and bribery higher. Same code, different weights in data files.
- **Threat and opportunity maps.** Per-sector heatmaps of enemy strength, undefended systems and minor races in reach drive fleet and colony choices.
- **Memory.** A ledger of broken treaties, attacks and gifts per rival feeds diplomacy scoring.
- **Difficulty by resources, not blindness.** Harder levels grant output bonuses; the AI never sees through fog of war.

The test that matters: in 1,000 headless AI-vs-AI games, every power wins between 15% and 25% of the time and no game stalls past turn 400.

## Architecture and stack

**Recommendation: TypeScript in the browser, not Godot or Unity.** A turn-based 4X is mostly rules and 2D screens, which is where Claude Code is strongest, and the same simulation then runs headless in Node for AI and balance testing.

&#91;embedded content: architecture · UI, AI and runner share one command API\]

The simulation core imports nothing from the UI, so the AI, the browser and the batch runner are interchangeable clients. Stack: TypeScript, Vite, React for screens, PixiJS for the galaxy map, Vitest for tests, a seeded PRNG for every roll.

## MVP and milestones

The MVP is two powers on a small galaxy, playable start to finish against a competent AI. Each milestone ends with something you can play or run.

1. **Simulation core.** Galaxy generation, systems, the five outputs, turn processing, save and load as JSON. Exit: 500 turns run headless with no errors.
2. **Map and system UI.** Galaxy map with pan and zoom, system screen with build queue and population sliders. Exit: one human turn is fully playable.
3. **Research, ships and fleets.** Tech tree, hull tiers, fleet movement, supply range, colonisation. Exit: you can expand and build a navy.
4. **First AI.** Strategic and operational layers for expansion and economy. Exit: the AI expands as fast as you do.
5. **Combat and conquest.** Orders, auto-resolve, combat log, invading systems. Exit: a full game ends by conquest. **This is the MVP.**
6. **Minor races and morale.** Exit: absorbing minors is a viable path.
7. **Diplomacy and intel.** Exit: a game can be won without a major war.
8. **Remaining three powers, balance pass, polish.** Exit: the 1,000-game balance test passes.

## Building it with Claude Code

Run one milestone per session, with tests as the contract, and let the headless runner judge balance instead of your gut.

- **Seed the repo with this doc** as `DESIGN.md` plus a `CLAUDE.md` holding the rules: sim is pure and deterministic, no UI imports in `sim/`, every rule change ships with a test.
- **Plan first.** Start each milestone in plan mode; approve the file list and data shapes before code is written.
- **Tests before features.** Vitest unit tests for each rule (morale, research cost, combat odds), plus a golden-save test that replays a seeded game and checks the final state.
- **Data, not code, for content.** Techs, buildings, hulls and faction weights live in JSON or YAML, so balance tweaks never touch logic.
- **Balance loop.** Have Claude run the headless batch, read the win-rate report, propose a data change, and rerun. You approve each change.
- **Self-host builds.** Deploy the static build to your homelab for play-testing on any device.

First prompt to start: *Read DESIGN.md. Plan milestone 1 (simulation core) in TypeScript with Vitest. Propose the folder layout and core types before writing code.*
