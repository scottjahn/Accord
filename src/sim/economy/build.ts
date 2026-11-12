import type { Content } from '../content';
import { fleetOfShip, refitCost, spawnShip } from '../fleets';
import { sameSector } from '../geometry';
import type { BuildItem, GameState, StarSystem, TurnEvent } from '../types';

/** Industry needed to finish an item, or null if content no longer defines it. */
export function itemCost(item: BuildItem, content: Content): number | null {
  if (item.kind === 'building') return content.buildings[item.building]?.cost ?? null;
  const hull = content.hulls[item.hull];
  if (!hull) return null;
  return item.kind === 'ship' ? hull.cost : refitCost(hull, content);
}

export function itemName(item: BuildItem, content: Content): string {
  if (item.kind === 'building') return content.buildings[item.building]?.name ?? item.building;
  const name = content.hulls[item.hull]?.name ?? item.hull;
  return item.kind === 'ship' ? name : `Refit to ${name}`;
}

function complete(state: GameState, system: StarSystem, item: BuildItem, content: Content, events: TurnEvent[]): void {
  const colony = system.colony!;
  switch (item.kind) {
    case 'building':
      colony.buildings[item.building] = (colony.buildings[item.building] ?? 0) + 1;
      events.push({ type: 'buildCompleted', system: system.id, building: item.building });
      break;
    case 'ship': {
      const fleet = spawnShip(state, colony.owner, system.sector, item.hull, content);
      events.push({ type: 'shipBuilt', system: system.id, hull: item.hull, fleet: fleet.id });
      break;
    }
    case 'refit': {
      // The ship must still be docked here; if it left, the work is wasted.
      const fleet = fleetOfShip(state, item.ship);
      const ship = fleet?.ships.find((s) => s.id === item.ship);
      if (!fleet || !ship || fleet.owner !== colony.owner || !sameSector(fleet.sector, system.sector)) break;
      ship.hull = item.hull;
      ship.hp = content.hulls[item.hull].hp;
      events.push({ type: 'refitCompleted', system: system.id, hull: item.hull });
      break;
    }
  }
}

/**
 * Spends this turn's industry on the build queue, front first. Overflow from a
 * finished item carries into the next one; industry with nothing queued is lost.
 * Mutates the state.
 */
export function applyBuild(
  state: GameState,
  system: StarSystem,
  industry: number,
  content: Content,
  events: TurnEvent[],
): void {
  const colony = system.colony!;
  let points = industry;
  while (points > 0 && colony.buildQueue.length > 0) {
    const item = colony.buildQueue[0];
    const cost = itemCost(item, content);
    if (cost === null) {
      // Removed from content since the save was made.
      colony.buildQueue.shift();
      continue;
    }
    const needed = cost - item.progress;
    if (points < needed) {
      item.progress += points;
      return;
    }
    points -= Math.max(0, needed);
    colony.buildQueue.shift();
    complete(state, system, item, content, events);
  }
}
