import type { Content } from './content';
import { atWar } from './combat';
import { addOpinion, borderPartners, hasMet } from './diplomacy';
import { sectorKey } from './geometry';
import { sortedKeys, type EmpireId } from './ids';
import type { Fleet, GameState, Sector, TurnEvent } from './types';

/**
 * Borders. Every colony claims the sectors within `rules.fleets.borderRange`
 * of it, and every outpost those within `rules.outposts.borderRange`; a sector goes to the nearest colony, and one equally near colonies of
 * two empires belongs to neither. A range of 0 turns borders off.
 *
 * Territory is judged on what an empire knows: its own colonies as they are,
 * everyone else's as last seen (`empire.knownSystems`). The real state and the
 * redacted one give the same answer, so an order is never refused because of
 * a colony the empire has not found.
 */

/** Sector key to the empire whose territory it is, as `viewer` knows it. Unclaimed and contested sectors are absent. */
export function territoryAsKnown(state: GameState, viewer: EmpireId, content: Content): Record<string, EmpireId> {
  return bordersAsKnown(state, viewer, content).territory;
}

/** Every claimed sector as `viewer` knows it: whose territory it is, or which empires tie for it. */
export interface BordersKnown {
  /** Sector key to the one empire whose territory it is. */
  territory: Record<string, EmpireId>;
  /** Sector key to the empires equally near it (two or more, sorted), so it is no one's. */
  contested: Record<string, EmpireId[]>;
}

export function bordersAsKnown(state: GameState, viewer: EmpireId, content: Content): BordersKnown {
  const range = content.rules.fleets.borderRange;
  const result: Record<string, EmpireId> = {};
  const contested: Record<string, EmpireId[]> = {};
  if (range <= 0) return { territory: result, contested };
  const known = state.empires[viewer]?.knownSystems ?? {};
  const claims: { owner: EmpireId; sector: Sector; range: number }[] = [];
  for (const id of sortedKeys(state.systems)) {
    const system = state.systems[id];
    // Its own colonies an empire always knows; for the rest, the owner it last saw.
    const last = known[id] ?? null;
    const owner = system.colony?.owner === viewer ? viewer : last === viewer ? null : last;
    if (owner !== null) claims.push({ owner, sector: system.sector, range });
  }
  // Where outposts stand is public.
  for (const id of sortedKeys(state.outposts)) {
    const outpost = state.outposts[id];
    claims.push({ owner: outpost.owner, sector: outpost.sector, range: content.rules.outposts.borderRange });
  }
  const best = new Map<string, { distance: number; owners: EmpireId[] }>();
  for (const { owner, sector, range } of claims) {
    const { x: cx, y: cy } = sector;
    for (let y = Math.max(0, cy - range); y <= Math.min(state.galaxy.height - 1, cy + range); y++) {
      for (let x = Math.max(0, cx - range); x <= Math.min(state.galaxy.width - 1, cx + range); x++) {
        const key = `${x},${y}`;
        const distance = Math.max(Math.abs(x - cx), Math.abs(y - cy));
        const current = best.get(key);
        if (!current || distance < current.distance) best.set(key, { distance, owners: [owner] });
        else if (distance === current.distance && !current.owners.includes(owner)) current.owners.push(owner);
      }
    }
  }
  for (const [key, claim] of best) {
    if (claim.owners.length === 1) result[key] = claim.owners[0];
    else contested[key] = [...claim.owners].sort();
  }
  return { territory: result, contested };
}

/** Where a sector stands, as one empire knows it: open space, one empire's territory, or contested by several. */
export type SectorStanding = { kind: 'open' } | { kind: 'territory'; owner: EmpireId } | { kind: 'contested'; claimants: EmpireId[] };

export function sectorStanding(borders: BordersKnown, sector: Sector): SectorStanding {
  const key = sectorKey(sector);
  const owner = borders.territory[key];
  if (owner !== undefined) return { kind: 'territory', owner };
  const claimants = borders.contested[key];
  return claimants ? { kind: 'contested', claimants } : { kind: 'open' };
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

/**
 * For each other empire, how many sectors of `of`'s territory touch its
 * territory (side by side, not corner to corner), in the territory given.
 */
export function borderContact(territory: Record<string, EmpireId>, of: EmpireId): Partial<Record<EmpireId, number>> {
  const contact: Partial<Record<EmpireId, number>> = {};
  for (const key of Object.keys(territory).sort()) {
    if (territory[key] !== of) continue;
    const [x, y] = key.split(',').map(Number);
    const neighbours = new Set<EmpireId>();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const owner = territory[`${x + dx},${y + dy}`];
      if (owner !== undefined && owner !== of) neighbours.add(owner);
    }
    for (const owner of neighbours) contact[owner] = (contact[owner] ?? 0) + 1;
  }
  return contact;
}

/** What each empire knew of the borders before the turn's settling, to tell what changed. */
export interface BorderSnapshot {
  territory: Record<string, EmpireId>;
  colonies: number;
  met: EmpireId[];
}

export function snapshotBorders(state: GameState, content: Content): Partial<Record<EmpireId, BorderSnapshot>> {
  const snapshot: Partial<Record<EmpireId, BorderSnapshot>> = {};
  if (content.rules.fleets.borderRange <= 0) return snapshot;
  const ids = sortedKeys(state.empires);
  for (const id of ids) {
    if (state.empires[id].eliminated) continue;
    snapshot[id] = {
      territory: territoryAsKnown(state, id, content),
      colonies: Object.values(state.systems).filter((s) => s.colony?.owner === id).length,
      met: ids.filter((other) => other !== id && hasMet(state, id, other)),
    };
  }
  return snapshot;
}

/**
 * Border pressure, judged on what each empire knows once the turn has settled.
 *
 * - An empire resents a rival it had already met, and is at peace with, whose
 *   territory now covers sectors that were its own: a new colony or outpost
 *   pushed in, or it has found one that does. Not if it lost a colony this turn.
 * - Every `borderPressure.everyTurns` turns, an empire adds grievances against
 *   each neighbour at peace whose borders are closed to it, one for every
 *   `sectorsPerGrievance` sectors of its territory that touch theirs.
 *
 * Mutates the state.
 */
export function pressBorders(
  state: GameState,
  content: Content,
  before: Partial<Record<EmpireId, BorderSnapshot>>,
  events: TurnEvent[],
): void {
  const rules = content.rules.diplomacy.borderPressure;
  const pressing = rules.everyTurns > 0 && state.turn % rules.everyTurns === 0;
  for (const of of sortedKeys(state.empires)) {
    const was = before[of];
    if (!was || state.empires[of].eliminated) continue;
    const now = territoryAsKnown(state, of, content);
    const colonies = Object.values(state.systems).filter((s) => s.colony?.owner === of).length;
    const lost: Partial<Record<EmpireId, number>> = {};
    if (colonies >= was.colonies) {
      for (const key of Object.keys(was.territory).sort()) {
        const owner = now[key];
        if (was.territory[key] === of && owner !== undefined && owner !== of) lost[owner] = (lost[owner] ?? 0) + 1;
      }
    }
    const contact = pressing ? borderContact(now, of) : {};
    for (const about of was.met) {
      if (state.empires[about].eliminated || atWar(state, of, about)) continue;
      const sectors = lost[about] ?? 0;
      if (sectors > 0) {
        addOpinion(state, of, about, 'borderEncroached');
        events.push({ type: 'borderEncroached', empire: of, by: about, sectors });
      }
      if (borderPartners(state, of).includes(about)) continue;
      const grievances = Math.min(rules.maxGrievances, Math.floor((contact[about] ?? 0) / rules.sectorsPerGrievance));
      for (let i = 0; i < grievances; i++) addOpinion(state, of, about, 'bordersPress');
    }
  }
}
