import type { Content } from './content';
import { maxPopulationOf } from './economy/outputs';
import { sortedKeys } from './ids';
import { GOVERNORS, OUTPUT_KINDS, type GameState } from './types';

const isNat = (n: unknown): boolean => Number.isInteger(n) && (n as number) >= 0;

/**
 * Things that must hold in every state. Returns one message per violation;
 * an empty array means the state is sound. The soak test and the headless
 * runner check this every turn.
 */
export function checkInvariants(state: GameState, content: Content): string[] {
  const problems: string[] = [];

  if (!Number.isInteger(state.turn) || state.turn < 1) problems.push(`turn is ${state.turn}`);
  if (state.rng.length !== 4 || !state.rng.every((n) => Number.isInteger(n))) problems.push('rng state is not four integers');

  for (const id of sortedKeys(state.empires)) {
    const empire = state.empires[id];
    if (!isNat(empire.researchPool)) problems.push(`${id}: researchPool is ${empire.researchPool}`);
    if (!isNat(empire.intelPool)) problems.push(`${id}: intelPool is ${empire.intelPool}`);
    if (!content.factions[empire.faction]) problems.push(`${id}: unknown faction ${empire.faction}`);
    if (!state.systems[empire.homeSystem]) problems.push(`${id}: home system ${empire.homeSystem} does not exist`);
  }

  const sectors = new Set<string>();
  for (const id of sortedKeys(state.systems)) {
    const system = state.systems[id];
    const { x, y } = system.sector;
    const key = `${x},${y}`;
    if (sectors.has(key)) problems.push(`${id}: shares sector ${key} with another system`);
    sectors.add(key);
    if (x < 0 || y < 0 || x >= state.galaxy.width || y >= state.galaxy.height) problems.push(`${id}: sector ${key} is off the map`);

    const colony = system.colony;
    if (!colony) continue;

    if (!state.empires[colony.owner]) problems.push(`${id}: owner ${colony.owner} does not exist`);
    const max = maxPopulationOf(system);
    if (!Number.isInteger(colony.population) || colony.population < 1 || colony.population > max) {
      problems.push(`${id}: population ${colony.population} is outside 1..${max}`);
    }
    if (!isNat(colony.foodStock)) problems.push(`${id}: foodStock is ${colony.foodStock}`);
    if (!isNat(colony.growthProgress)) problems.push(`${id}: growthProgress is ${colony.growthProgress}`);
    if (!Number.isInteger(colony.morale)) problems.push(`${id}: morale is ${colony.morale}`);

    if (!GOVERNORS.includes(colony.governor)) problems.push(`${id}: unknown governor ${String(colony.governor)}`);

    let assigned = 0;
    for (const kind of OUTPUT_KINDS) {
      if (!isNat(colony.allocation[kind])) problems.push(`${id}: ${kind} workers is ${colony.allocation[kind]}`);
      assigned += colony.allocation[kind];
    }
    if (assigned > colony.population) problems.push(`${id}: ${assigned} workers assigned, population ${colony.population}`);

    for (const building of sortedKeys(colony.buildings)) {
      const count = colony.buildings[building];
      const def = content.buildings[building];
      if (!isNat(count)) problems.push(`${id}: ${building} count is ${count}`);
      if (def && count > def.maxPerSystem) problems.push(`${id}: ${count} ${building}, limit ${def.maxPerSystem}`);
    }

    if (colony.buildQueue.length > content.rules.maxQueueLength) problems.push(`${id}: build queue too long`);
    for (const item of colony.buildQueue) {
      if (!isNat(item.progress)) problems.push(`${id}: ${item.building} progress is ${item.progress}`);
    }
  }

  return problems;
}
