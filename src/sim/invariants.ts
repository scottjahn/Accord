import type { Content } from './content';
import { maxPopulationOf } from './economy/outputs';
import { sortedKeys } from './ids';
import { fleetRange, suppliedSectors } from './fleets';
import { inBounds, sectorKey } from './geometry';
import { DIFFICULTIES, FIELDS, GOVERNORS, MAX_RESEARCH_LEVEL, OUTPUT_KINDS, type GameState } from './types';

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
    let allocated = 0;
    for (const field of FIELDS) {
      const level = empire.research.levels[field];
      if (!isNat(level) || level > MAX_RESEARCH_LEVEL) problems.push(`${id}: ${field} level is ${level}`);
      if (!isNat(empire.research.progress[field])) problems.push(`${id}: ${field} progress is ${empire.research.progress[field]}`);
      if (!isNat(empire.research.allocation[field])) problems.push(`${id}: ${field} allocation is ${empire.research.allocation[field]}`);
      allocated += empire.research.allocation[field];
    }
    if (allocated !== 100) problems.push(`${id}: research allocation sums to ${allocated}`);
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
      if (!isNat(item.progress)) problems.push(`${id}: ${item.kind} progress is ${item.progress}`);
    }
  }

  if (!isNat(state.nextId)) problems.push(`nextId is ${state.nextId}`);
  if (!DIFFICULTIES.includes(state.difficulty)) problems.push(`unknown difficulty ${String(state.difficulty)}`);
  const shipIds = new Set<string>();
  for (const id of sortedKeys(state.fleets)) {
    const fleet = state.fleets[id];
    if (fleet.id !== id) problems.push(`${id}: id mismatch`);
    if (!state.empires[fleet.owner]) problems.push(`${id}: owner ${fleet.owner} does not exist`);
    if (fleet.ships.length === 0) problems.push(`${id}: has no ships`);
    if (!inBounds(state.galaxy, fleet.sector)) problems.push(`${id}: is off the map`);
    if (fleet.destination && !inBounds(state.galaxy, fleet.destination)) problems.push(`${id}: destination is off the map`);
    if (fleet.order !== 'none' && fleet.order !== 'colonise') problems.push(`${id}: unknown order ${String(fleet.order)}`);
    for (const ship of fleet.ships) {
      if (shipIds.has(ship.id)) problems.push(`${id}: duplicate ship ${ship.id}`);
      shipIds.add(ship.id);
      const hull = content.hulls[ship.hull];
      if (!hull) problems.push(`${id}: unknown hull ${ship.hull}`);
      else if (!Number.isInteger(ship.hp) || ship.hp < 1 || ship.hp > hull.hp) problems.push(`${id}: ${ship.id} hp is ${ship.hp}`);
    }
    if (state.empires[fleet.owner] && fleet.ships.every((s) => content.hulls[s.hull])) {
      const supplied = suppliedSectors(state, fleet.owner, fleetRange(state, fleet, content));
      if (!supplied.has(sectorKey(fleet.sector))) problems.push(`${id}: is outside supply range`);
    }
  }

  return problems;
}
