import type { Content } from '../content';
import { applyBuild } from '../economy/build';
import { applyGovernor } from '../economy/governor';
import { applyGrowth } from '../economy/growth';
import { computeColonyEconomy } from '../economy/outputs';
import { sortedKeys } from '../ids';
import type { GameState, TurnEvent } from '../types';

/**
 * Resolves one turn for every empire at once and returns the next state.
 * The input state is not modified.
 *
 * Per colony, in system-id order:
 *   1. compute outputs from the state at the start of the turn
 *   2. food: stockpile, growth or starvation
 *   3. industry: build queue
 *   4. research and intel: empire pools
 *   5. automated governors reassign workers for the next turn
 */
export function processTurn(state: GameState, content: Content): { state: GameState; events: TurnEvent[] } {
  const next = structuredClone(state);
  const events: TurnEvent[] = [];

  for (const id of sortedKeys(next.systems)) {
    const system = next.systems[id];
    const colony = system.colony;
    if (!colony) continue;

    const economy = computeColonyEconomy(next, system, content);

    applyGrowth(colony, economy.outputs.food.total, economy.maxPopulation, content.rules, id, events);
    applyBuild(colony, economy.outputs.industry.total, content, id, events);

    const empire = next.empires[colony.owner];
    empire.researchPool += economy.outputs.research.total;
    empire.intelPool += economy.outputs.intel.total;

    applyGovernor(next, system, content);
  }

  next.turn += 1;
  return { state: next, events };
}
