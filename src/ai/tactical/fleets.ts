import {
  fleetRange,
  fleetsOf,
  sameSector,
  sectorDistance,
  sectorKey,
  suppliedSectors,
  systemAt,
  validateCommand,
  type Content,
  type EmpireId,
  type Fleet,
  type HullRole,
  type Posture,
} from '../../sim';
import type { Planner } from '../agent';
import { threatDistance, type Picture } from '../maps';
import { colonyToDefend, threatenedColonies } from './war';

/**
 * Gives orders to idle fleets:
 * - colony ships go to the best free system nobody else is heading for;
 * - scouts go to the nearest unexplored system in their range;
 * - warships spread out so every colony has a guard, the most threatened first,
 *   and gather at a colony with an enemy fleet bearing down on it.
 */
export function directFleets(plan: Planner, empireId: EmpireId, content: Content, posture: Posture, picture: Picture): void {
  // At war the navy is run by wageWar instead of being spread out as guards.
  const guard = posture !== 'war';
  const rolesOf = (fleet: Fleet) => new Set<HullRole | undefined>(fleet.ships.map((s) => content.hulls[s.hull]?.role));
  const idle = (fleet: Fleet) => !fleet.destination && fleet.order === 'none';
  const heading = (fleet: Fleet) => sectorKey(fleet.destination ?? fleet.sector);
  const mine = () => fleetsOf(plan.state, empireId);

  // Settlers.
  // Founding is a step of its own: a settler that has arrived founds its colony, and one with
  // nowhere to be sets off for the best free system nobody else is heading for.
  const settling = (f: Fleet) => rolesOf(f).has('colony') && (f.destination !== null || f.order === 'colonise');
  const claimed = new Set(mine().filter(settling).map(heading));
  for (const { id } of mine()) {
    const fleet = plan.state.fleets[id];
    if (!fleet || !idle(fleet) || !rolesOf(fleet).has('colony')) continue;
    const here = systemAt(plan.state, fleet.sector);
    if (here && !claimed.has(sectorKey(here.sector)) && plan.attempt({ type: 'coloniseSystem', empire: empireId, fleet: id, system: here.id })) {
      claimed.add(sectorKey(here.sector));
      continue;
    }
    for (const { system } of picture.opportunities) {
      if (claimed.has(sectorKey(system.sector)) || sameSector(system.sector, fleet.sector)) continue;
      // 'notThere' is the sim saying this fleet could settle the system once it arrives.
      const verdict = validateCommand(plan.state, { type: 'coloniseSystem', empire: empireId, fleet: id, system: system.id }, content);
      if (verdict?.code !== 'notThere') continue;
      if (plan.attempt({ type: 'moveFleet', empire: empireId, fleet: id, to: system.sector })) {
        claimed.add(sectorKey(system.sector));
        break;
      }
    }
  }

  // Scouts.
  const scouted = new Set(mine().filter((f) => f.destination && rolesOf(f).has('scout')).map(heading));
  for (const { id } of mine()) {
    const fleet = plan.state.fleets[id];
    const roles = rolesOf(fleet);
    if (!idle(fleet) || roles.size !== 1 || !roles.has('scout')) continue;
    const range = suppliedSectors(plan.state, empireId, fleetRange(plan.state, fleet, content));
    const frontier = picture.unexplored
      .filter((s) => range.has(sectorKey(s.sector)) && !scouted.has(sectorKey(s.sector)))
      .sort((a, b) => sectorDistance(a.sector, fleet.sector) - sectorDistance(b.sector, fleet.sector) || (a.id < b.id ? -1 : 1));
    for (const system of frontier) {
      if (plan.attempt({ type: 'moveFleet', empire: empireId, fleet: id, to: system.sector })) {
        scouted.add(sectorKey(system.sector));
        break;
      }
    }
  }

  // Warships: one guard per colony, two where a rival is close and the posture is to fortify.
  const guards = new Map<string, number>();
  const warFleets = mine().filter((f) => {
    const roles = rolesOf(f);
    return roles.size === 1 && roles.has('warship');
  });
  for (const fleet of warFleets) guards.set(heading(fleet), (guards.get(heading(fleet)) ?? 0) + 1);

  // After the colonies come minor races that want protection: a guard there wins them over.
  const wards = picture.minors.filter((s) => content.minors[s.minor!.race]?.wants.includes('protection'));
  const posts = [
    ...[...picture.colonies].sort(
      (a, b) => threatDistance(picture, a.sector) - threatDistance(picture, b.sector) || (a.id < b.id ? -1 : 1),
    ),
    ...wards,
  ];
  const needAt = (sector: { x: number; y: number }) => (posture === 'fortify' && threatDistance(picture, sector) <= 4 ? 2 : 1);

  // Under attack the guards stop standing alone: those in reach gather at the colony in danger.
  const threatened = guard ? threatenedColonies(plan.state, empireId, content) : [];
  for (const { id } of guard ? warFleets : []) {
    const fleet = plan.state.fleets[id];
    if (!idle(fleet)) continue;
    const rescue = colonyToDefend(fleet, threatened, content);
    if (rescue) {
      if (fleet.stance !== 'engage') plan.attempt({ type: 'setStance', empire: empireId, fleet: id, stance: 'engage' });
      if (!sameSector(fleet.sector, rescue.sector)) plan.attempt({ type: 'moveFleet', empire: empireId, fleet: id, to: rescue.sector });
      continue;
    }
    const here = posts.find((c) => sameSector(c.sector, fleet.sector));
    if (here && (guards.get(sectorKey(here.sector)) ?? 0) <= needAt(here.sector)) continue; // needed where it is
    for (const post of posts) {
      const key = sectorKey(post.sector);
      if ((guards.get(key) ?? 0) >= needAt(post.sector) || sameSector(post.sector, fleet.sector)) continue;
      if (plan.attempt({ type: 'moveFleet', empire: empireId, fleet: id, to: post.sector })) {
        guards.set(key, (guards.get(key) ?? 0) + 1);
        guards.set(sectorKey(fleet.sector), (guards.get(sectorKey(fleet.sector)) ?? 1) - 1);
        break;
      }
    }
  }
}
