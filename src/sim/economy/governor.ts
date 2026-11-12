import { GOVERNOR_WEIGHT_KINDS, type Content } from '../content';
import { sortedKeys } from '../ids';
import type { AutoGovernor, GameState, Outputs, StarSystem } from '../types';
import { computeColonyEconomy } from './outputs';

/**
 * The allocation an automated governor would choose for a colony right now.
 *
 * 1. Energy: the fewest workers that power every building, using at most a
 *    third of the population.
 * 2. Food: the fewest workers that feed everyone, plus a small surplus while
 *    there is room to grow.
 * 3. Everyone left is split by the governor's weights from content rules.
 *    Industry weight moves to research when nothing is queued, and food weight
 *    moves to research when the colony is at its population cap.
 */
export function governorAllocation(
  state: GameState,
  system: StarSystem,
  content: Content,
  governor: AutoGovernor,
): Outputs {
  const colony = system.colony;
  if (!colony) throw new Error(`governorAllocation: ${system.id} has no colony`);

  const pop = colony.population;
  const none: Outputs = { food: 0, industry: 0, energy: 0, intel: 0, research: 0 };
  const trial = (allocation: Outputs) =>
    computeColonyEconomy(state, { ...system, colony: { ...colony, allocation } }, content);

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

  const weights = { ...content.rules.governors[governor] };
  if (colony.buildQueue.length === 0) {
    weights.research += weights.industry;
    weights.industry = 0;
  }
  if (!growing) {
    weights.research += weights.food;
    weights.food = 0;
  }

  const rest = pop - energy - food;
  const result: Outputs = { ...none, energy, food };
  let assigned = 0;
  let favourite: (typeof GOVERNOR_WEIGHT_KINDS)[number] = GOVERNOR_WEIGHT_KINDS[0];
  for (const kind of GOVERNOR_WEIGHT_KINDS) {
    const share = Math.floor((rest * weights[kind]) / 100);
    result[kind] += share;
    assigned += share;
    if (weights[kind] > weights[favourite]) favourite = kind;
  }
  // Workers lost to rounding go to the governor's highest-weighted output.
  result[favourite] += rest - assigned;
  return result;
}

/** Reassigns the colony's workers if it has an automated governor. Mutates the colony. */
export function applyGovernor(state: GameState, system: StarSystem, content: Content): void {
  const colony = system.colony;
  if (!colony || colony.governor === 'manual') return;
  colony.allocation = governorAllocation(state, system, content, colony.governor);
}
