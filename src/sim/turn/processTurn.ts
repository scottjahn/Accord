import type { Content } from '../content';
import { applyBuild } from '../economy/build';
import { applyGovernor } from '../economy/governor';
import { applyGrowth } from '../economy/growth';
import { computeColonyEconomy } from '../economy/outputs';
import { moveFleets, resolveColonisation } from '../fleets';
import { sortedKeys, type EmpireId } from '../ids';
import { applyResearch } from '../research';
import type { GameState, TurnEvent } from '../types';
import { updateKnownSystems } from '../view';

/**
 * Resolves one turn for every empire at once and returns the next state.
 * The input state is not modified.
 *
 * 1. Colonies, in system-id order, each from its outputs at the start of the turn:
 *    food (stockpile, growth or starvation), industry (build queue, which may
 *    launch ships), intel into the empire pool, then the governor reassigns workers.
 * 2. Research: each empire banks its colonies' research and levels fields up.
 * 3. Fleets move toward their destinations.
 * 4. Colonise orders resolve for fleets that have arrived.
 * 5. Each empire records what it can now see.
 */
export function processTurn(state: GameState, content: Content): { state: GameState; events: TurnEvent[] } {
  const next = structuredClone(state);
  const events: TurnEvent[] = [];
  const research = {} as Record<EmpireId, number>;

  for (const id of sortedKeys(next.systems)) {
    const system = next.systems[id];
    const colony = system.colony;
    if (!colony) continue;

    const economy = computeColonyEconomy(next, system, content);

    applyGrowth(colony, economy.outputs.food.total, economy.maxPopulation, content.rules, id, events);
    applyBuild(next, system, economy.outputs.industry.total, content, events);

    next.empires[colony.owner].intelPool += economy.outputs.intel.total;
    research[colony.owner] = (research[colony.owner] ?? 0) + economy.outputs.research.total;

    applyGovernor(next, system, content);
  }

  for (const id of sortedKeys(next.empires)) applyResearch(next.empires[id], research[id] ?? 0, content, events);

  moveFleets(next, content, events);
  resolveColonisation(next, content, events);

  for (const id of sortedKeys(next.empires)) updateKnownSystems(next, id, content);

  next.turn += 1;
  return { state: next, events };
}
