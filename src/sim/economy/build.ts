import type { Content } from '../content';
import type { SystemId } from '../ids';
import type { Colony, TurnEvent } from '../types';

/**
 * Spends this turn's industry on the build queue, front first. Overflow from a
 * finished item carries into the next one; industry with nothing queued is lost.
 * Mutates the colony.
 */
export function applyBuild(
  colony: Colony,
  industry: number,
  content: Content,
  systemId: SystemId,
  events: TurnEvent[],
): void {
  let points = industry;
  while (points > 0 && colony.buildQueue.length > 0) {
    const item = colony.buildQueue[0];
    const def = content.buildings[item.building];
    if (!def) {
      // Building removed from content since the save was made.
      colony.buildQueue.shift();
      continue;
    }
    const needed = def.cost - item.progress;
    if (points < needed) {
      item.progress += points;
      return;
    }
    points -= Math.max(0, needed);
    colony.buildQueue.shift();
    colony.buildings[item.building] = (colony.buildings[item.building] ?? 0) + 1;
    events.push({ type: 'buildCompleted', system: systemId, building: item.building });
  }
}
