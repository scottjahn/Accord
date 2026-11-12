import {
  createGame,
  spawnShip,
  validateContent,
  type Fleet,
  type HullId,
  type Sector,
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
    { id: 'alpha', name: 'Alpha', color: '#4da3ff', outputModifiers: { research: 10 } },
    { id: 'beta', name: 'Beta', color: '#e5533d', outputModifiers: { industry: 10 } },
  ],
  buildings: [
    { id: 'farm', name: 'Farm', cost: 40, energyUpkeep: 1, maxPerSystem: 3, effects: [{ output: 'food', kind: 'flat', value: 4 }] },
    { id: 'factory', name: 'Factory', cost: 60, energyUpkeep: 2, maxPerSystem: 3, effects: [{ output: 'industry', kind: 'flat', value: 3 }] },
    { id: 'reactor', name: 'Reactor', cost: 50, energyUpkeep: 0, maxPerSystem: 3, effects: [{ output: 'energy', kind: 'flat', value: 6 }] },
    { id: 'lab', name: 'Lab', cost: 80, energyUpkeep: 2, maxPerSystem: 2, effects: [{ output: 'research', kind: 'percent', value: 25 }] },
    { id: 'shipyard', name: 'Shipyard', cost: 50, energyUpkeep: 0, maxPerSystem: 1, effects: [] },
    { id: 'battery', name: 'Battery', cost: 60, energyUpkeep: 0, maxPerSystem: 2, effects: [], combat: { attack: 12, hp: 40, garrison: 0 } },
    { id: 'barracks', name: 'Barracks', cost: 40, energyUpkeep: 0, maxPerSystem: 2, effects: [], combat: { attack: 0, hp: 0, garrison: 12 } },
    { id: 'vault', name: 'Vault', cost: 90, energyUpkeep: 0, maxPerSystem: 1, effects: [], requires: { computing: 1 } },
  ],
  hulls: [
    { id: 'scout', name: 'Scout', role: 'scout', tier: 1, cost: 20, speed: 3, rangeBonus: 1, scan: 2, support: 1, attack: 0, defence: 0, hp: 10, requires: {} },
    { id: 'colony_ship', name: 'Colony Ship', role: 'colony', tier: 1, cost: 40, speed: 1, rangeBonus: 0, scan: 1, support: 2, attack: 0, defence: 0, hp: 20, requires: {} },
    { id: 'frigate', name: 'Frigate', role: 'warship', tier: 1, cost: 30, speed: 2, rangeBonus: 0, scan: 1, support: 2, attack: 10, defence: 2, hp: 30, requires: {} },
    { id: 'destroyer', name: 'Destroyer', role: 'warship', tier: 2, cost: 60, speed: 2, rangeBonus: 0, scan: 1, support: 3, attack: 20, defence: 4, hp: 50, requires: { weapons: 1 } },
    { id: 'transport', name: 'Transport', role: 'transport', tier: 1, cost: 30, speed: 2, rangeBonus: 0, scan: 1, support: 2, attack: 0, defence: 0, hp: 20, troops: 10, requires: {} },
  ],
  fields: [
    { id: 'biology', name: 'Biology', effects: [{ output: 'food', percentPerLevel: 5 }] },
    { id: 'construction', name: 'Construction', effects: [{ output: 'industry', percentPerLevel: 5 }] },
    { id: 'energy', name: 'Energy', effects: [{ output: 'energy', percentPerLevel: 5 }], combat: { attackPercent: 0, shieldPercent: 10 } },
    { id: 'propulsion', name: 'Propulsion', effects: [] },
    { id: 'computing', name: 'Computing', effects: [{ output: 'research', percentPerLevel: 10 }, { output: 'intel', percentPerLevel: 10 }] },
    { id: 'weapons', name: 'Weapons', effects: [], combat: { attackPercent: 10, shieldPercent: 0 } },
  ],
  ai: {
    personalities: {
      alpha: {
        posture: { expand: 100, develop: 100, fortify: 100, war: 100 },
        research: { biology: 1, construction: 1, energy: 1, propulsion: 1, computing: 1, weapons: 1 },
        warshipsPerColony: 100,
        scouts: 1,
      },
      beta: {
        posture: { expand: 100, develop: 100, fortify: 100, war: 100 },
        research: { biology: 1, construction: 1, energy: 1, propulsion: 1, computing: 1, weapons: 3 },
        warshipsPerColony: 100,
        scouts: 1,
      },
    },
  },
  research: {
    levelCosts: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    eraThresholds: [0, 2, 4, 6, 8],
  },
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
    governors: {
      balanced: { food: 0, industry: 50, intel: 20, research: 30 },
      growth: { food: 50, industry: 30, intel: 0, research: 20 },
      industry: { food: 0, industry: 80, intel: 10, research: 10 },
      research: { food: 0, industry: 20, intel: 0, research: 80 },
    },
    homePlanets: [
      { type: 'terran', maxPopulation: 30 },
      { type: 'barren', maxPopulation: 10 },
    ],
    difficulty: { easy: -20, normal: 0, hard: 25 },
    combat: { maxRounds: 4, minRollPercent: 100, evadeFirePercent: 50, repairPercent: 25, garrisonPerPopulation: 1, captureLossPercent: 25, captureBuildingLossPercent: 50, dominationPercent: 67 },
    fleets: {
      baseRange: 2,
      propulsionLevelsPerRange: 2,
      colonyScanRange: 1,
      supportBase: 4,
      populationPerSupport: 5,
      colonyStartPopulation: 2,
      refitCostPercent: 50,
      shipyardBuilding: 'shipyard',
      startingShips: [] as string[],
    },
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

/** Adds one new fleet holding the given hulls. Mutates the state. */
export function addFleet(state: GameState, content: Content, owner: EmpireId, sector: Sector, hulls: string[]): Fleet {
  let fleet: Fleet | null = null;
  for (const hull of hulls) {
    const single = spawnShip(state, owner, { x: -1, y: -1 }, hull as HullId, content);
    delete state.fleets[single.id];
    if (!fleet) fleet = { ...single, sector: { ...sector } };
    else fleet.ships.push(...single.ships);
  }
  if (!fleet) throw new Error('addFleet: no hulls');
  state.fleets[fleet.id] = fleet;
  return fleet;
}

export function colonyOf(state: GameState, empire: EmpireId): Colony {
  return homeOf(state, empire).colony!;
}
