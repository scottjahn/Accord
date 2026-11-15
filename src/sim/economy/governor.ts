import { GOVERNOR_WEIGHT_KINDS, type Content } from '../content';
import { sortedKeys } from '../ids';
import { OUTPUT_KINDS, type AutoGovernor, type Colony, type GameState, type OutputKind, type Outputs, type StarSystem } from '../types';
import { computeColonyEconomy } from './outputs';

/**
 * The smallest worker count in 0..max that is enough, or max if none is.
 * Output never falls as workers are added, so a binary search is exact.
 */
function fewestWorkers(max: number, enough: (workers: number) => boolean): number {
  let low = 0;
  let high = max;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (enough(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** Hand-placed workers are given up in this order if the population falls below their number. */
const UNPIN_ORDER: OutputKind[] = ['research', 'intel', 'energy', 'industry', 'food'];

/** Where workers turned away by caps go once every weighted output is full. */
const SPILL_ORDER: OutputKind[] = ['research', 'industry', 'intel', 'food', 'energy'];

/** The colony's hand-placed workers, cut back if there are no longer enough people for them all. */
export function effectivePins(colony: Colony): Outputs {
  const pins = { ...colony.pinned };
  let excess = OUTPUT_KINDS.reduce((sum, k) => sum + pins[k], 0) - colony.population;
  for (const kind of UNPIN_ORDER) {
    if (excess <= 0) break;
    const cut = Math.min(excess, pins[kind]);
    pins[kind] -= cut;
    excess -= cut;
  }
  return pins;
}

/**
 * The allocation an automated governor would choose for a colony right now.
 *
 * Workers the player has placed by hand stay where they are and count toward
 * the colony's needs; the governor assigns everyone else:
 *
 * 1. Energy: the fewest workers that power every building, using at most a
 *    third of the population.
 * 2. Food: the fewest workers that feed everyone, plus a small surplus while
 *    there is room to grow.
 * 3. Everyone left is split by the governor's weights from content rules.
 *    Industry weight moves to research when nothing is queued, and food weight
 *    moves to research when the colony is at its population cap.
 *
 * A cap the player has set on an output is never exceeded: the workers it
 * turns away are shared among the other weighted outputs, then go to any
 * output with room, and are left idle only if every output is capped.
 */
export function governorAllocation(
  state: GameState,
  system: StarSystem,
  content: Content,
  governor: AutoGovernor,
): Outputs {
  const colony = system.colony;
  if (!colony) throw new Error(`governorAllocation: ${system.id} has no colony`);

  const pins = effectivePins(colony);
  const withPins = (a: Outputs): Outputs => ({
    food: a.food + pins.food,
    industry: a.industry + pins.industry,
    energy: a.energy + pins.energy,
    intel: a.intel + pins.intel,
    research: a.research + pins.research,
  });
  // The workers the governor is free to place.
  const pop = colony.population - OUTPUT_KINDS.reduce((sum, k) => sum + pins[k], 0);
  /** How many more workers the governor may add to an output before its cap. */
  const room = (kind: OutputKind): number => {
    const cap = colony.capped[kind];
    return cap === null ? colony.population : Math.max(0, cap - pins[kind]);
  };
  const none: Outputs = { food: 0, industry: 0, energy: 0, intel: 0, research: 0 };
  const trial = (allocation: Outputs) =>
    computeColonyEconomy(state, { ...system, colony: { ...colony, allocation: withPins(allocation) } }, content);

  const upkeep = sortedKeys(colony.buildings).reduce(
    (sum, id) => sum + colony.buildings[id] * (content.buildings[id]?.energyUpkeep ?? 0),
    0,
  );
  const energy = fewestWorkers(Math.min(pop, Math.floor(colony.population / 3), room('energy')), (w) => trial({ ...none, energy: w }).outputs.energy.total >= upkeep);

  const base = trial({ ...none, energy });
  const growing = colony.population < base.maxPopulation;
  const foodTarget = base.foodNeeded + (growing ? Math.max(2, Math.ceil(colony.population / 5)) : 0);
  const food = fewestWorkers(Math.min(pop - energy, room('food')), (w) => trial({ ...none, energy, food: w }).outputs.food.total >= foodTarget);

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
    const share = Math.min(Math.floor((rest * weights[kind]) / 100), room(kind) - result[kind]);
    result[kind] += share;
    assigned += share;
    if (weights[kind] > weights[favourite]) favourite = kind;
  }
  // Workers lost to rounding go to the governor's highest-weighted output.
  const extra = Math.min(rest - assigned, room(favourite) - result[favourite]);
  result[favourite] += extra;
  let left = rest - assigned - extra;

  // Only a cap leaves anyone over. Share them among the weighted outputs that still have room.
  while (left > 0) {
    const open = GOVERNOR_WEIGHT_KINDS.filter((k) => weights[k] > 0 && result[k] < room(k));
    if (open.length === 0) break;
    const total = open.reduce((sum, k) => sum + weights[k], 0);
    const pool = left;
    for (const kind of open) {
      const share = Math.min(Math.floor((pool * weights[kind]) / total), room(kind) - result[kind]);
      result[kind] += share;
      left -= share;
    }
    if (left === pool) {
      // Too few to split: one to the heaviest output with room.
      const heaviest = open.reduce((best, k) => (weights[k] > weights[best] ? k : best), open[0]);
      result[heaviest] += 1;
      left -= 1;
    }
  }
  // Still over: anywhere with room, most useful first. Otherwise they stay idle.
  for (const kind of SPILL_ORDER) {
    const take = Math.min(left, room(kind) - result[kind]);
    if (take <= 0) continue;
    result[kind] += take;
    left -= take;
  }
  return withPins(result);
}

/** Reassigns the colony's workers if it has an automated governor. Mutates the colony. */
export function applyGovernor(state: GameState, system: StarSystem, content: Content): void {
  const colony = system.colony;
  if (!colony || colony.governor === 'manual') return;
  colony.allocation = governorAllocation(state, system, content, colony.governor);
}
