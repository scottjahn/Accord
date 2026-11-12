import type { Content } from './content';
import { addOpinion, hasMet } from './diplomacy';
import { itemName } from './economy/build';
import { sortedKeys, type EmpireId, type SystemId } from './ids';
import { addColonyMorale, addEmpireMorale, inUnrest } from './morale';
import { nextInt } from './rng';
import { FIELDS, MAX_RESEARCH_LEVEL, type GameState, type Operation, type OperationKind, type OperationReport, type TurnEvent } from './types';

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

/** Operations that are aimed at one colony rather than at an empire as a whole. */
export const needsSystem = (kind: OperationKind): boolean => kind === 'sabotage' || kind === 'inciteUnrest';

/**
 * The odds of an operation against a given counter-intel rating: the percent
 * chance it succeeds, and the percent chance the agents are caught if it does not.
 */
export function operationOdds(defence: number, content: Content): { chance: number; caught: number } {
  const rules = content.rules.intel;
  const shift = Math.floor(defence / rules.defencePerPercent);
  return { chance: clamp(rules.baseChance - shift), caught: clamp(rules.catchBase + shift) };
}

/** Why this operation cannot be ordered, or null if it can. */
export function operationBlocker(state: GameState, op: Operation, content: Content): string | null {
  const me = state.empires[op.by];
  const target = state.empires[op.target];
  if (!target || op.target === op.by) return 'Choose another empire';
  if (target.eliminated) return 'That empire has been eliminated';
  if (!hasMet(state, op.by, op.target)) return 'You have not made contact with them yet';
  const def = content.rules.intel.operations[op.kind];
  if (!def) return `No operation ${String(op.kind)}`;
  if (needsSystem(op.kind)) {
    // Only a colony this empire knows to be theirs can be targeted.
    if (!op.system || me.knownSystems[op.system] !== op.target) return 'Choose one of their colonies that you know of';
  } else if (op.system !== null) {
    return `${def.label} is not aimed at a colony`;
  }
  if (state.operations.some((o) => o.by === op.by && o.target === op.target && o.kind === op.kind && o.system === op.system)) {
    return 'That operation is already under way this turn';
  }
  if (def.cost > me.intelPool) return `${def.label} costs ${def.cost} intel; you have ${me.intelPool}`;
  return null;
}

/**
 * Banks an empire's intel for the turn: counter-intel first loses a little to
 * decay, then takes its share; the rest goes to the pool. Mutates the state.
 */
export function bankIntel(state: GameState, empireId: EmpireId, produced: number, content: Content): void {
  const empire = state.empires[empireId];
  const share = Math.floor((produced * empire.intelSplit) / 100);
  empire.counterIntel = Math.floor((empire.counterIntel * (100 - content.rules.intel.decayPercent)) / 100) + share;
  empire.intelPool += produced - share;
}

function carryOut(state: GameState, op: Operation, content: Content): string {
  const rules = content.rules.intel;
  const me = state.empires[op.by];
  const them = state.empires[op.target];
  switch (op.kind) {
    case 'stealResearch': {
      // The field where they are furthest ahead; failing that, our weakest field.
      const open = FIELDS.filter((f) => me.research.levels[f] < MAX_RESEARCH_LEVEL);
      if (open.length === 0) return 'there was nothing left to learn';
      const lead = (f: (typeof FIELDS)[number]) => them.research.levels[f] - me.research.levels[f];
      const ahead = open.filter((f) => lead(f) > 0).sort((a, b) => lead(b) - lead(a))[0];
      const field = ahead ?? [...open].sort((a, b) => me.research.levels[a] - me.research.levels[b])[0];
      me.research.progress[field] += rules.stealPoints;
      return `${rules.stealPoints} research in ${content.fields[field].name}`;
    }
    case 'sabotage': {
      const system = state.systems[op.system as SystemId];
      const colony = system?.colony;
      if (!colony || colony.owner !== op.target) return 'the colony had changed hands';
      const item = colony.buildQueue[0];
      if (item && item.progress > 0) {
        item.progress = 0;
        return `work on ${itemName(item, content)} at ${system.name} was lost`;
      }
      const building = sortedKeys(colony.buildings).find((b) => colony.buildings[b] > 0);
      if (!building) return `there was nothing at ${system.name} to sabotage`;
      colony.buildings[building] -= 1;
      if (colony.buildings[building] === 0) delete colony.buildings[building];
      return `a ${content.buildings[building]?.name ?? building} at ${system.name} was destroyed`;
    }
    case 'inciteUnrest': {
      const system = state.systems[op.system as SystemId];
      if (!system?.colony || system.colony.owner !== op.target) return 'the colony had changed hands';
      addColonyMorale(state, system, 'incited', content);
      return `agitators are at work at ${system.name}`;
    }
    case 'gatherIntel':
      me.revealedUntil[op.target] = state.turn + rules.revealTurns;
      return `their colonies and counter-intel are in view for ${rules.revealTurns} turns`;
  }
}

/**
 * Resolves the operations ordered this turn, in order, each with one seeded
 * roll. The one who ordered it always gets a report; the target learns of a
 * success only by its effect, and of the culprit only if the agents are caught.
 * Mutates the state.
 */
export function resolveOperations(state: GameState, content: Content, events: TurnEvent[]): void {
  for (const op of state.operations) {
    if (!state.empires[op.target] || state.empires[op.target].eliminated || state.empires[op.by].eliminated) continue;
    const { chance, caught } = operationOdds(state.empires[op.target].counterIntel, content);
    const roll = nextInt(state.rng, 1, 100);
    const outcome: OperationReport['outcome'] = roll <= chance ? 'success' : roll > 100 - caught ? 'caught' : 'failed';
    const effect = outcome === 'success' ? carryOut(state, op, content) : '';
    events.push({ type: 'operation', empires: [op.by], report: { ...op, chance, roll, outcome, effect } });
    if (outcome === 'success' && op.kind !== 'gatherIntel') {
      events.push({ type: 'covertAction', empire: op.target, kind: op.kind, system: op.system });
    }
    if (outcome === 'caught') {
      addOpinion(state, op.target, op.by, 'spyCaught');
      events.push({ type: 'spyCaught', empire: op.target, by: op.by, kind: op.kind });
    }
  }
  state.operations = [];
}

/**
 * Counts turns of unrest, and turns a colony that has been in unrest too long
 * into an independent people (or back into the minor race it once was). An
 * empire's home system and its last colony never revolt. Mutates the state.
 */
export function stepUnrest(state: GameState, content: Content, events: TurnEvent[]): void {
  const limit = content.rules.morale.revoltTurns;
  for (const id of sortedKeys(state.systems)) {
    const system = state.systems[id];
    const colony = system.colony;
    if (!colony) continue;
    colony.unrestTurns = inUnrest(colony, content) ? colony.unrestTurns + 1 : 0;
    if (limit === 0 || colony.unrestTurns < limit) continue;

    const owner = state.empires[colony.owner];
    const others = sortedKeys(state.systems).some((s) => s !== id && state.systems[s].colony?.owner === colony.owner);
    if (!others || owner.homeSystem === id) continue;

    if (colony.minorRace) {
      const at = owner.members.indexOf(colony.minorRace);
      if (at >= 0) owner.members.splice(at, 1);
    }
    system.minor = {
      race: colony.minorRace ?? content.rules.morale.rebelRace,
      population: colony.population,
      // They have just walked out on their old rulers.
      attitude: { [colony.owner]: 0 } as Record<EmpireId, number>,
      leader: null,
      leadTurns: 0,
    };
    system.colony = null;
    addEmpireMorale(state, owner.id, 'colonyLost', content);
    events.push({ type: 'revolt', empire: owner.id, system: id });
  }
}
