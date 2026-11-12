import type { Content } from '../content';
import { sortedKeys, type BuildingId } from '../ids';
import { OUTPUT_KINDS, type GameState, type StarSystem } from '../types';
import { growthCost } from './growth';
import { computeColonyEconomy } from './outputs';

/**
 * What will happen to a colony if nothing changes. Clients show this instead of
 * doing game maths themselves. Turn counts assume outputs stay as they are now.
 */
export interface ColonyForecast {
  /** Food produced minus food eaten, per turn. */
  foodSurplus: number;
  /** Turns until +1 population; null if the colony is not growing. */
  turnsToGrow: number | null;
  /** Turns until the stockpile runs out and people starve; null if the colony is fed. */
  turnsToStarve: number | null;
  idleWorkers: number;
  /** Buildings without power this turn; only buildings with at least one offline. */
  offline: Record<BuildingId, number>;
  /** One entry per build queue item, in queue order. turnsLeft is null with no industry. */
  queue: { building: BuildingId; turnsLeft: number | null }[];
}

export function forecastColony(state: GameState, system: StarSystem, content: Content): ColonyForecast {
  const colony = system.colony;
  if (!colony) throw new Error(`forecastColony: ${system.id} has no colony`);
  const economy = computeColonyEconomy(state, system, content);

  const foodSurplus = economy.outputs.food.total - economy.foodNeeded;

  let turnsToGrow: number | null = null;
  if (foodSurplus > 0 && colony.population < economy.maxPopulation) {
    const needed = growthCost(colony.population, content.rules) - colony.growthProgress;
    turnsToGrow = Math.max(1, Math.ceil(needed / foodSurplus));
  }

  const turnsToStarve = foodSurplus < 0 ? Math.floor(colony.foodStock / -foodSurplus) + 1 : null;

  const offline = {} as Record<BuildingId, number>;
  for (const id of sortedKeys(colony.buildings)) {
    const missing = colony.buildings[id] - (economy.online[id] ?? 0);
    if (missing > 0) offline[id] = missing;
  }

  const industry = economy.outputs.industry.total;
  let remaining = 0;
  const queue = colony.buildQueue.map((item) => {
    remaining += Math.max(0, (content.buildings[item.building]?.cost ?? 0) - item.progress);
    return {
      building: item.building,
      turnsLeft: industry > 0 ? Math.max(1, Math.ceil(remaining / industry)) : null,
    };
  });

  return {
    foodSurplus,
    turnsToGrow,
    turnsToStarve,
    idleWorkers: colony.population - OUTPUT_KINDS.reduce((sum, k) => sum + colony.allocation[k], 0),
    offline,
    queue,
  };
}
