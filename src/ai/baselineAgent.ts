import {
  coloniesOf,
  empireRange,
  fleetsOf,
  maxPopulationOf,
  sectorDistance,
  sectorKey,
  applyValidated,
  sortedKeys,
  suppliedSectors,
  validateCommand,
  type Command,
  type Content,
  type EmpireId,
  type GameState,
  type HullRole,
  type StarSystem,
  type SystemId,
} from '../sim';

/**
 * Placeholder player until the real AI arrives in milestone 4. It hands every
 * colony to the balanced governor, keeps the build queues busy, settles the
 * nearest free systems it knows about and sends scouts to unexplored ones.
 *
 * It only targets systems in its own `knownSystems`, and it tries each command
 * against a working copy of the state so everything it returns is legal in order.
 * Deterministic: no randomness, decisions depend only on the state.
 */
export function baselineAgent(state: GameState, empireId: EmpireId, content: Content): Command[] {
  const issued: Command[] = [];
  const current = structuredClone(state);
  const attempt = (command: Command): boolean => {
    if (validateCommand(current, command, content)) return false;
    applyValidated(current, command, content);
    issued.push(command);
    return true;
  };

  const roleOf = (hull: string) => content.hulls[hull as keyof typeof content.hulls]?.role;
  const shipsWithRole = (role: HullRole): number => {
    let count = 0;
    for (const fleet of fleetsOf(current, empireId)) count += fleet.ships.filter((s) => roleOf(s.hull) === role).length;
    for (const system of coloniesOf(current, empireId)) {
      count += system.colony!.buildQueue.filter((i) => i.kind === 'ship' && roleOf(i.hull) === role).length;
    }
    return count;
  };
  const buildShip = (system: SystemId, role: HullRole): boolean =>
    sortedKeys(content.hulls)
      .filter((id) => content.hulls[id].role === role)
      .sort((a, b) => content.hulls[b].tier - content.hulls[a].tier)
      .some((hull) => attempt({ type: 'enqueueShip', empire: empireId, system, hull }));

  /** Known, unclaimed systems that could hold a colony, nearest to `from` first. */
  const freeSystems = (from: StarSystem['sector']): StarSystem[] => {
    const known = current.empires[empireId].knownSystems;
    return sortedKeys(known)
      .filter((id) => known[id] === null)
      .map((id) => current.systems[id])
      .filter((s) => maxPopulationOf(s) >= content.rules.fleets.colonyStartPopulation)
      .sort((a, b) => sectorDistance(a.sector, from) - sectorDistance(b.sector, from) || (a.id < b.id ? -1 : 1));
  };

  let reach: Set<string> | undefined;
  let targets: number | undefined;
  for (const system of coloniesOf(current, empireId)) {
    const id = system.id;
    if (system.colony!.governor !== 'balanced') attempt({ type: 'setGovernor', empire: empireId, system: id, governor: 'balanced' });
    if (current.systems[id].colony!.buildQueue.length > 0) continue;

    const colonies = coloniesOf(current, empireId).length;
    // Supply reach and free targets do not change while queueing builds, so work them out once.
    reach ??= suppliedSectors(current, empireId, empireRange(current, empireId, content));
    targets ??= freeSystems(system.sector).filter((s) => reach!.has(sectorKey(s.sector))).length;
    // A small home guard first, then settlers, then a navy that grows with the empire.
    if (colonies >= 2 && shipsWithRole('warship') < 3 && buildShip(id, 'warship')) continue;
    if (targets > shipsWithRole('colony') && buildShip(id, 'colony')) continue;
    if (current.turn % 3 !== 0 && shipsWithRole('warship') < 2 + colonies && buildShip(id, 'warship')) continue;

    const buildings = sortedKeys(content.buildings);
    for (let i = 0; i < buildings.length; i++) {
      const building = buildings[(current.turn + i) % buildings.length];
      if (attempt({ type: 'enqueueBuild', empire: empireId, system: id, building })) break;
    }
  }

  for (const { id } of fleetsOf(current, empireId)) {
    const fleet = current.fleets[id];
    if (!fleet || fleet.destination || fleet.order !== 'none') continue;
    const roles = new Set(fleet.ships.map((s) => roleOf(s.hull)));

    if (roles.has('colony')) {
      const claimed = new Set(
        fleetsOf(current, empireId)
          .filter((f) => f.order === 'colonise')
          .map((f) => sectorKey(f.destination ?? f.sector)),
      );
      freeSystems(fleet.sector)
        .filter((s) => !claimed.has(sectorKey(s.sector)))
        .some((s) => attempt({ type: 'coloniseSystem', empire: empireId, fleet: id, system: s.id }));
    } else if (roles.size === 1 && roles.has('scout')) {
      // Star positions are public; what is there is not until a scout arrives.
      const known = current.empires[empireId].knownSystems;
      sortedKeys(current.systems)
        .filter((s) => !(s in known))
        .map((s) => current.systems[s])
        .sort((a, b) => sectorDistance(a.sector, fleet.sector) - sectorDistance(b.sector, fleet.sector) || (a.id < b.id ? -1 : 1))
        .some((s) => attempt({ type: 'moveFleet', empire: empireId, fleet: id, to: s.sector }));
    }
  }

  return issued;
}
