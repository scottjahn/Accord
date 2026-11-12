import type { BuildingId, FactionId } from './ids';
import { OUTPUT_KINDS, type OutputKind, type Outputs, type Result } from './types';

export interface FactionDef {
  id: FactionId;
  name: string;
  /** Percent modifier per output, e.g. { research: 10 }. */
  outputModifiers: Partial<Outputs>;
}

export interface BuildingEffect {
  output: OutputKind;
  kind: 'flat' | 'percent';
  /** Per building. */
  value: number;
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  /** Industry points to build one. */
  cost: number;
  /** Energy needed per building each turn; unpowered buildings do nothing. */
  energyUpkeep: number;
  maxPerSystem: number;
  effects: BuildingEffect[];
}

export interface PlanetTypeDef {
  id: string;
  name: string;
  /** Relative chance in galaxy generation. */
  weight: number;
  maxPopulation: [min: number, max: number];
  foodBonus: number;
  energyBonus: number;
}

export interface GalaxyPreset {
  id: string;
  width: number;
  height: number;
  systems: number;
}

export interface Rules {
  baseYieldPerWorker: Outputs;
  foodPerPop: number;
  foodStockCapPerPop: number;
  /** Food surplus needed for +1 population = base + perPop * population. */
  growthCostBase: number;
  growthCostPerPop: number;
  /** Percent of population lost on a turn the colony cannot be fed (at least 1). */
  starvationLossPercent: number;
  maxQueueLength: number;
  planetsPerSystem: [min: number, max: number];
  startingPopulation: number;
  startingAllocation: Outputs;
  startingBuildings: Record<BuildingId, number>;
  /** Every home system gets exactly these planets, for a fair start. */
  homePlanets: { type: string; maxPopulation: number }[];
}

export interface Content {
  factions: Record<FactionId, FactionDef>;
  buildings: Record<BuildingId, BuildingDef>;
  planetTypes: Record<string, PlanetTypeDef>;
  galaxyPresets: Record<string, GalaxyPreset>;
  names: { prefixes: string[]; suffixes: string[] };
  rules: Rules;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNat = (v: unknown): v is number => isInt(v) && v >= 0;
const isPos = (v: unknown): v is number => isInt(v) && v > 0;
const isKind = (v: unknown): v is OutputKind => OUTPUT_KINDS.includes(v as OutputKind);
const isRange = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && isNat(v[0]) && isNat(v[1]) && v[0] <= v[1];
const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.length > 0);

function isOutputs(v: unknown, test: (n: unknown) => boolean): v is Outputs {
  return isObj(v) && OUTPUT_KINDS.every((k) => test(v[k])) && Object.keys(v).length === OUTPUT_KINDS.length;
}

function indexById(list: unknown, label: string, errors: string[]): Record<string, Obj> {
  const out: Record<string, Obj> = {};
  if (!Array.isArray(list) || list.length === 0) {
    errors.push(`${label}: must be a non-empty array`);
    return out;
  }
  list.forEach((item, i) => {
    if (!isObj(item) || typeof item.id !== 'string' || item.id === '') {
      errors.push(`${label}[${i}]: needs a string id`);
    } else if (typeof item.name !== 'string' && label !== 'galaxyPresets') {
      errors.push(`${label}.${item.id}: needs a name`);
    } else if (item.id in out) {
      errors.push(`${label}.${item.id}: duplicate id`);
    } else {
      out[item.id] = item;
    }
  });
  return out;
}

/**
 * Checks raw content (parsed JSON) and returns it typed. Lists every problem
 * found rather than stopping at the first.
 */
export function validateContent(raw: unknown): Result<Content, string[]> {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, error: ['content: must be an object'] };

  const factions = indexById(raw.factions, 'factions', errors);
  for (const [id, f] of Object.entries(factions)) {
    const mods = f.outputModifiers;
    if (!isObj(mods) || !Object.entries(mods).every(([k, v]) => isKind(k) && isInt(v))) {
      errors.push(`factions.${id}: outputModifiers must map output kinds to integer percents`);
    }
  }

  const buildings = indexById(raw.buildings, 'buildings', errors);
  for (const [id, b] of Object.entries(buildings)) {
    if (!isPos(b.cost)) errors.push(`buildings.${id}: cost must be a positive integer`);
    if (!isNat(b.energyUpkeep)) errors.push(`buildings.${id}: energyUpkeep must be an integer >= 0`);
    if (!isPos(b.maxPerSystem)) errors.push(`buildings.${id}: maxPerSystem must be a positive integer`);
    if (!Array.isArray(b.effects)) {
      errors.push(`buildings.${id}: effects must be an array`);
      continue;
    }
    for (const e of b.effects as unknown[]) {
      if (!isObj(e) || !isKind(e.output) || (e.kind !== 'flat' && e.kind !== 'percent') || !isInt(e.value)) {
        errors.push(`buildings.${id}: each effect needs output, kind (flat|percent) and an integer value`);
      } else if (e.output === 'energy' && b.energyUpkeep !== 0) {
        // Keeps power resolution a single pass: energy is computed before upkeep is paid.
        errors.push(`buildings.${id}: a building that affects energy must have energyUpkeep 0`);
      }
    }
  }

  const planetTypes = indexById(raw.planetTypes, 'planetTypes', errors);
  let totalWeight = 0;
  for (const [id, p] of Object.entries(planetTypes)) {
    if (!isNat(p.weight)) errors.push(`planetTypes.${id}: weight must be an integer >= 0`);
    else totalWeight += p.weight;
    if (!isRange(p.maxPopulation)) errors.push(`planetTypes.${id}: maxPopulation must be [min, max]`);
    if (!isInt(p.foodBonus) || !isInt(p.energyBonus)) {
      errors.push(`planetTypes.${id}: foodBonus and energyBonus must be integer percents`);
    }
  }
  if (totalWeight <= 0) errors.push('planetTypes: at least one type needs a weight above 0');

  const presets = indexById(raw.galaxyPresets, 'galaxyPresets', errors);
  let largestGalaxy = 0;
  for (const [id, g] of Object.entries(presets)) {
    if (!isPos(g.width) || !isPos(g.height) || !isPos(g.systems)) {
      errors.push(`galaxyPresets.${id}: width, height and systems must be positive integers`);
    } else if (g.systems > g.width * g.height) {
      errors.push(`galaxyPresets.${id}: more systems than sectors`);
    } else {
      largestGalaxy = Math.max(largestGalaxy, g.systems);
    }
  }

  const names = raw.names;
  if (!isObj(names) || !isStringList(names.prefixes) || !isStringList(names.suffixes)) {
    errors.push('names: needs non-empty prefixes and suffixes string arrays');
  } else if (names.prefixes.length * names.suffixes.length < largestGalaxy) {
    errors.push(`names: not enough prefix/suffix combinations for ${largestGalaxy} systems`);
  }

  const rules = raw.rules;
  if (!isObj(rules)) {
    errors.push('rules: must be an object');
  } else {
    if (!isOutputs(rules.baseYieldPerWorker, isNat)) errors.push('rules.baseYieldPerWorker: needs all five outputs as integers >= 0');
    for (const key of ['foodPerPop', 'foodStockCapPerPop', 'growthCostBase', 'growthCostPerPop'] as const) {
      if (!isNat(rules[key])) errors.push(`rules.${key}: must be an integer >= 0`);
    }
    if (isNat(rules.growthCostBase) && isNat(rules.growthCostPerPop) && rules.growthCostBase + rules.growthCostPerPop <= 0) {
      errors.push('rules: growth cost must be above 0');
    }
    if (!isInt(rules.starvationLossPercent) || rules.starvationLossPercent < 0 || rules.starvationLossPercent > 100) {
      errors.push('rules.starvationLossPercent: must be an integer from 0 to 100');
    }
    if (!isPos(rules.maxQueueLength)) errors.push('rules.maxQueueLength: must be a positive integer');
    if (!isRange(rules.planetsPerSystem) || rules.planetsPerSystem[0] < 1) {
      errors.push('rules.planetsPerSystem: must be [min, max] with min >= 1');
    }
    if (!isPos(rules.startingPopulation)) errors.push('rules.startingPopulation: must be a positive integer');

    if (!isOutputs(rules.startingAllocation, isNat)) {
      errors.push('rules.startingAllocation: needs all five outputs as integers >= 0');
    } else if (isPos(rules.startingPopulation)) {
      const assigned = OUTPUT_KINDS.reduce((sum, k) => sum + (rules.startingAllocation as Outputs)[k], 0);
      if (assigned > rules.startingPopulation) errors.push('rules.startingAllocation: assigns more workers than startingPopulation');
    }

    if (!isObj(rules.startingBuildings)) {
      errors.push('rules.startingBuildings: must be an object');
    } else {
      for (const [id, count] of Object.entries(rules.startingBuildings)) {
        const def = buildings[id];
        if (!def) errors.push(`rules.startingBuildings: unknown building ${id}`);
        else if (!isNat(count) || (isPos(def.maxPerSystem) && count > def.maxPerSystem)) {
          errors.push(`rules.startingBuildings.${id}: must be an integer from 0 to maxPerSystem`);
        }
      }
    }

    if (!Array.isArray(rules.homePlanets) || rules.homePlanets.length === 0) {
      errors.push('rules.homePlanets: must be a non-empty array');
    } else {
      let capacity = 0;
      for (const p of rules.homePlanets as unknown[]) {
        if (!isObj(p) || typeof p.type !== 'string' || !planetTypes[p.type] || !isNat(p.maxPopulation)) {
          errors.push('rules.homePlanets: each needs a known planet type and maxPopulation');
        } else {
          capacity += p.maxPopulation;
        }
      }
      if (isPos(rules.startingPopulation) && capacity < rules.startingPopulation) {
        errors.push('rules.homePlanets: capacity is below startingPopulation');
      }
    }
  }

  if (errors.length > 0) return { ok: false, error: errors };
  return {
    ok: true,
    value: {
      factions,
      buildings,
      planetTypes,
      galaxyPresets: presets,
      names,
      rules,
    } as unknown as Content,
  };
}
