import { atWar, checkVictory, repairShips, resolveBattles, resolveInvasions } from '../combat';
import type { Content } from '../content';
import { expireDiplomacy, pruneOpinions } from '../diplomacy';
import { applyBuild } from '../economy/build';
import { applyGovernor } from '../economy/governor';
import { applyGrowth } from '../economy/growth';
import { computeColonyEconomy } from '../economy/outputs';
import { moveFleets, resolveColonisation } from '../fleets';
import { sortedKeys, type EmpireId } from '../ids';
import { stepMinors } from '../minors';
import { addColonyMorale, decayMorale, inUnrest, refreshMorale } from '../morale';
import { applyResearch } from '../research';
import type { GameState, TurnEvent } from '../types';
import { updateKnownSystems } from '../view';

/**
 * Resolves one turn for every empire at once and returns the next state.
 * The input state is not modified. Once the game has a winner, nothing happens.
 *
 * 1. What commands did this turn is announced, and morale is brought up to date.
 * 2. Colonies, in system-id order, each from its outputs at the start of the turn:
 *    food (stockpile, growth or starvation; no growth in unrest), industry (build
 *    queue, which may launch ships), intel into the empire pool, then the
 *    governor reassigns workers.
 * 3. Research: each empire banks its colonies' research and levels fields up.
 * 4. Ships at a friendly shipyard repair, then fleets move.
 * 5. Battles are fought wherever empires at war share a sector.
 * 6. Invade orders, then colonise orders, resolve for fleets that have arrived.
 * 7. Minor races update their attitudes and may join an empire.
 * 8. Treaties and offers that have run out lapse. Empires with nothing left are
 *    eliminated; a last, dominant or Accord-leading empire wins.
 * 9. Timed morale effects age, and each empire records what it can now see.
 */
export function processTurn(state: GameState, content: Content): { state: GameState; events: TurnEvent[] } {
  const next = structuredClone(state);
  const events: TurnEvent[] = [];
  if (next.winner !== null) return { state: next, events };

  // What commands did this turn (wars declared, treaties proposed, signed or broken) goes in the report.
  events.push(...next.pendingEvents);
  next.pendingEvents = [];
  const empireIds = sortedKeys(next.empires);
  for (const id of empireIds) {
    if (empireIds.some((other) => atWar(next, id, other) && !next.empires[other].eliminated)) next.empires[id].lastWarTurn = next.turn;
  }
  refreshMorale(next, content);

  const research = {} as Record<EmpireId, number>;
  for (const id of sortedKeys(next.systems)) {
    const system = next.systems[id];
    const colony = system.colony;
    if (!colony) continue;

    const economy = computeColonyEconomy(next, system, content);

    const before = events.length;
    applyGrowth(colony, economy.outputs.food.total, economy.maxPopulation, content.rules, id, events, inUnrest(colony, content));
    if (events.slice(before).some((e) => e.type === 'starvation')) addColonyMorale(next, system, 'starvation', content);
    applyBuild(next, system, economy.outputs.industry.total, content, events);

    next.empires[colony.owner].intelPool += economy.outputs.intel.total;
    research[colony.owner] = (research[colony.owner] ?? 0) + economy.outputs.research.total;

    applyGovernor(next, system, content);
  }

  for (const id of empireIds) applyResearch(next.empires[id], research[id] ?? 0, content, events);

  repairShips(next, content);
  moveFleets(next, content, events);
  const silenced = resolveBattles(next, content, events);
  resolveInvasions(next, content, silenced, events);
  resolveColonisation(next, content, events);
  stepMinors(next, content, events);
  expireDiplomacy(next, content, events);
  pruneOpinions(next, content);
  checkVictory(next, content, events);

  decayMorale(next);
  refreshMorale(next, content);
  for (const id of empireIds) updateKnownSystems(next, id, content);

  next.turn += 1;
  return { state: next, events };
}
