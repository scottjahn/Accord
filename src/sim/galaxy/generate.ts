import type { Content } from '../content';
import { spawnShip } from '../fleets';
import { sectorDistance } from '../geometry';
import { sortedKeys, type BuildingId, type EmpireId, type FactionId, type SystemId } from '../ids';
import { newResearchState } from '../research';
import { nextInt, seedRng, shuffle, type RngState } from '../rng';
import {
  DIFFICULTIES,
  SAVE_VERSION,
  type Empire,
  type GameConfig,
  type GameState,
  type Planet,
  type Sector,
  type StarSystem,
} from '../types';
import { updateKnownSystems } from '../view';

export { sectorDistance };

function makePlanet(type: string, maxPopulation: number, content: Content): Planet {
  const def = content.planetTypes[type];
  return { type, maxPopulation, foodBonus: def.foodBonus, energyBonus: def.energyBonus };
}

function rollPlanet(rng: RngState, typeIds: string[], totalWeight: number, content: Content): Planet {
  let roll = nextInt(rng, 1, totalWeight);
  let type = typeIds[typeIds.length - 1];
  for (const id of typeIds) {
    roll -= content.planetTypes[id].weight;
    if (roll <= 0) {
      type = id;
      break;
    }
  }
  const [min, max] = content.planetTypes[type].maxPopulation;
  return makePlanet(type, nextInt(rng, min, max), content);
}

/**
 * Picks home systems far apart: the first at random, each later one the system
 * whose nearest existing home is farthest away (ties go to the lowest id).
 */
function pickHomes(rng: RngState, ids: SystemId[], systems: Record<SystemId, StarSystem>, count: number): SystemId[] {
  const homes: SystemId[] = [ids[nextInt(rng, 0, ids.length - 1)]];
  while (homes.length < count) {
    let best: SystemId | null = null;
    let bestDistance = -1;
    for (const id of ids) {
      if (homes.includes(id)) continue;
      const nearest = Math.min(...homes.map((h) => sectorDistance(systems[id].sector, systems[h].sector)));
      if (nearest > bestDistance) {
        best = id;
        bestDistance = nearest;
      }
    }
    homes.push(best!);
  }
  return homes;
}

/** Builds a new game from a seed. The same config and content always give the same state. */
export function createGame(config: GameConfig, content: Content): GameState {
  const preset = content.galaxyPresets[config.galaxyPreset];
  if (!preset) throw new Error(`createGame: unknown galaxy preset "${config.galaxyPreset}"`);
  if (!Number.isInteger(config.seed)) throw new Error('createGame: seed must be an integer');
  if (config.difficulty !== undefined && !DIFFICULTIES.includes(config.difficulty)) {
    throw new Error(`createGame: unknown difficulty "${String(config.difficulty)}"`);
  }
  if (config.empires.length < 1 || config.empires.length > preset.systems) {
    throw new Error(`createGame: need between 1 and ${preset.systems} empires`);
  }
  for (const e of config.empires) {
    if (!content.factions[e.faction as FactionId]) throw new Error(`createGame: unknown faction "${e.faction}"`);
  }

  const rules = content.rules;
  const rng = seedRng(config.seed);

  const sectors: Sector[] = [];
  for (let y = 0; y < preset.height; y++) {
    for (let x = 0; x < preset.width; x++) sectors.push({ x, y });
  }
  shuffle(rng, sectors);

  const names: string[] = [];
  for (const prefix of content.names.prefixes) {
    for (const suffix of content.names.suffixes) names.push(prefix + suffix);
  }
  shuffle(rng, names);

  const typeIds = sortedKeys(content.planetTypes);
  const totalWeight = typeIds.reduce((sum, id) => sum + content.planetTypes[id].weight, 0);

  const systems = {} as Record<SystemId, StarSystem>;
  const ids: SystemId[] = [];
  for (let i = 0; i < preset.systems; i++) {
    const id = `sys-${String(i + 1).padStart(3, '0')}` as SystemId;
    const planetCount = nextInt(rng, rules.planetsPerSystem[0], rules.planetsPerSystem[1]);
    const planets: Planet[] = [];
    for (let p = 0; p < planetCount; p++) planets.push(rollPlanet(rng, typeIds, totalWeight, content));
    systems[id] = { id, name: names[i], sector: sectors[i], planets, colony: null };
    ids.push(id);
  }

  const homes = pickHomes(rng, ids, systems, config.empires.length);
  const empires = {} as Record<EmpireId, Empire>;
  config.empires.forEach((e, i) => {
    const id = `emp-${i + 1}` as EmpireId;
    const home = systems[homes[i]];
    home.planets = rules.homePlanets.map((p) => makePlanet(p.type, p.maxPopulation, content));
    home.colony = {
      owner: id,
      population: rules.startingPopulation,
      growthProgress: 0,
      foodStock: 0,
      allocation: { ...rules.startingAllocation },
      governor: 'manual',
      buildings: { ...rules.startingBuildings } as Record<BuildingId, number>,
      buildQueue: [],
      morale: 100,
    };
    empires[id] = {
      id,
      faction: e.faction as FactionId,
      controller: e.controller,
      homeSystem: home.id,
      research: newResearchState(),
      intelPool: 0,
      knownSystems: {},
    };
  });

  const state: GameState = {
    saveVersion: SAVE_VERSION,
    seed: config.seed,
    rng,
    turn: 1,
    galaxy: { width: preset.width, height: preset.height },
    systems,
    empires,
    fleets: {},
    nextId: 1,
    difficulty: config.difficulty ?? 'normal',
    agentMemory: {},
  };
  for (const id of sortedKeys(empires)) {
    const home = systems[empires[id].homeSystem];
    for (const hull of rules.fleets.startingShips) spawnShip(state, id, home.sector, hull, content);
    updateKnownSystems(state, id, content);
  }
  return state;
}
