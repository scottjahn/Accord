import type { Content, HullDef } from './content';
import { applyGovernor } from './economy/governor';
import { maxPopulationOf } from './economy/outputs';
import { inBounds, sameSector, sectorDistance, sectorKey, sectorsAround } from './geometry';
import { sortedKeys, type EmpireId, type FleetId, type HullId, type ShipId, type SystemId } from './ids';
import { nextInt } from './rng';
import type { Fleet, GameState, Sector, StarSystem, TurnEvent } from './types';

export function systemAt(state: GameState, sector: Sector): StarSystem | null {
  for (const id of sortedKeys(state.systems)) {
    if (sameSector(state.systems[id].sector, sector)) return state.systems[id];
  }
  return null;
}

export function coloniesOf(state: GameState, empireId: EmpireId): StarSystem[] {
  return sortedKeys(state.systems)
    .map((id) => state.systems[id])
    .filter((s) => s.colony?.owner === empireId);
}

export function fleetsOf(state: GameState, empireId: EmpireId): Fleet[] {
  return sortedKeys(state.fleets)
    .map((id) => state.fleets[id])
    .filter((f) => f.owner === empireId);
}

const hullsOf = (fleet: Fleet, content: Content): HullDef[] =>
  fleet.ships.map((s) => content.hulls[s.hull]).filter((h): h is HullDef => h !== undefined);

/** Sectors per turn: the speed of the slowest ship. */
export function fleetSpeed(fleet: Fleet, content: Content): number {
  const hulls = hullsOf(fleet, content);
  return hulls.length === 0 ? 0 : Math.min(...hulls.map((h) => h.speed));
}

/** Supply range every ship of the empire gets before its own hull bonus. */
export function empireRange(state: GameState, empireId: EmpireId, content: Content): number {
  const rules = content.rules.fleets;
  const propulsion = state.empires[empireId].research.levels.propulsion;
  return rules.baseRange + Math.floor(propulsion / rules.propulsionLevelsPerRange);
}

/** How far from an owned colony this fleet may travel: limited by its shortest-ranged ship. */
export function fleetRange(state: GameState, fleet: Fleet, content: Content): number {
  const hulls = hullsOf(fleet, content);
  const bonus = hulls.length === 0 ? 0 : Math.min(...hulls.map((h) => h.rangeBonus));
  return empireRange(state, fleet.owner, content) + bonus;
}

/** Keys of every sector within `range` of one of the empire's colonies. */
export function suppliedSectors(state: GameState, empireId: EmpireId, range: number): Set<string> {
  const supplied = new Set<string>();
  for (const system of coloniesOf(state, empireId)) sectorsAround(state.galaxy, system.sector, range, supplied);
  return supplied;
}

const NEIGHBOURS: Sector[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

/**
 * Shortest route for a fleet to a sector, moving one sector at a time in any of
 * eight directions and only through sectors inside the fleet's supply range.
 * Returns the sectors to step through (ending at `to`), [] if already there,
 * or null if `to` is off the map, out of range or cut off.
 */
export function findPath(state: GameState, fleet: Fleet, to: Sector, content: Content): Sector[] | null {
  if (!inBounds(state.galaxy, to)) return null;
  if (sameSector(fleet.sector, to)) return [];
  const supplied = suppliedSectors(state, fleet.owner, fleetRange(state, fleet, content));
  if (!supplied.has(sectorKey(to))) return null;

  const cameFrom = new Map<string, Sector | null>([[sectorKey(fleet.sector), null]]);
  let frontier: Sector[] = [fleet.sector];
  while (frontier.length > 0) {
    const next: Sector[] = [];
    for (const current of frontier) {
      const steps = NEIGHBOURS.map((d) => ({ x: current.x + d.x, y: current.y + d.y }))
        .filter((s) => supplied.has(sectorKey(s)) && !cameFrom.has(sectorKey(s)))
        // Head toward the goal first so routes look direct.
        .sort(
          (a, b) =>
            sectorDistance(a, to) - sectorDistance(b, to) ||
            (a.x - to.x) ** 2 + (a.y - to.y) ** 2 - ((b.x - to.x) ** 2 + (b.y - to.y) ** 2),
        );
      for (const step of steps) {
        if (cameFrom.has(sectorKey(step))) continue;
        cameFrom.set(sectorKey(step), current);
        if (sameSector(step, to)) {
          const path: Sector[] = [];
          for (let s: Sector | null = step; s && !sameSector(s, fleet.sector); s = cameFrom.get(sectorKey(s)) ?? null) {
            path.unshift(s);
          }
          return path;
        }
        next.push(step);
      }
    }
    frontier = next;
  }
  return null;
}

/** The route to a sector and how many turns it takes, or null if the fleet cannot get there. */
export function fleetPlan(
  state: GameState,
  fleet: Fleet,
  to: Sector,
  content: Content,
): { path: Sector[]; turns: number } | null {
  const speed = fleetSpeed(fleet, content);
  const path = findPath(state, fleet, to, content);
  if (!path || speed <= 0) return null;
  return { path, turns: Math.ceil(path.length / speed) };
}

/** Fleet support in use (ships built and queued) against the empire's cap. */
export function empireSupport(state: GameState, empireId: EmpireId, content: Content): { used: number; cap: number } {
  let used = 0;
  let population = 0;
  for (const fleet of fleetsOf(state, empireId)) {
    for (const hull of hullsOf(fleet, content)) used += hull.support;
  }
  for (const system of coloniesOf(state, empireId)) {
    population += system.colony!.population;
    for (const item of system.colony!.buildQueue) {
      if (item.kind === 'ship') used += content.hulls[item.hull]?.support ?? 0;
    }
  }
  const rules = content.rules.fleets;
  return { used, cap: rules.supportBase + Math.floor(population / rules.populationPerSupport) };
}

export function refitCost(hull: HullDef, content: Content): number {
  return Math.max(1, Math.ceil((hull.cost * content.rules.fleets.refitCostPercent) / 100));
}

/** The fleet holding a ship, if the ship exists. */
export function fleetOfShip(state: GameState, shipId: ShipId): Fleet | null {
  for (const id of sortedKeys(state.fleets)) {
    if (state.fleets[id].ships.some((s) => s.id === shipId)) return state.fleets[id];
  }
  return null;
}

const nextIdOf = (state: GameState, prefix: string): string => `${prefix}-${String(state.nextId++).padStart(5, '0')}`;

/**
 * Adds a new ship at a sector. It joins an idle fleet of the same owner there
 * if every ship in it has the same role (so colony ships are not chained to
 * warships), or forms a new fleet. Mutates the state and returns the fleet.
 */
export function spawnShip(state: GameState, owner: EmpireId, sector: Sector, hullId: HullId, content: Content): Fleet {
  const hull = content.hulls[hullId];
  if (!hull) throw new Error(`spawnShip: unknown hull ${hullId}`);
  const ship = { id: nextIdOf(state, 'shp') as ShipId, hull: hullId, hp: hull.hp };
  const idle = fleetsOf(state, owner).find(
    (f) =>
      sameSector(f.sector, sector) &&
      f.destination === null &&
      f.order === 'none' &&
      f.ships.every((s) => content.hulls[s.hull]?.role === hull.role),
  );
  if (idle) {
    idle.ships.push(ship);
    return idle;
  }
  const fleet: Fleet = {
    id: nextIdOf(state, 'flt') as FleetId,
    owner,
    sector: { ...sector },
    ships: [ship],
    destination: null,
    order: 'none',
  };
  state.fleets[fleet.id] = fleet;
  return fleet;
}

/** Why this fleet cannot colonise this system, or null if it can. */
export function coloniseBlocker(fleet: Fleet, system: StarSystem, content: Content): string | null {
  if (system.colony) return `${system.name} is already colonised`;
  if (maxPopulationOf(system) < content.rules.fleets.colonyStartPopulation) return `${system.name} cannot support a colony`;
  if (!hullsOf(fleet, content).some((h) => h.role === 'colony')) return 'The fleet has no colony ship';
  return null;
}

/** Moves every fleet with a destination. Mutates the state. */
export function moveFleets(state: GameState, content: Content, events: TurnEvent[]): void {
  for (const id of sortedKeys(state.fleets)) {
    const fleet = state.fleets[id];
    if (!fleet.destination) continue;
    const plan = fleetPlan(state, fleet, fleet.destination, content);
    if (!plan) {
      fleet.destination = null;
      fleet.order = 'none';
      events.push({ type: 'fleetBlocked', empire: fleet.owner, fleet: id });
      continue;
    }
    const steps = Math.min(fleetSpeed(fleet, content), plan.path.length);
    if (steps > 0) fleet.sector = { ...plan.path[steps - 1] };
    if (steps === plan.path.length) {
      fleet.destination = null;
      events.push({ type: 'fleetArrived', empire: fleet.owner, fleet: id, sector: { ...fleet.sector } });
    }
  }
}

/**
 * Founds colonies for fleets that have arrived with a colonise order. If
 * several empires claim the same system on the same turn, a seeded roll picks
 * the winner and the others keep their ships. Mutates the state.
 */
export function resolveColonisation(state: GameState, content: Content, events: TurnEvent[]): void {
  const claims = new Map<SystemId, Fleet[]>();
  for (const id of sortedKeys(state.fleets)) {
    const fleet = state.fleets[id];
    if (fleet.order !== 'colonise' || fleet.destination) continue;
    const system = systemAt(state, fleet.sector);
    if (!system || coloniseBlocker(fleet, system, content)) {
      fleet.order = 'none';
      events.push({ type: 'coloniseFailed', empire: fleet.owner, system: system?.id ?? null });
      continue;
    }
    claims.set(system.id, [...(claims.get(system.id) ?? []), fleet]);
  }

  for (const systemId of [...claims.keys()].sort()) {
    const fleets = claims.get(systemId)!;
    const empires = [...new Set(fleets.map((f) => f.owner))].sort();
    const winner = empires.length === 1 ? empires[0] : empires[nextInt(state.rng, 0, empires.length - 1)];
    const founder = fleets.find((f) => f.owner === winner)!;

    for (const fleet of fleets) {
      fleet.order = 'none';
      if (fleet.owner !== winner) events.push({ type: 'coloniseFailed', empire: fleet.owner, system: systemId });
    }

    const shipIndex = founder.ships.findIndex((s) => content.hulls[s.hull]?.role === 'colony');
    founder.ships.splice(shipIndex, 1);
    if (founder.ships.length === 0) delete state.fleets[founder.id];

    const system = state.systems[systemId];
    system.colony = {
      owner: winner,
      population: content.rules.fleets.colonyStartPopulation,
      growthProgress: 0,
      foodStock: 0,
      allocation: { food: 0, industry: 0, energy: 0, intel: 0, research: 0 },
      governor: 'balanced',
      buildings: {},
      buildQueue: [],
      morale: 100,
    };
    applyGovernor(state, system, content);
    events.push({ type: 'colonyFounded', empire: winner, system: systemId });
  }
}
