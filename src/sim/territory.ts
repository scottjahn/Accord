import type { Content } from './content';
import { atWar } from './combat';
import { borderPartners } from './diplomacy';
import { sectorKey } from './geometry';
import { sortedKeys, type EmpireId } from './ids';
import type { Fleet, GameState, Sector } from './types';

/**
 * Borders. Every colony claims the sectors within `rules.fleets.borderRange`
 * of it; a sector goes to the nearest colony, and one equally near colonies of
 * two empires belongs to neither. A range of 0 turns borders off.
 *
 * Territory is judged on what an empire knows: its own colonies as they are,
 * everyone else's as last seen (`empire.knownSystems`). The real state and the
 * redacted one give the same answer, so an order is never refused because of
 * a colony the empire has not found.
 */

/** Sector key to the empire whose territory it is, as `viewer` knows it. Unclaimed and contested sectors are absent. */
export function territoryAsKnown(state: GameState, viewer: EmpireId, content: Content): Record<string, EmpireId> {
  const range = content.rules.fleets.borderRange;
  const result: Record<string, EmpireId> = {};
  if (range <= 0) return result;
  const known = state.empires[viewer]?.knownSystems ?? {};
  const best = new Map<string, { distance: number; owner: EmpireId | null }>();
  for (const id of sortedKeys(state.systems)) {
    const system = state.systems[id];
    // Its own colonies an empire always knows; for the rest, the owner it last saw.
    const last = known[id] ?? null;
    const owner = system.colony?.owner === viewer ? viewer : last === viewer ? null : last;
    if (owner === null) continue;
    const { x: cx, y: cy } = system.sector;
    for (let y = Math.max(0, cy - range); y <= Math.min(state.galaxy.height - 1, cy + range); y++) {
      for (let x = Math.max(0, cx - range); x <= Math.min(state.galaxy.width - 1, cx + range); x++) {
        const key = `${x},${y}`;
        const distance = Math.max(Math.abs(x - cx), Math.abs(y - cy));
        const current = best.get(key);
        if (!current || distance < current.distance) best.set(key, { distance, owner });
        else if (distance === current.distance && current.owner !== owner) current.owner = null;
      }
    }
  }
  for (const [key, claim] of best) if (claim.owner !== null) result[key] = claim.owner;
  return result;
}

/** The other empire whose territory this sector is, as `viewer` knows it, or null. */
export function foreignClaimant(state: GameState, viewer: EmpireId, sector: Sector, content: Content): EmpireId | null {
  const owner = territoryAsKnown(state, viewer, content)[sectorKey(sector)];
  return owner !== undefined && owner !== viewer ? owner : null;
}

/** True if this empire's ships may cross that empire's territory: at war, or under open borders or an alliance. */
export function bordersOpen(state: GameState, empire: EmpireId, owner: EmpireId): boolean {
  return empire === owner || atWar(state, empire, owner) || borderPartners(state, empire).includes(owner);
}

/** True if the fleet ignores borders. Scouts may go anywhere, so the galaxy can still be explored. */
export function crossesBorders(fleet: Pick<Fleet, 'ships'>, content: Content): boolean {
  return fleet.ships.length > 0 && fleet.ships.every((s) => content.hulls[s.hull]?.role === 'scout');
}

/** Keys of the sectors this empire's fleets may not enter: territory of empires that keep their borders closed to it. */
export function closedSectors(state: GameState, empire: EmpireId, content: Content): Set<string> {
  const closed = new Set<string>();
  const territory = territoryAsKnown(state, empire, content);
  const open = new Map<EmpireId, boolean>();
  for (const key of Object.keys(territory)) {
    const owner = territory[key];
    if (!open.has(owner)) open.set(owner, bordersOpen(state, empire, owner));
    if (!open.get(owner)) closed.add(key);
  }
  return closed;
}
