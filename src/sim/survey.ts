import type { Content } from './content';
import { systemSummary } from './economy/outputs';
import { coloniesOf, empireRange, suppliedSectors } from './fleets';
import { sectorDistance, sectorKey } from './geometry';
import { sortedKeys, type EmpireId, type SystemId } from './ids';
import type { GameState, Sector } from './types';
import { getEmpireView } from './view';

/** One system as an empire knows it, for comparing systems side by side. */
export interface SystemRow {
  id: SystemId;
  name: string;
  sector: Sector;
  /** yours, a rival's (as last seen), an independent minor race's home, or free to settle. */
  status: 'yours' | 'rival' | 'minor' | 'free';
  /** The owning empire, as last seen; null for minor and free systems. */
  owner: EmpireId | null;
  planets: number;
  /** Total room for people across the planets. */
  room: number;
  /** People living there now, if this empire can tell: its own colonies, and others it has in sight. */
  population: number | null;
  /** Combined planet bonuses, in percent. */
  food: number;
  energy: number;
  /** Sectors to this empire's nearest colony; 0 for its own. */
  distance: number;
  /** Inside this empire's basic supply range. */
  inRange: boolean;
}

/**
 * Every system the empire has scanned, with the figures that matter when
 * deciding where to settle or what to take. Systems it has not scanned are
 * left out, so the list never shows more than fog of war allows.
 */
export function systemRows(state: GameState, empireId: EmpireId, content: Content): SystemRow[] {
  const view = getEmpireView(state, empireId, content);
  const mine = coloniesOf(state, empireId);
  const reach = suppliedSectors(state, empireId, empireRange(state, empireId, content));
  const rows: SystemRow[] = [];
  for (const id of sortedKeys(state.systems)) {
    const sight = view.systems[id];
    if (!sight.known) continue;
    const system = state.systems[id];
    const summary = systemSummary(system);
    const status = sight.owner === empireId ? 'yours' : sight.owner !== null ? 'rival' : system.minor ? 'minor' : 'free';
    rows.push({
      id,
      name: system.name,
      sector: system.sector,
      status,
      owner: sight.owner,
      planets: system.planets.length,
      room: summary.maxPopulation,
      population:
        status === 'yours' ? system.colony!.population : status === 'minor' ? system.minor!.population : sight.visible ? (system.colony?.population ?? null) : null,
      food: summary.foodBonus,
      energy: summary.energyBonus,
      distance: mine.reduce((best, c) => Math.min(best, sectorDistance(c.sector, system.sector)), Infinity),
      inRange: reach.has(sectorKey(system.sector)),
    });
  }
  return rows;
}

/** One planet of a system the empire has scanned. */
export interface PlanetRow {
  system: SystemId;
  systemName: string;
  sector: Sector;
  /** Which planet of its system this is, counting from 1. */
  number: number;
  /** Planet type id, as in content. */
  type: string;
  /** The system's status and owner, as in SystemRow. */
  status: SystemRow['status'];
  owner: EmpireId | null;
  /** Room for people on this planet alone. */
  room: number;
  /** This planet's own bonuses, in percent. */
  food: number;
  energy: number;
  distance: number;
  inRange: boolean;
}

/** Every planet of every system the empire has scanned, system by system. */
export function planetRows(state: GameState, empireId: EmpireId, content: Content): PlanetRow[] {
  return systemRows(state, empireId, content).flatMap((row) =>
    state.systems[row.id].planets.map(
      (planet, i): PlanetRow => ({
        system: row.id,
        systemName: row.name,
        sector: row.sector,
        number: i + 1,
        type: planet.type,
        status: row.status,
        owner: row.owner,
        room: planet.maxPopulation,
        food: planet.foodBonus,
        energy: planet.energyBonus,
        distance: row.distance,
        inRange: row.inRange,
      }),
    ),
  );
}
