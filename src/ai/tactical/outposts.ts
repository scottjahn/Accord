import { fleetsOf, sameSector, sectorDistance, sectorKey, type Content, type EmpireId, type Fleet } from '../../sim';
import type { Planner } from '../agent';
import type { Picture } from '../maps';

/**
 * In peacetime, idle transports build outposts: one standing on a good site
 * builds there, and the others set off for the nearest site nobody else of
 * ours is heading for, while the empire has outposts to spare. Building is a
 * step of its own, taken once the transport has arrived.
 */
export function plantOutposts(plan: Planner, empireId: EmpireId, content: Content, picture: Picture): void {
  const onlyTransports = (f: Fleet) => f.ships.length > 0 && f.ships.every((s) => content.hulls[s.hull]?.role === 'transport');
  const idle = (f: Fleet) => !f.destination && f.order === 'none';
  const transports = () => fleetsOf(plan.state, empireId).filter(onlyTransports);
  const sites = new Set(picture.outpostSites.map(sectorKey));
  let slots = picture.outpostSlots;
  // Transports already on their way to a site use up a slot.
  const heading = new Set(
    transports()
      .filter((f) => f.destination && sites.has(sectorKey(f.destination)))
      .map((f) => sectorKey(f.destination!)),
  );
  slots -= heading.size;

  for (const { id } of transports()) {
    if (slots <= 0) return;
    const fleet = plan.state.fleets[id];
    if (!fleet || !idle(fleet)) continue;
    if (sites.has(sectorKey(fleet.sector)) && plan.attempt({ type: 'buildOutpost', empire: empireId, fleet: id })) {
      slots--;
      continue;
    }
    // Of the five best sites, the nearest.
    const targets = picture.outpostSites
      .filter((s) => !heading.has(sectorKey(s)) && !sameSector(s, fleet.sector))
      .slice(0, 5)
      .sort((a, b) => sectorDistance(a, fleet.sector) - sectorDistance(b, fleet.sector));
    for (const site of targets) {
      if (plan.attempt({ type: 'moveFleet', empire: empireId, fleet: id, to: site })) {
        heading.add(sectorKey(site));
        slots--;
        break;
      }
    }
  }
}
