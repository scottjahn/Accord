import {
  createGame,
  validateContent,
  type Colony,
  type Content,
  type EmpireId,
  type GameState,
  type StarSystem,
} from '../src/sim';

/**
 * Fixed content for rule tests. Deliberately separate from src/data so balance
 * edits never break these tests. Do not change numbers here without updating
 * the expectations that depend on them.
 */
export const rawFixture = {
  factions: [
    { id: 'alpha', name: 'Alpha', outputModifiers: { research: 10 } },
    { id: 'beta', name: 'Beta', outputModifiers: { industry: 10 } },
  ],
  buildings: [
    { id: 'farm', name: 'Farm', cost: 40, energyUpkeep: 1, maxPerSystem: 3, effects: [{ output: 'food', kind: 'flat', value: 4 }] },
    { id: 'factory', name: 'Factory', cost: 60, energyUpkeep: 2, maxPerSystem: 3, effects: [{ output: 'industry', kind: 'flat', value: 3 }] },
    { id: 'reactor', name: 'Reactor', cost: 50, energyUpkeep: 0, maxPerSystem: 3, effects: [{ output: 'energy', kind: 'flat', value: 6 }] },
    { id: 'lab', name: 'Lab', cost: 80, energyUpkeep: 2, maxPerSystem: 2, effects: [{ output: 'research', kind: 'percent', value: 25 }] },
  ],
  planetTypes: [
    { id: 'terran', name: 'Terran', weight: 1, maxPopulation: [10, 20], foodBonus: 10, energyBonus: 0 },
    { id: 'barren', name: 'Barren', weight: 1, maxPopulation: [2, 6], foodBonus: -5, energyBonus: 5 },
  ],
  galaxyPresets: [{ id: 'tiny', width: 8, height: 6, systems: 12 }],
  names: { prefixes: ['Al', 'Be', 'Ca', 'De'], suffixes: ['ra', 'ton', 'mir', 'dus'] },
  rules: {
    baseYieldPerWorker: { food: 4, industry: 2, energy: 2, intel: 1, research: 1 },
    foodPerPop: 2,
    foodStockCapPerPop: 10,
    growthCostBase: 20,
    growthCostPerPop: 4,
    starvationLossPercent: 10,
    maxQueueLength: 4,
    planetsPerSystem: [1, 3],
    startingPopulation: 10,
    startingAllocation: { food: 6, industry: 2, energy: 1, intel: 0, research: 1 },
    startingBuildings: { farm: 1, reactor: 1 },
    homePlanets: [
      { type: 'terran', maxPopulation: 30 },
      { type: 'barren', maxPopulation: 10 },
    ],
  },
};

export function fixtureContent(): Content {
  const result = validateContent(structuredClone(rawFixture));
  if (!result.ok) throw new Error(result.error.join('\n'));
  return result.value;
}

export const ALPHA = 'emp-1' as EmpireId;
export const BETA = 'emp-2' as EmpireId;

/**
 * A two-empire game on the fixture content. Each home starts with population 10
 * (max 40), a farm and a reactor, food +5% and energy +5% from its planets.
 */
export function newGame(seed = 1): { state: GameState; content: Content } {
  const content = fixtureContent();
  const state = createGame(
    {
      seed,
      galaxyPreset: 'tiny',
      empires: [
        { faction: 'alpha', controller: 'ai' },
        { faction: 'beta', controller: 'ai' },
      ],
    },
    content,
  );
  return { state, content };
}

export function homeOf(state: GameState, empire: EmpireId): StarSystem {
  return state.systems[state.empires[empire].homeSystem];
}

export function colonyOf(state: GameState, empire: EmpireId): Colony {
  return homeOf(state, empire).colony!;
}
