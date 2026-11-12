import type { Rules } from '../content';
import type { SystemId } from '../ids';
import { OUTPUT_KINDS, type Colony, type OutputKind, type TurnEvent } from '../types';

/** Workers are laid off in this order when population drops below the allocation. */
const LAYOFF_ORDER: OutputKind[] = ['research', 'intel', 'energy', 'industry', 'food'];

export function growthCost(population: number, rules: Rules): number {
  return rules.growthCostBase + rules.growthCostPerPop * population;
}

/** Removes workers until the allocation fits the population. */
export function trimAllocation(colony: Colony): void {
  let excess = OUTPUT_KINDS.reduce((sum, k) => sum + colony.allocation[k], 0) - colony.population;
  for (const kind of LAYOFF_ORDER) {
    if (excess <= 0) break;
    const cut = Math.min(excess, colony.allocation[kind]);
    colony.allocation[kind] -= cut;
    excess -= cut;
  }
}

/**
 * Feeds the colony and grows or starves it. Mutates the colony.
 *
 * - Food produced minus food eaten goes into the stockpile (capped per pop).
 * - A surplus also counts toward growth while there is room to grow.
 * - If the stockpile cannot cover a deficit, the colony starves and loses population.
 */
export function applyGrowth(
  colony: Colony,
  food: number,
  maxPopulation: number,
  rules: Rules,
  systemId: SystemId,
  events: TurnEvent[],
  unrest = false,
): void {
  const surplus = food - colony.population * rules.foodPerPop;
  const stock = colony.foodStock + surplus;

  if (stock < 0) {
    const lost = Math.min(
      colony.population - 1,
      Math.max(1, Math.floor((colony.population * rules.starvationLossPercent) / 100)),
    );
    colony.foodStock = 0;
    colony.growthProgress = 0;
    if (lost > 0) {
      colony.population -= lost;
      trimAllocation(colony);
      events.push({ type: 'starvation', system: systemId, lost, population: colony.population });
    }
    return;
  }

  // A colony in unrest is fed but does not grow.
  if (surplus > 0 && colony.population < maxPopulation && !unrest) {
    colony.growthProgress += surplus;
    while (colony.population < maxPopulation && colony.growthProgress >= growthCost(colony.population, rules)) {
      colony.growthProgress -= growthCost(colony.population, rules);
      colony.population += 1;
      events.push({ type: 'populationGrew', system: systemId, population: colony.population });
    }
  }
  if (colony.population >= maxPopulation) colony.growthProgress = 0;

  colony.foodStock = Math.min(stock, rules.foodStockCapPerPop * colony.population);
}
