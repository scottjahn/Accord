import { validateCommand, type Command } from './commands';
import type { Content } from './content';
import { maxPopulationOf } from './economy/outputs';
import { coloniesOf, empireRange, fleetsOf, suppliedSectors, systemAt } from './fleets';
import { sectorKey } from './geometry';
import { sortedKeys, type EmpireId, type FleetId, type SystemId } from './ids';
import { OUTPUT_KINDS, type GameState } from './types';

/**
 * Something of the player's that is doing nothing this turn. `blocking` items
 * are worth a warning before the turn ends; the rest are only worth mentioning.
 */
export type IdleItem =
  | { kind: 'idleWorkers'; blocking: true; system: SystemId; count: number }
  | { kind: 'emptyQueue'; blocking: true; system: SystemId }
  /** A colony ship with no orders. `canFound` is the free system it is sitting at, if any. */
  | { kind: 'colonyShip'; blocking: true; fleet: FleetId; canFound: SystemId | null }
  /** Free systems inside supply range that nobody is heading out to settle. */
  | { kind: 'unsettled'; blocking: false; count: number };

/** Everything of an empire's that is idle right now, colonies first, in a stable order. */
export function idleReport(state: GameState, empireId: EmpireId, content: Content): IdleItem[] {
  const items: IdleItem[] = [];
  const empire = state.empires[empireId];
  if (!empire || empire.eliminated || state.winner !== null) return items;

  for (const system of coloniesOf(state, empireId)) {
    const colony = system.colony!;
    const idle = colony.population - OUTPUT_KINDS.reduce((sum, k) => sum + colony.allocation[k], 0);
    if (idle > 0) items.push({ kind: 'idleWorkers', blocking: true, system: system.id, count: idle });

    if (colony.buildQueue.length === 0) {
      // Only worth a warning if there is something this colony could actually build.
      const options: Command[] = [
        ...sortedKeys(content.buildings).map((building): Command => ({ type: 'enqueueBuild', empire: empireId, system: system.id, building })),
        ...sortedKeys(content.hulls).map((hull): Command => ({ type: 'enqueueShip', empire: empireId, system: system.id, hull })),
      ];
      if (options.some((o) => validateCommand(state, o, content) === null)) {
        items.push({ kind: 'emptyQueue', blocking: true, system: system.id });
      }
    }
  }

  const settlers = fleetsOf(state, empireId).filter((f) => f.ships.some((s) => content.hulls[s.hull]?.role === 'colony'));
  for (const fleet of settlers) {
    if (fleet.destination || fleet.order !== 'none') continue;
    const here = systemAt(state, fleet.sector);
    const canFound =
      here && validateCommand(state, { type: 'coloniseSystem', empire: empireId, fleet: fleet.id, system: here.id }, content) === null ? here.id : null;
    items.push({ kind: 'colonyShip', blocking: true, fleet: fleet.id, canFound });
  }

  // Free systems the empire knows of and could reach, less the ones a colony ship is already bound for.
  const reach = suppliedSectors(state, empireId, empireRange(state, empireId, content));
  const claimed = new Set(settlers.filter((f) => f.destination || f.order === 'colonise').map((f) => sectorKey(f.destination ?? f.sector)));
  const open = sortedKeys(empire.knownSystems).filter((id) => {
    const system = state.systems[id];
    return (
      empire.knownSystems[id] === null &&
      !system.minor &&
      maxPopulationOf(system) >= content.rules.fleets.colonyStartPopulation &&
      reach.has(sectorKey(system.sector)) &&
      !claimed.has(sectorKey(system.sector))
    );
  }).length;
  if (open > 0) items.push({ kind: 'unsettled', blocking: false, count: open });

  return items;
}
