import { maxPopulationOf, sortedKeys, type Content, type GameState, type SystemId } from '../../sim';
import { sectorCenter } from './camera';

export const NEUTRAL_COLOR = 0xb8c0d4;

export interface MapSystem {
  id: SystemId;
  name: string;
  /** World coordinates of the star. */
  x: number;
  y: number;
  sector: { x: number; y: number };
  /** Owner's faction colour, or the neutral colour if unclaimed. */
  color: number;
  owned: boolean;
  isHome: boolean;
  /** Dot radius in world units, larger for systems that can hold more people. */
  radius: number;
}

export interface MapScene {
  width: number;
  height: number;
  systems: MapSystem[];
}

/** Everything the renderer needs to draw the galaxy, derived from the game state. */
export function buildScene(state: GameState, content: Content): MapScene {
  const homes = new Set<SystemId>(sortedKeys(state.empires).map((id) => state.empires[id].homeSystem));
  const systems = sortedKeys(state.systems).map((id): MapSystem => {
    const system = state.systems[id];
    const owner = system.colony ? state.empires[system.colony.owner] : null;
    const color = owner ? content.factions[owner.faction]?.color : undefined;
    return {
      id,
      name: system.name,
      ...sectorCenter(system.sector),
      sector: system.sector,
      color: color ? parseInt(color.slice(1), 16) : NEUTRAL_COLOR,
      owned: owner !== null,
      isHome: homes.has(id),
      radius: 4 + Math.min(5, Math.floor(maxPopulationOf(system) / 12)),
    };
  });
  return { width: state.galaxy.width, height: state.galaxy.height, systems };
}
