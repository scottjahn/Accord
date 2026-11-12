import {
  OUTPUT_KINDS,
  computeColonyEconomy,
  sortedKeys,
  type BuildingId,
  type Colony,
  type Command,
  type Content,
  type EmpireId,
  type GameState,
  type Outputs,
  type StarSystem,
} from '../sim';

/**
 * Placeholder player for milestone 1: keeps colonies fed and powered, splits the
 * rest of the workforce, and keeps something in the build queue. It exists so
 * headless runs exercise the command API; the real AI arrives in milestone 4.
 * Deterministic: no randomness, decisions depend only on the state.
 */
export function baselineAgent(state: GameState, empireId: EmpireId, content: Content): Command[] {
  const commands: Command[] = [];
  for (const id of sortedKeys(state.systems)) {
    const system = state.systems[id];
    const colony = system.colony;
    if (!colony || colony.owner !== empireId) continue;

    const nextBuild = colony.buildQueue.length === 0 ? chooseBuilding(state, colony, content) : null;
    const hasWork = colony.buildQueue.length > 0 || nextBuild !== null;

    const allocation = chooseAllocation(state, system, colony, content, hasWork);
    if (OUTPUT_KINDS.some((k) => allocation[k] !== colony.allocation[k])) {
      commands.push({ type: 'setAllocation', empire: empireId, system: id, allocation });
    }
    if (nextBuild) commands.push({ type: 'enqueueBuild', empire: empireId, system: id, building: nextBuild });
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

function chooseAllocation(
  state: GameState,
  system: StarSystem,
  colony: Colony,
  content: Content,
  hasWork: boolean,
): Outputs {
  const pop = colony.population;
  const trial = (allocation: Outputs) =>
    computeColonyEconomy(state, { ...system, colony: { ...colony, allocation } }, content);
  const none: Outputs = { food: 0, industry: 0, energy: 0, intel: 0, research: 0 };

  // Enough energy workers to power every building, using at most a third of the population.
  const upkeep = sortedKeys(colony.buildings).reduce(
    (sum, id) => sum + colony.buildings[id] * (content.buildings[id]?.energyUpkeep ?? 0),
    0,
  );
  const energyCap = Math.floor(pop / 3);
  let energy = energyCap;
  for (let w = 0; w <= energyCap; w++) {
    if (trial({ ...none, energy: w }).outputs.energy.total >= upkeep) {
      energy = w;
      break;
    }
  }

  // Fewest farmers that feed everyone, plus a surplus while there is room to grow.
  const base = trial({ ...none, energy });
  const growing = pop < base.maxPopulation;
  const foodTarget = base.foodNeeded + (growing ? Math.max(2, Math.ceil(pop / 5)) : 0);
  let food = pop - energy;
  for (let w = 0; w <= pop - energy; w++) {
    if (trial({ ...none, energy, food: w }).outputs.food.total >= foodTarget) {
      food = w;
      break;
    }
  }

  const rest = pop - energy - food;
  const intel = Math.floor(rest / 5);
  const industry = hasWork ? Math.floor(rest / 2) : 0;
  const research = rest - intel - industry;
  return { food, industry, energy, intel, research };
}
