import type { Content } from '../content';
import { sortedKeys, type BuildingId } from '../ids';
import {
  FIELDS,
  OUTPUT_KINDS,
  type BreakdownLine,
  type Colony,
  type GameState,
  type OutputBreakdown,
  type OutputKind,
  type StarSystem,
} from '../types';

export interface ColonyEconomy {
  outputs: Record<OutputKind, OutputBreakdown>;
  /** How many of each building have power this turn. */
  online: Record<BuildingId, number>;
  energyUsed: number;
  foodNeeded: number;
  maxPopulation: number;
}

/**
 * total = floor((base + flat) * (100 + sum of percents) / 100), never below 0.
 */
export function totalOf(lines: BreakdownLine[]): number {
  let additive = 0;
  let percent = 0;
  for (const line of lines) {
    if (line.kind === 'percent') percent += line.value;
    else additive += line.value;
  }
  return Math.max(0, Math.floor((additive * Math.max(0, 100 + percent)) / 100));
}

export function maxPopulationOf(system: StarSystem): number {
  return system.planets.reduce((sum, p) => sum + p.maxPopulation, 0);
}

function linesFor(
  kind: OutputKind,
  system: StarSystem,
  colony: Colony,
  state: GameState,
  content: Content,
  online: Record<BuildingId, number>,
): BreakdownLine[] {
  const lines: BreakdownLine[] = [];

  const workers = colony.allocation[kind];
  if (workers > 0) {
    lines.push({
      source: `${workers} workers`,
      kind: 'base',
      value: workers * content.rules.baseYieldPerWorker[kind],
    });
  }

  for (const id of sortedKeys(online)) {
    const count = online[id];
    const def = content.buildings[id];
    if (count <= 0 || !def) continue;
    for (const effect of def.effects) {
      if (effect.output !== kind) continue;
      lines.push({ source: `${def.name} x${count}`, kind: effect.kind, value: effect.value * count });
    }
  }

  system.planets.forEach((planet, i) => {
    const bonus = kind === 'food' ? planet.foodBonus : kind === 'energy' ? planet.energyBonus : 0;
    if (bonus === 0) return;
    const typeName = content.planetTypes[planet.type]?.name ?? planet.type;
    lines.push({ source: `Planet ${i + 1} (${typeName})`, kind: 'percent', value: bonus });
  });

  const empire = state.empires[colony.owner];
  for (const field of FIELDS) {
    const level = empire.research.levels[field];
    if (level === 0) continue;
    for (const effect of content.fields[field].effects) {
      if (effect.output !== kind) continue;
      lines.push({ source: `${content.fields[field].name} level ${level}`, kind: 'percent', value: effect.percentPerLevel * level });
    }
  }

  const faction = content.factions[empire.faction];
  const factionBonus = faction?.outputModifiers[kind] ?? 0;
  if (factionBonus !== 0) lines.push({ source: faction.name, kind: 'percent', value: factionBonus });

  if (colony.morale !== 100) lines.push({ source: 'Morale', kind: 'percent', value: colony.morale - 100 });

  return lines;
}

/**
 * Everything a colony produces this turn, with the cause of every number.
 *
 * Power is resolved in one pass: energy is computed first from workers and
 * zero-upkeep buildings (content validation guarantees energy buildings have no
 * upkeep), then buildings draw upkeep in building-id order until it runs out.
 */
export function computeColonyEconomy(state: GameState, system: StarSystem, content: Content): ColonyEconomy {
  const colony = system.colony;
  if (!colony) throw new Error(`computeColonyEconomy: ${system.id} has no colony`);

  const online = {} as Record<BuildingId, number>;
  const powered: BuildingId[] = [];
  for (const id of sortedKeys(colony.buildings)) {
    const def = content.buildings[id];
    if (!def) continue;
    if (def.energyUpkeep === 0) online[id] = colony.buildings[id];
    else powered.push(id);
  }

  const energyLines = linesFor('energy', system, colony, state, content, online);
  const energy: OutputBreakdown = { total: totalOf(energyLines), lines: energyLines };

  let remaining = energy.total;
  for (const id of powered) {
    const upkeep = content.buildings[id].energyUpkeep;
    const count = Math.min(colony.buildings[id], Math.floor(remaining / upkeep));
    online[id] = count;
    remaining -= count * upkeep;
  }

  const outputs = {} as Record<OutputKind, OutputBreakdown>;
  for (const kind of OUTPUT_KINDS) {
    if (kind === 'energy') {
      outputs.energy = energy;
      continue;
    }
    const lines = linesFor(kind, system, colony, state, content, online);
    outputs[kind] = { total: totalOf(lines), lines };
  }

  return {
    outputs,
    online,
    energyUsed: energy.total - remaining,
    foodNeeded: colony.population * content.rules.foodPerPop,
    maxPopulation: maxPopulationOf(system),
  };
}
