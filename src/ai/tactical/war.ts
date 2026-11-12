import {
  atWar,
  coloniesOf,
  findPath,
  fleetsOf,
  sameSector,
  sectorDistance,
  sortedKeys,
  type Content,
  type EmpireId,
  type Fleet,
  type GameState,
  type StarSystem,
} from '../../sim';
import type { Planner } from '../agent';

/** A fleet below this share of its full hull goes home to repair. */
const RETREAT_PERCENT = 50;
/** Share of landed troops assumed to count, to leave a margin over the garrison. */
const TROOP_MARGIN_PERCENT = 75;

const nearest = <T extends { sector: Fleet['sector']; id: string }>(items: T[], to: Fleet['sector']): T | undefined =>
  [...items].sort((a, b) => sectorDistance(a.sector, to) - sectorDistance(b.sector, to) || (a.id < b.id ? -1 : 1))[0];

/** Empires this one is at war with and that are still in the game. */
export function enemiesOf(known: GameState, empireId: EmpireId): EmpireId[] {
  return sortedKeys(known.empires).filter((id) => !known.empires[id].eliminated && atWar(known, empireId, id));
}

/** Known colonies of the given empires, nearest to this empire's territory first. */
export function knownColoniesOf(known: GameState, empireId: EmpireId, owners: EmpireId[]): StarSystem[] {
  const mine = coloniesOf(known, empireId);
  const memory = known.empires[empireId].knownSystems;
  const distance = (s: StarSystem) => mine.reduce((best, c) => Math.min(best, sectorDistance(c.sector, s.sector)), Infinity);
  return sortedKeys(memory)
    .filter((id) => memory[id] !== null && owners.includes(memory[id] as EmpireId))
    .map((id) => known.systems[id])
    .sort((a, b) => distance(a) - distance(b) || (a.id < b.id ? -1 : 1));
}

/** A rough measure of what a set of fleets can do in a fight. */
export function fleetPower(fleets: Fleet[], content: Content): number {
  let power = 0;
  for (const fleet of fleets) {
    for (const ship of fleet.ships) {
      const hull = content.hulls[ship.hull];
      if (hull && hull.attack > 0) power += hull.attack * 2 + Math.floor(ship.hp / 5);
    }
  }
  return power;
}

/**
 * Runs the war: picks the nearest enemy colony the fleets can reach, gathers
 * warships and transports at the friendly colony closest to it, strikes when
 * enough have gathered, and sends damaged fleets home to repair.
 * `strikeSize` is how many warships must gather before they go.
 */
export function wageWar(plan: Planner, empireId: EmpireId, content: Content, strikeSize: number): void {
  const yard = content.rules.fleets.shipyardBuilding;
  const role = (fleet: Fleet) => new Set(fleet.ships.map((s) => content.hulls[s.hull]?.role));
  const idle = (fleet: Fleet) => !fleet.destination && fleet.order === 'none';
  const mine = () => fleetsOf(plan.state, empireId);
  const warFleets = () => mine().filter((f) => role(f).size === 1 && role(f).has('warship'));
  const transportFleets = () => mine().filter((f) => f.ships.some((s) => (content.hulls[s.hull]?.troops ?? 0) > 0));
  const hullPercent = (fleet: Fleet) => {
    const now = fleet.ships.reduce((sum, s) => sum + s.hp, 0);
    const full = fleet.ships.reduce((sum, s) => sum + (content.hulls[s.hull]?.hp ?? s.hp), 0);
    return Math.floor((now * 100) / full);
  };

  const colonies = coloniesOf(plan.state, empireId);
  const enemies = enemiesOf(plan.state, empireId);
  if (colonies.length === 0 || enemies.length === 0) return;

  // Winning needs the rival's home system, so aim for it: of the enemy colonies a
  // warship can reach (supply range decides), take the one nearest that home.
  // Each capture extends supply, so this advances on the home step by step.
  const probe = warFleets()[0];
  const reachable = knownColoniesOf(plan.state, empireId, enemies).filter(
    (s) => !probe || findPath(plan.state, probe, s.sector, content) !== null,
  );
  const homes = enemies.map((id) => plan.state.systems[plan.state.empires[id].homeSystem]).filter((s) => s !== undefined);
  const toHome = (s: StarSystem) => homes.reduce((best, h) => Math.min(best, sectorDistance(h.sector, s.sector)), Infinity);
  // Until the rival home has been found, push the front outward: of the nearest
  // enemy colonies, take the one farthest from our own home, which leads into their territory.
  const myHome = plan.state.systems[plan.state.empires[empireId].homeSystem];
  const fromHome = (s: StarSystem) => (myHome ? sectorDistance(myHome.sector, s.sector) : 0);
  const gap = (s: StarSystem) => colonies.reduce((best, c) => Math.min(best, sectorDistance(c.sector, s.sector)), Infinity);
  const frontier = reachable.filter((s) => gap(s) <= gap(reachable[0]) + 1);
  const target =
    homes.length === 0
      ? [...frontier].sort((a, b) => fromHome(b) - fromHome(a) || (a.id < b.id ? -1 : 1))[0]
      : [...reachable].sort((a, b) => toHome(a) - toHome(b) || (a.id < b.id ? -1 : 1))[0];
  if (!target) return;
  const staging = nearest(colonies, target.sector)!;
  const yards = colonies.filter((c) => (c.colony!.buildings[yard] ?? 0) > 0);

  for (const { id } of warFleets()) {
    const fleet = plan.state.fleets[id];
    if (!fleet || !idle(fleet)) continue;
    if (fleet.stance !== 'engage') plan.attempt({ type: 'setStance', empire: empireId, fleet: id, stance: 'engage' });

    const docked = yards.some((y) => sameSector(y.sector, fleet.sector));
    if (hullPercent(fleet) < RETREAT_PERCENT || (docked && hullPercent(fleet) < 90)) {
      const haven = nearest(yards, fleet.sector);
      if (haven && !docked) plan.attempt({ type: 'moveFleet', empire: empireId, fleet: id, to: haven.sector });
      continue;
    }
    if (sameSector(fleet.sector, target.sector) || sameSector(fleet.sector, staging.sector)) continue;
    plan.attempt({ type: 'moveFleet', empire: empireId, fleet: id, to: staging.sector });
  }

  // Combine what has gathered into one strike fleet and send it when it is big enough.
  const gathered = warFleets().filter((f) => idle(f) && sameSector(f.sector, staging.sector) && hullPercent(f) >= 90);
  if (gathered.length > 0) {
    const [lead, ...rest] = gathered;
    for (const other of rest) plan.attempt({ type: 'mergeFleets', empire: empireId, from: other.id, into: lead.id });
    if (plan.state.fleets[lead.id].ships.length >= strikeSize) {
      plan.attempt({ type: 'moveFleet', empire: empireId, fleet: lead.id, to: target.sector });
    }
  }

  // Transports wait at the staging colony until warships are on their way, then land.
  const striking = warFleets().some((f) => sameSector(f.destination ?? f.sector, target.sector));
  const waiting = transportFleets().filter((f) => idle(f) && sameSector(f.sector, staging.sector));
  const troops = waiting.reduce((sum, f) => sum + f.ships.reduce((n, s) => n + (content.hulls[s.hull]?.troops ?? 0), 0), 0);
  // The garrison is only known once the strike fleet has the colony in sight, so troops wait for that.
  const garrison = target.colony ? target.colony.population * content.rules.combat.garrisonPerPopulation : null;
  const enough = garrison !== null && Math.floor((troops * TROOP_MARGIN_PERCENT) / 100) > garrison;

  for (const { id } of transportFleets()) {
    const fleet = plan.state.fleets[id];
    if (!fleet || !idle(fleet)) continue;
    if (sameSector(fleet.sector, staging.sector)) {
      if (striking && enough) plan.attempt({ type: 'invadeSystem', empire: empireId, fleet: id, system: target.id });
    } else {
      plan.attempt({ type: 'moveFleet', empire: empireId, fleet: id, to: staging.sector });
    }
  }
}
