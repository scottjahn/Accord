import { atWar, battleSetups, checkVictory, repairShips, resolveBattles, resolveInvasions } from '../combat';
import type { Content } from '../content';
import { creditIncome } from '../credits';
import { expireDiplomacy, pruneOpinions, resolveCessions } from '../diplomacy';
import { applyBuild } from '../economy/build';
import { applyGovernor } from '../economy/governor';
import { applyGrowth } from '../economy/growth';
import { computeColonyEconomy } from '../economy/outputs';
import { moveFleets, resolveColonisation } from '../fleets';
import { resolveOutposts } from '../outposts';
import { sortedKeys, type EmpireId } from '../ids';
import { bankIntel, resolveOperations, stepUnrest } from '../intel';
import { joinEmpire, stepMinors } from '../minors';
import { addColonyMorale, decayMorale, inUnrest, refreshMorale } from '../morale';
import { applyResearch } from '../research';
import type { BattleOutcome, BattleSetup, GameState, TurnEvent } from '../types';
import { updateKnownSystems } from '../view';
import { pressBorders, snapshotBorders } from '../territory';

/**
 * Resolves one turn for every empire at once and returns the next state.
 * The input state is not modified. Once the game has a winner, nothing happens.
 *
 * 1. What commands did this turn is announced; bought memberships join and
 *    colonies given up for peace change hands; morale is brought up to date.
 * 2. Colonies, in system-id order, each from its outputs at the start of the turn:
 *    food (stockpile, growth or starvation; no growth in unrest), industry (build
 *    queue, which may launch ships), then the governor reassigns workers.
 * 3. Each empire banks its colonies' research (levelling fields up), its intel
 *    (split between counter-intel and the pool) and its credit income.
 * 4. Ships at a friendly shipyard repair, then fleets move.
 * 5. Battles are fought wherever empires at war share a sector.
 * 6. Invade orders, then colonise orders, resolve for fleets that have arrived;
 *    outposts held by an enemy fall, and ordered outposts are built.
 * 7. Covert operations ordered this turn resolve. Minor races update their
 *    attitudes and may join an empire.
 * 8. Treaties and offers that have run out lapse. Empires with nothing left are
 *    eliminated; a last, dominant or Accord-leading empire wins.
 * 9. Timed morale effects age; a colony too long in unrest declares
 *    independence; and each empire records what it can now see.
 * 10. Border pressure: empires resent neighbours whose borders took space they
 *    claimed, and every few turns those whose closed borders press on theirs.
 */
export function processTurn(
  state: GameState,
  content: Content,
  options: TurnOptions = {},
): { state: GameState; events: TurnEvent[] } {
  const next = structuredClone(state);
  const events: TurnEvent[] = [];
  if (next.winner !== null) return { state: next, events };
  const empireIds = beginTurn(next, content, events);
  finishTurn(next, content, events, empireIds, options);
  next.turn += 1;
  return { state: next, events };
}

export interface TurnOptions {
  /**
   * Battles a player fought in real time, by sector key (see `battlesAhead`).
   * Every other battle is auto-resolved.
   */
  commandedBattles?: Record<string, BattleOutcome>;
}

/**
 * The battles this turn will bring, worked out on a copy of the state: the
 * turn runs up to the point where fleets have moved, and every contested
 * sector is listed as it stands then. The state is not modified.
 */
export function battlesAhead(state: GameState, content: Content): BattleSetup[] {
  if (state.winner !== null) return [];
  const next = structuredClone(state);
  beginTurn(next, content, []);
  return battleSetups(next, content);
}

/** Steps 1 to 4. Mutates the state and returns the empire ids in order. */
function beginTurn(next: GameState, content: Content, events: TurnEvent[]): EmpireId[] {
  // What commands did this turn (wars declared, treaties proposed, signed or broken) goes in the report.
  events.push(...next.pendingEvents);
  next.pendingEvents = [];
  // Memberships bought this turn take effect now.
  for (const pledge of next.pledges) {
    const system = next.systems[pledge.system];
    if (system?.minor) joinEmpire(next, system, pledge.empire, content, events);
  }
  next.pledges = [];
  // Colonies given up for peace change hands now.
  resolveCessions(next, content);
  const empireIds = sortedKeys(next.empires);
  for (const id of empireIds) {
    if (empireIds.some((other) => atWar(next, id, other) && !next.empires[other].eliminated)) next.empires[id].lastWarTurn = next.turn;
  }
  refreshMorale(next, content);

  const research = {} as Record<EmpireId, number>;
  const intel = {} as Record<EmpireId, number>;
  const unspent = {} as Record<EmpireId, number>;
  for (const id of sortedKeys(next.systems)) {
    const system = next.systems[id];
    const colony = system.colony;
    if (!colony) continue;

    const economy = computeColonyEconomy(next, system, content);

    const before = events.length;
    applyGrowth(colony, economy.outputs.food.total, economy.maxPopulation, content.rules, id, events, inUnrest(colony, content));
    if (events.slice(before).some((e) => e.type === 'starvation')) addColonyMorale(next, system, 'starvation', content);
    unspent[colony.owner] = (unspent[colony.owner] ?? 0) + applyBuild(next, system, economy.outputs.industry.total, content, events);

    intel[colony.owner] = (intel[colony.owner] ?? 0) + economy.outputs.intel.total;
    research[colony.owner] = (research[colony.owner] ?? 0) + economy.outputs.research.total;

    applyGovernor(next, system, content);
  }

  for (const id of empireIds) {
    applyResearch(next.empires[id], research[id] ?? 0, content, events);
    bankIntel(next, id, intel[id] ?? 0, content);
    next.empires[id].credits += creditIncome(next, id, content, unspent[id] ?? 0).total;
  }

  repairShips(next, content);
  moveFleets(next, content, events);
  return empireIds;
}

/** Steps 5 to 9. Mutates the state. */
function finishTurn(next: GameState, content: Content, events: TurnEvent[], empireIds: EmpireId[], options: TurnOptions): void {
  const borders = snapshotBorders(next, content);
  const silenced = resolveBattles(next, content, events, options.commandedBattles);
  resolveInvasions(next, content, silenced, events);
  resolveColonisation(next, content, events);
  resolveOutposts(next, content, events);
  resolveOperations(next, content, events);
  stepMinors(next, content, events);
  expireDiplomacy(next, content, events);
  pruneOpinions(next, content);
  checkVictory(next, content, events);

  decayMorale(next);
  refreshMorale(next, content);
  stepUnrest(next, content, events);
  for (const id of empireIds) updateKnownSystems(next, id, content);
  pressBorders(next, content, borders, events);
}
