import type { Content } from './content';
import { allies, treatiesBetween } from './diplomacy';
import { coloniesOf, fleetsOf } from './fleets';
import { sectorKey, sectorsAround } from './geometry';
import { sortedKeys, type EmpireId, type SystemId } from './ids';
import type { Fleet, GameState } from './types';

/** Keys of every sector the empire can see right now: around its colonies and its fleets. */
export function visibleSectors(state: GameState, empireId: EmpireId, content: Content): Set<string> {
  const visible = new Set<string>();
  // Allies share what they see, from the turn after the alliance is signed: sight that
  // appeared mid-turn would let an order be judged on facts the empire had not yet been shown.
  const sharing = allies(state, empireId).filter((ally) =>
    treatiesBetween(state, empireId, ally).some((t) => t.type === 'alliance' && t.startTurn < state.turn),
  );
  for (const viewer of [empireId, ...sharing]) {
    for (const system of coloniesOf(state, viewer)) {
      sectorsAround(state.galaxy, system.sector, content.rules.fleets.colonyScanRange, visible);
    }
    for (const fleet of fleetsOf(state, viewer)) {
      const scan = Math.max(0, ...fleet.ships.map((s) => content.hulls[s.hull]?.scan ?? 0));
      sectorsAround(state.galaxy, fleet.sector, scan, visible);
    }
  }
  // Surveillance from a gather-intel operation shows the target's colonies.
  const watched = state.empires[empireId]?.revealedUntil ?? {};
  for (const target of sortedKeys(watched)) {
    if (watched[target] < state.turn) continue;
    for (const system of coloniesOf(state, target)) visible.add(sectorKey(system.sector));
  }
  return visible;
}

/** Records what the empire can see now as its last-known picture. Mutates the empire. */
export function updateKnownSystems(state: GameState, empireId: EmpireId, content: Content): void {
  const visible = visibleSectors(state, empireId, content);
  const known = state.empires[empireId].knownSystems;
  for (const id of sortedKeys(state.systems)) {
    const system = state.systems[id];
    if (visible.has(sectorKey(system.sector))) known[id] = system.colony?.owner ?? null;
  }
}

export interface SystemSight {
  /** The empire has scanned this system at some point, so its planets are known. */
  known: boolean;
  /** The empire can see this system right now. */
  visible: boolean;
  /** Current owner if visible, otherwise the owner when last seen; null if unclaimed or unknown. */
  owner: EmpireId | null;
}

/**
 * What one empire is allowed to know. The UI draws from this, and the AI must
 * decide from this, so neither sees through fog of war.
 */
export interface EmpireView {
  empire: EmpireId;
  visible: Set<string>;
  systems: Record<SystemId, SystemSight>;
  /** The empire's own fleets plus foreign fleets in visible sectors. */
  fleets: Fleet[];
}

export function getEmpireView(state: GameState, empireId: EmpireId, content: Content): EmpireView {
  const visible = visibleSectors(state, empireId, content);
  const knownSystems = state.empires[empireId].knownSystems;
  const systems = {} as Record<SystemId, SystemSight>;
  for (const id of sortedKeys(state.systems)) {
    const system = state.systems[id];
    const seen = visible.has(sectorKey(system.sector));
    const known = seen || id in knownSystems;
    systems[id] = {
      known,
      visible: seen,
      owner: seen ? (system.colony?.owner ?? null) : (knownSystems[id] ?? null),
    };
  }
  const fleets = sortedKeys(state.fleets)
    .map((id) => state.fleets[id])
    .filter((f) => f.owner === empireId || visible.has(sectorKey(f.sector)));
  return { empire: empireId, visible, systems, fleets };
}
