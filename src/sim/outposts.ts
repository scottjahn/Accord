import type { Content } from './content';
import { atWar } from './combat';
import { coloniesOf, fleetIsArmed, fleetsOf, isStranded, systemAt } from './fleets';
import { inBounds, sameSector, sectorDistance } from './geometry';
import { sortedKeys, type EmpireId, type FleetId, type OutpostId } from './ids';
import { foreignClaimant } from './territory';
import type { Fleet, GameState, Outpost, Sector, TurnEvent } from './types';

/**
 * Outposts: starbases built from a troop transport in empty space. They claim
 * territory (rules.outposts.borderRange), extend supply and give sight, and
 * fall to any enemy at war that holds their sector with armed ships while the
 * owner has none there. They do not keep an empire alive and are not colonies.
 *
 * Building one is two steps, like founding a colony: the transport goes there,
 * then `buildOutpost` orders it, and the outpost stands when the turn resolves.
 */

export function outpostsOf(state: GameState, empireId: EmpireId): Outpost[] {
  return sortedKeys(state.outposts)
    .map((id) => state.outposts[id])
    .filter((o) => o.owner === empireId);
}

/** How many outposts the empire may keep: one per `coloniesPerOutpost` colonies. */
export function outpostAllowance(state: GameState, empireId: EmpireId, content: Content): number {
  const per = content.rules.outposts.coloniesPerOutpost;
  return per <= 0 ? 0 : Math.floor(coloniesOf(state, empireId).length / per);
}

const hasTransport = (fleet: Pick<Fleet, 'ships'>, content: Content): boolean =>
  fleet.ships.some((s) => content.hulls[s.hull]?.role === 'transport');

/**
 * Why this empire cannot build an outpost at this sector, or null if it can.
 * `except` is the fleet asking, so its own pending order is not counted against it.
 */
export function outpostSiteBlocker(
  state: GameState,
  empireId: EmpireId,
  sector: Sector,
  content: Content,
  except: FleetId | null = null,
): string | null {
  const rules = content.rules.outposts;
  if (rules.coloniesPerOutpost <= 0) return 'Outposts are not in use';
  if (!inBounds(state.galaxy, sector)) return 'That sector is off the map';
  if (systemAt(state, sector)) return 'Outposts are built in empty space, not at a star system';
  const claimant = foreignClaimant(state, empireId, sector, content);
  if (claimant) return `This sector lies inside ${content.factions[state.empires[claimant]?.faction]?.name ?? 'another power'}'s border`;
  for (const id of sortedKeys(state.outposts)) {
    if (sectorDistance(state.outposts[id].sector, sector) < rules.minSpacing) return `Too close to another outpost (they must be ${rules.minSpacing} sectors apart)`;
  }
  const pending = fleetsOf(state, empireId).filter((f) => f.order === 'outpost' && f.id !== except);
  for (const fleet of pending) {
    if (sectorDistance(fleet.sector, sector) < rules.minSpacing) return 'Too close to another outpost being built';
  }
  const allowance = outpostAllowance(state, empireId, content);
  if (outpostsOf(state, empireId).length + pending.length >= allowance) {
    return `The empire can keep ${allowance} outpost${allowance === 1 ? '' : 's'}: one for every ${rules.coloniesPerOutpost} colonies`;
  }
  return null;
}

/** Why this fleet cannot build an outpost where it is, or null if it can. */
export function outpostBlocker(state: GameState, fleet: Fleet, content: Content): string | null {
  if (!hasTransport(fleet, content)) return 'Only a troop transport can build an outpost';
  if (isStranded(state, fleet, content)) return 'The fleet is outside supply range';
  return outpostSiteBlocker(state, fleet.owner, fleet.sector, content, fleet.id);
}

/**
 * Outposts held by an enemy fall, then outposts ordered this turn are built,
 * in fleet-id order: of two too close together, the first stands. Mutates the state.
 */
export function resolveOutposts(state: GameState, content: Content, events: TurnEvent[]): void {
  for (const id of sortedKeys(state.outposts)) {
    const outpost = state.outposts[id];
    const armedHere = (empire: EmpireId) =>
      fleetsOf(state, empire).some((f) => sameSector(f.sector, outpost.sector) && fleetIsArmed(f, content));
    if (armedHere(outpost.owner)) continue;
    const by = sortedKeys(state.empires).find((e) => atWar(state, e, outpost.owner) && armedHere(e));
    if (!by) continue;
    delete state.outposts[id];
    events.push({ type: 'outpostLost', empire: outpost.owner, by, sector: { ...outpost.sector } });
  }

  // Every builder's order is cleared first, so each is judged against the outposts already standing.
  const builders = sortedKeys(state.fleets).filter((id) => state.fleets[id].order === 'outpost');
  for (const id of builders) state.fleets[id].order = 'none';
  for (const id of builders) {
    const fleet = state.fleets[id];
    if (fleet.destination) continue;
    const reason = outpostBlocker(state, fleet, content);
    if (reason) {
      events.push({ type: 'outpostFailed', empire: fleet.owner, sector: { ...fleet.sector }, reason });
      continue;
    }
    const outpost: Outpost = {
      id: `out-${String(state.nextId++).padStart(5, '0')}` as OutpostId,
      owner: fleet.owner,
      sector: { ...fleet.sector },
      built: state.turn,
    };
    state.outposts[outpost.id] = outpost;
    const ship = fleet.ships.findIndex((s) => content.hulls[s.hull]?.role === 'transport');
    fleet.ships.splice(ship, 1);
    if (fleet.ships.length === 0) delete state.fleets[id];
    events.push({ type: 'outpostBuilt', empire: outpost.owner, outpost: outpost.id, sector: { ...outpost.sector } });
  }
}
