import {
  coloniesOf,
  empireRange,
  fleetsOf,
  maxPopulationOf,
  sectorDistance,
  sectorKey,
  sortedKeys,
  suppliedSectors,
  type Content,
  type EmpireId,
  type GameState,
  type HullRole,
  type Sector,
  type StarSystem,
} from '../sim';

export interface Opportunity {
  system: StarSystem;
  /** Higher is a better place to settle. */
  score: number;
}

/** What an empire can tell about the galaxy from its redacted state. */
export interface Picture {
  colonies: StarSystem[];
  population: number;
  /** Free systems worth settling that are inside supply range, best first. */
  opportunities: Opportunity[];
  /** Independent minor races this empire has found and can reach with its supply range. */
  minors: StarSystem[];
  /** Systems never scanned, anywhere on the map. */
  unexplored: StarSystem[];
  /** Sectors of known rival colonies and of rival fleets in sight. */
  rivals: Sector[];
}

/** Distance from a sector to the nearest known rival presence; Infinity if none is known. */
export function threatDistance(picture: Picture, sector: Sector): number {
  return picture.rivals.reduce((best, r) => Math.min(best, sectorDistance(r, sector)), Infinity);
}

/** Builds the opportunity and threat picture for one empire. */
export function survey(known: GameState, empireId: EmpireId, content: Content): Picture {
  const me = known.empires[empireId];
  const colonies = coloniesOf(known, empireId);
  const reach = suppliedSectors(known, empireId, empireRange(known, empireId, content));
  const minPopulation = content.rules.fleets.colonyStartPopulation;

  const rivals: Sector[] = [];
  for (const id of sortedKeys(me.knownSystems)) {
    const owner = me.knownSystems[id];
    if (owner !== null && owner !== empireId) rivals.push(known.systems[id].sector);
  }
  for (const id of sortedKeys(known.fleets)) {
    if (known.fleets[id].owner !== empireId) rivals.push(known.fleets[id].sector);
  }
  const picture: Picture = {
    colonies,
    population: colonies.reduce((sum, s) => sum + s.colony!.population, 0),
    opportunities: [],
    minors: sortedKeys(me.knownSystems)
      .map((id) => known.systems[id])
      .filter((s) => s.minor && reach.has(sectorKey(s.sector))),
    unexplored: sortedKeys(known.systems)
      .filter((id) => !(id in me.knownSystems))
      .map((id) => known.systems[id]),
    rivals,
  };

  for (const id of sortedKeys(me.knownSystems)) {
    const system = known.systems[id];
    // A minor race's home cannot be settled; it is courted or conquered instead.
    if (me.knownSystems[id] !== null || system.colony || system.minor) continue;
    const capacity = maxPopulationOf(system);
    if (capacity < minPopulation || !reach.has(sectorKey(system.sector))) continue;
    const food = system.planets.reduce((sum, p) => sum + p.foodBonus, 0);
    const energy = system.planets.reduce((sum, p) => sum + p.energyBonus, 0);
    const distance = colonies.reduce((best, c) => Math.min(best, sectorDistance(c.sector, system.sector)), Infinity);
    const contested = threatDistance(picture, system.sector) <= 2 ? 6 : 0;
    picture.opportunities.push({ system, score: capacity + food / 2 + energy / 4 - 2 * distance - contested });
  }
  picture.opportunities.sort((a, b) => b.score - a.score || (a.system.id < b.system.id ? -1 : 1));
  return picture;
}

/** Ships of a role the empire has or is building. */
export function shipsWithRole(known: GameState, empireId: EmpireId, content: Content, role: HullRole): number {
  let count = 0;
  for (const fleet of fleetsOf(known, empireId)) {
    count += fleet.ships.filter((s) => content.hulls[s.hull]?.role === role).length;
  }
  for (const system of coloniesOf(known, empireId)) {
    count += system.colony!.buildQueue.filter((i) => i.kind === 'ship' && content.hulls[i.hull]?.role === role).length;
  }
  return count;
}
