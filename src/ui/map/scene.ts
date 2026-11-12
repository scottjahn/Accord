import {
  fleetPlan,
  fleetRange,
  maxPopulationOf,
  sectorKey,
  sortedKeys,
  suppliedSectors,
  type Content,
  type EmpireView,
  type Fleet,
  type GameState,
  type Sector,
  type SystemId,
} from '../../sim';
import { sectorCenter, type Point } from './camera';

export const NEUTRAL_COLOR = 0xb8c0d4;

export interface MapSystem {
  id: SystemId;
  /** Empty until the player has scanned the system. */
  name: string;
  /** World coordinates of the star. */
  x: number;
  y: number;
  sector: Sector;
  /** The owner's faction colour as far as the player knows, or the neutral colour. */
  color: number;
  known: boolean;
  owned: boolean;
  isHome: boolean;
  /** Dot radius in world units, larger for systems that can hold more people. */
  radius: number;
}

export interface MapFleet {
  /** One marker per owner per sector. */
  key: string;
  sector: Sector;
  color: number;
  ships: number;
  own: boolean;
  selected: boolean;
  /** Which marker this is within its sector, so several owners do not overlap. */
  slot: number;
}

export interface MapScene {
  width: number;
  height: number;
  systems: MapSystem[];
  fleets: MapFleet[];
  /** Keys of sectors the player can see right now; everything else is fogged. */
  visible: Set<string>;
  /** Sectors the selected fleet can reach, or null if the player has none selected. */
  range: Set<string> | null;
  /** World points of the selected fleet's route, starting where it is now. */
  route: Point[] | null;
}

const hex = (color: string | undefined): number => (color ? parseInt(color.slice(1), 16) : NEUTRAL_COLOR);

/**
 * Everything the renderer needs to draw the galaxy for one player. Built from
 * the player's view, so nothing hidden by fog of war reaches the screen.
 */
export function buildScene(state: GameState, content: Content, view: EmpireView, selectedFleet: Fleet | null = null): MapScene {
  const factionColor = (empire: keyof typeof state.empires) => hex(content.factions[state.empires[empire].faction]?.color);

  const systems = sortedKeys(state.systems).map((id): MapSystem => {
    const system = state.systems[id];
    const sight = view.systems[id];
    const owner = sight.owner;
    return {
      id,
      name: sight.known ? system.name : '',
      ...sectorCenter(system.sector),
      sector: system.sector,
      color: owner ? factionColor(owner) : NEUTRAL_COLOR,
      known: sight.known,
      owned: owner !== null,
      isHome: owner !== null && state.empires[owner].homeSystem === id,
      radius: sight.known ? 4 + Math.min(5, Math.floor(maxPopulationOf(system) / 12)) : 3,
    };
  });

  const groups = new Map<string, MapFleet>();
  const slots = new Map<string, number>();
  for (const fleet of view.fleets) {
    const key = `${sectorKey(fleet.sector)}:${fleet.owner}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ships += fleet.ships.length;
      existing.selected ||= fleet.id === selectedFleet?.id;
      continue;
    }
    const slot = slots.get(sectorKey(fleet.sector)) ?? 0;
    slots.set(sectorKey(fleet.sector), slot + 1);
    groups.set(key, {
      key,
      sector: fleet.sector,
      color: factionColor(fleet.owner),
      ships: fleet.ships.length,
      own: fleet.owner === view.empire,
      selected: fleet.id === selectedFleet?.id,
      slot,
    });
  }

  let range: Set<string> | null = null;
  let route: Point[] | null = null;
  if (selectedFleet && selectedFleet.owner === view.empire) {
    range = suppliedSectors(state, selectedFleet.owner, fleetRange(state, selectedFleet, content));
    const plan = selectedFleet.destination ? fleetPlan(state, selectedFleet, selectedFleet.destination, content) : null;
    if (plan) route = [selectedFleet.sector, ...plan.path].map(sectorCenter);
  }

  return {
    width: state.galaxy.width,
    height: state.galaxy.height,
    systems,
    fleets: [...groups.values()],
    visible: view.visible,
    range,
    route,
  };
}
