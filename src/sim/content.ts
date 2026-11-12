import type { BuildingId, FactionId, HullId } from './ids';
import {
  FIELDS,
  GOVERNORS,
  MAX_RESEARCH_LEVEL,
  OUTPUT_KINDS,
  type AutoGovernor,
  type FieldId,
  type OutputKind,
  type Outputs,
  type Result,
} from './types';

/** Research levels needed before something can be built, e.g. { weapons: 2 }. */
export type Requirements = Partial<Record<FieldId, number>>;

export interface FieldDef {
  id: FieldId;
  name: string;
  /** Each level of the field adds this percent to the output, in every colony. */
  effects: { output: OutputKind; percentPerLevel: number }[];
}

export const HULL_ROLES = ['scout', 'colony', 'warship'] as const;
export type HullRole = (typeof HULL_ROLES)[number];

export interface HullDef {
  id: HullId;
  name: string;
  role: HullRole;
  /** Hull generation; a ship can be refitted to a higher tier of the same role. */
  tier: number;
  /** Industry points to build one. */
  cost: number;
  /** Sectors moved per turn. A fleet moves at the speed of its slowest ship. */
  speed: number;
  /** Added to the empire's supply range for this hull. */
  rangeBonus: number;
  /** Sectors around the ship that it reveals. */
  scan: number;
  /** Fleet support this ship uses. */
  support: number;
  /** Combat stats; unused until combat arrives in milestone 5. */
  attack: number;
  defence: number;
  hp: number;
  requires: Requirements;
}

export interface ResearchRules {
  /** levelCosts[n] is the research needed to go from level n to n + 1. */
  levelCosts: number[];
  /** eraThresholds[n] is the total of all field levels needed for era n + 1. */
  eraThresholds: number[];
}

export interface FleetRules {
  /** Supply range in sectors around every owned colony. */
  baseRange: number;
  /** Every this many Propulsion levels add one sector of range. */
  propulsionLevelsPerRange: number;
  /** Sectors around a colony that it reveals. */
  colonyScanRange: number;
  /** Fleet support cap = supportBase + total population / populationPerSupport. */
  supportBase: number;
  populationPerSupport: number;
  colonyStartPopulation: number;
  /** A refit costs this percent of the new hull's cost. */
  refitCostPercent: number;
  /** The building a colony needs before it can build or refit ships. */
  shipyardBuilding: BuildingId;
  /** Hulls every empire starts with at its home system. */
  startingShips: HullId[];
}

/**
 * How an automated governor splits the workers left over after the colony is
 * fed and powered. Integer percents that sum to 100.
 */
export interface GovernorWeights {
  food: number;
  industry: number;
  intel: number;
  research: number;
}

export const GOVERNOR_WEIGHT_KINDS = ['food', 'industry', 'intel', 'research'] as const;

export interface FactionDef {
  id: FactionId;
  name: string;
  /** Identity colour as #rrggbb, used by every client. */
  color: string;
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
  requires: Requirements;
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
  governors: Record<AutoGovernor, GovernorWeights>;
  fleets: FleetRules;
}

export interface Content {
  factions: Record<FactionId, FactionDef>;
  buildings: Record<BuildingId, BuildingDef>;
  hulls: Record<HullId, HullDef>;
  fields: Record<FieldId, FieldDef>;
  research: ResearchRules;
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

function checkRequires(value: unknown, label: string, errors: string[]): void {
  const valid =
    isObj(value) &&
    Object.entries(value).every(
      ([k, v]) => FIELDS.includes(k as FieldId) && isInt(v) && v >= 1 && v <= MAX_RESEARCH_LEVEL,
    );
  if (!valid) errors.push(`${label}: requires must map research fields to levels 1-${MAX_RESEARCH_LEVEL}`);
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
    if (typeof f.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(f.color)) {
      errors.push(`factions.${id}: color must be #rrggbb`);
    }
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
    if (b.requires === undefined) b.requires = {};
    checkRequires(b.requires, `buildings.${id}`, errors);
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

    if (!isObj(rules.governors)) {
      errors.push('rules.governors: must be an object');
    } else {
      for (const governor of GOVERNORS) {
        if (governor === 'manual') continue;
        const w = rules.governors[governor];
        const valid =
          isObj(w) &&
          Object.keys(w).length === GOVERNOR_WEIGHT_KINDS.length &&
          GOVERNOR_WEIGHT_KINDS.every((k) => isNat(w[k])) &&
          GOVERNOR_WEIGHT_KINDS.reduce((sum, k) => sum + (w[k] as number), 0) === 100;
        if (!valid) errors.push(`rules.governors.${governor}: needs food, industry, intel and research percents summing to 100`);
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

  const hulls = indexById(raw.hulls, 'hulls', errors);
  for (const [id, h] of Object.entries(hulls)) {
    if (!HULL_ROLES.includes(h.role as HullRole)) errors.push(`hulls.${id}: role must be one of ${HULL_ROLES.join(', ')}`);
    for (const key of ['tier', 'cost', 'speed', 'support', 'hp'] as const) {
      if (!isPos(h[key])) errors.push(`hulls.${id}: ${key} must be a positive integer`);
    }
    for (const key of ['rangeBonus', 'scan', 'attack', 'defence'] as const) {
      if (!isNat(h[key])) errors.push(`hulls.${id}: ${key} must be an integer >= 0`);
    }
    checkRequires(h.requires, `hulls.${id}`, errors);
  }

  const fields = indexById(raw.fields, 'fields', errors);
  for (const field of FIELDS) {
    if (!fields[field]) errors.push(`fields: missing ${field}`);
  }
  for (const [id, f] of Object.entries(fields)) {
    if (!FIELDS.includes(id as FieldId)) errors.push(`fields.${id}: unknown field`);
    const valid =
      Array.isArray(f.effects) &&
      (f.effects as unknown[]).every((e) => isObj(e) && isKind(e.output) && isInt(e.percentPerLevel));
    if (!valid) errors.push(`fields.${id}: each effect needs output and an integer percentPerLevel`);
  }

  const research = raw.research;
  if (!isObj(research)) {
    errors.push('research: must be an object');
  } else {
    const costs = research.levelCosts;
    if (!Array.isArray(costs) || costs.length !== MAX_RESEARCH_LEVEL || !costs.every(isPos)) {
      errors.push(`research.levelCosts: needs ${MAX_RESEARCH_LEVEL} positive integers`);
    }
    const eras = research.eraThresholds;
    const ascending = Array.isArray(eras) && eras.every((n, i) => isNat(n) && (i === 0 ? n === 0 : n > eras[i - 1]));
    if (!ascending || (eras as unknown[]).length === 0) errors.push('research.eraThresholds: must start at 0 and increase');
  }

  const fleetRules = isObj(rules) ? rules.fleets : undefined;
  if (!isObj(fleetRules)) {
    errors.push('rules.fleets: must be an object');
  } else {
    for (const key of ['baseRange', 'colonyScanRange', 'supportBase'] as const) {
      if (!isNat(fleetRules[key])) errors.push(`rules.fleets.${key}: must be an integer >= 0`);
    }
    for (const key of ['propulsionLevelsPerRange', 'populationPerSupport', 'colonyStartPopulation', 'refitCostPercent'] as const) {
      if (!isPos(fleetRules[key])) errors.push(`rules.fleets.${key}: must be a positive integer`);
    }
    if (typeof fleetRules.shipyardBuilding !== 'string' || !buildings[fleetRules.shipyardBuilding]) {
      errors.push('rules.fleets.shipyardBuilding: must be a known building');
    }
    const starting = fleetRules.startingShips;
    if (!Array.isArray(starting) || !starting.every((h) => typeof h === 'string' && hulls[h])) {
      errors.push('rules.fleets.startingShips: must be a list of known hulls');
    }
  }

  if (errors.length > 0) return { ok: false, error: errors };
  return {
    ok: true,
    value: {
      factions,
      buildings,
      hulls,
      fields,
      research,
      planetTypes,
      galaxyPresets: presets,
      names,
      rules,
    } as unknown as Content,
  };
}
