import {
  sortedKeys,
  type BuildingId,
  type Colony,
  type Command,
  type Content,
  type EmpireId,
  type GameState,
} from '../sim';

/**
 * Placeholder player until the real AI arrives in milestone 4: hands every
 * colony to the balanced governor and keeps something in the build queue.
 * It exists so headless runs and the human's opponent exercise the command API.
 * Deterministic: no randomness, decisions depend only on the state.
 */
export function baselineAgent(state: GameState, empireId: EmpireId, content: Content): Command[] {
  const commands: Command[] = [];
  for (const id of sortedKeys(state.systems)) {
    const colony = state.systems[id].colony;
    if (!colony || colony.owner !== empireId) continue;

    if (colony.governor !== 'balanced') {
      commands.push({ type: 'setGovernor', empire: empireId, system: id, governor: 'balanced' });
    }
    if (colony.buildQueue.length === 0) {
      const building = chooseBuilding(state, colony, content);
      if (building) commands.push({ type: 'enqueueBuild', empire: empireId, system: id, building });
    }
  }
  return commands;
}

function chooseBuilding(state: GameState, colony: Colony, content: Content): BuildingId | null {
  const candidates = sortedKeys(content.buildings).filter((id) => {
    const queued = colony.buildQueue.filter((item) => item.building === id).length;
    return (colony.buildings[id] ?? 0) + queued < content.buildings[id].maxPerSystem;
  });
  if (candidates.length === 0) return null;
  return candidates[state.turn % candidates.length];
}
