import type { Content, MinorDef } from './content';
import { applyGovernor } from './economy/governor';
import { maxPopulationOf } from './economy/outputs';
import { sameSector, sectorDistance } from './geometry';
import { sortedKeys, type EmpireId } from './ids';
import { memberBonuses } from './members';
import { addEmpireMorale } from './morale';

export { memberBonuses };
import type { BreakdownLine, GameState, OutputBreakdown, StarSystem, TurnEvent } from './types';

const sum = (lines: BreakdownLine[]): number => lines.reduce((n, line) => n + line.value, 0);

/** The definition of the minor race living in a system, if it is still independent. */
export function minorOf(system: StarSystem, content: Content): MinorDef | null {
  return system.minor ? (content.minors[system.minor.race] ?? null) : null;
}

/**
 * How a minor's attitude toward an empire will change this turn, with each
 * cause. A minor only responds to the things it wants.
 */
export function attitudeChange(state: GameState, system: StarSystem, empireId: EmpireId, content: Content): OutputBreakdown {
  const minor = system.minor;
  const def = minorOf(system, content);
  if (!minor || !def) throw new Error(`attitudeChange: ${system.id} has no minor race`);
  const rules = content.rules.minors;
  const lines: BreakdownLine[] = [];

  if (def.wants.includes('protection')) {
    const guarded = sortedKeys(state.fleets).some((id) => {
      const fleet = state.fleets[id];
      return fleet.owner === empireId && sameSector(fleet.sector, system.sector) && fleet.ships.some((s) => (content.hulls[s.hull]?.attack ?? 0) > 0);
    });
    if (guarded) lines.push({ source: 'Protection: your warship is on station', kind: 'flat', value: rules.protection });
  }
  if (def.wants.includes('technology') && state.empires[empireId].research.levels[def.favouredField] >= def.techLevel) {
    lines.push({ source: `Technology: ${content.fields[def.favouredField].name} level ${def.techLevel} or better`, kind: 'flat', value: rules.technology });
  }
  if (def.wants.includes('neighbours')) {
    const near = sortedKeys(state.systems).some((id) => {
      const other = state.systems[id];
      return other.colony?.owner === empireId && sectorDistance(other.sector, system.sector) <= rules.neighbourRange;
    });
    if (near) lines.push({ source: 'Neighbours: you have a colony close by', kind: 'flat', value: rules.neighbours });
  }
  if ((minor.attitude[empireId] ?? rules.startAttitude) > rules.startAttitude) {
    lines.push({ source: 'Interest fades without attention', kind: 'flat', value: -1 });
  }
  return { total: sum(lines), lines };
}

/** Attitude gained for spending influence points. Minors that want influence respond twice as well. */
export function courtGain(def: MinorDef, points: number, content: Content): number {
  const steps = Math.floor(points / content.rules.minors.influenceCost);
  return steps * (def.wants.includes('influence') ? 2 : 1);
}

/** Ground strength of a minor race defending its home. */
export function minorGarrison(system: StarSystem, content: Content): OutputBreakdown {
  const def = minorOf(system, content);
  if (!system.minor || !def) throw new Error(`minorGarrison: ${system.id} has no minor race`);
  const lines: BreakdownLine[] = [
    { source: `Population ${system.minor.population}`, kind: 'base', value: system.minor.population * content.rules.combat.garrisonPerPopulation },
    { source: `${def.name} militia`, kind: 'flat', value: def.garrison },
  ];
  return { total: sum(lines), lines };
}

/** Where an empire stands with a minor compared with its rivals, without revealing their numbers. */
export function minorStanding(system: StarSystem, empireId: EmpireId): 'alone' | 'ahead' | 'level' | 'behind' {
  const attitude = system.minor?.attitude ?? {};
  const mine = attitude[empireId] ?? 0;
  const others = sortedKeys(attitude).filter((id) => id !== empireId).map((id) => attitude[id]);
  if (others.length === 0) return 'alone';
  const best = Math.max(...others);
  return mine > best ? 'ahead' : mine === best ? 'level' : 'behind';
}

/** Turns a minor's home into a colony of the empire it joined. Mutates the state. */
export function joinEmpire(state: GameState, system: StarSystem, empireId: EmpireId, content: Content, events: TurnEvent[]): void {
  const minor = system.minor!;
  system.colony = {
    owner: empireId,
    population: Math.max(1, Math.min(minor.population, maxPopulationOf(system))),
    growthProgress: 0,
    foodStock: 0,
    allocation: { food: 0, industry: 0, energy: 0, intel: 0, research: 0 },
    governor: 'balanced',
    buildings: {},
    buildQueue: [],
    morale: 100,
    moraleEffects: [],
    minorRace: minor.race,
  };
  system.minor = null;
  const empire = state.empires[empireId];
  empire.members = [...empire.members, minor.race].sort();
  applyGovernor(state, system, content);
  addEmpireMorale(state, empireId, 'minorJoined', content);
  events.push({ type: 'minorJoined', empire: empireId, system: system.id, race: minor.race });
}

/**
 * Updates every independent minor: first contact, attitude changes, and
 * joining the empire that has led over the threshold for long enough.
 * Mutates the state.
 */
export function stepMinors(state: GameState, content: Content, events: TurnEvent[]): void {
  const rules = content.rules.minors;
  for (const id of sortedKeys(state.systems)) {
    const system = state.systems[id];
    const minor = system.minor;
    if (!minor) continue;

    for (const empireId of sortedKeys(state.empires)) {
      const empire = state.empires[empireId];
      if (empire.eliminated) {
        delete minor.attitude[empireId];
      } else if (!(empireId in minor.attitude)) {
        if (id in empire.knownSystems) minor.attitude[empireId] = rules.startAttitude;
      } else {
        const next = minor.attitude[empireId] + attitudeChange(state, system, empireId, content).total;
        minor.attitude[empireId] = Math.max(0, Math.min(100, next));
      }
    }

    // The leader is the one empire at or over the threshold and strictly ahead of everyone else.
    const ranked = sortedKeys(minor.attitude).sort((a, b) => minor.attitude[b] - minor.attitude[a] || (a < b ? -1 : 1));
    const top = ranked[0];
    const leader =
      top !== undefined && minor.attitude[top] >= rules.joinAt && (ranked.length === 1 || minor.attitude[top] > minor.attitude[ranked[1]])
        ? top
        : null;
    minor.leadTurns = leader !== null && leader === minor.leader ? minor.leadTurns + 1 : leader !== null ? 1 : 0;
    minor.leader = leader;
    if (leader !== null && minor.leadTurns >= rules.joinTurns) joinEmpire(state, system, leader, content, events);
  }
}
