import type { Content } from './content';
import { sectorKey } from './geometry';
import { sortedKeys, type EmpireId, type SystemId } from './ids';
import { newResearchState } from './research';
import type { GameState } from './types';
import { getEmpireView } from './view';

/**
 * The game as one empire knows it: a copy of the state with everything fog of
 * war hides taken out. AI players are only ever given this, so they cannot
 * cheat, and every sim query works on it unchanged.
 *
 * - Systems never scanned keep their position (stars are visible from afar)
 *   but lose their name and planets.
 * - A rival colony in sight keeps its owner and population only; one out of
 *   sight is removed (the last owner seen stays in the empire's knownSystems).
 * - Rival fleets out of sight are removed.
 * - Rival empires keep their faction but lose research, pools, knowledge, and
 *   their home system unless this empire has found it.
 * - The seed, the RNG state and other players' AI memory are blanked.
 *
 * Commands that are legal on the redacted state are legal on the real one.
 */
export function redactFor(state: GameState, empireId: EmpireId, content: Content): GameState {
  const view = getEmpireView(state, empireId, content);
  const known = structuredClone(state);

  known.seed = 0;
  known.rng = [0, 0, 0, 0];
  known.agentMemory = empireId in state.agentMemory ? ({ [empireId]: known.agentMemory[empireId] } as GameState['agentMemory']) : {};

  for (const id of sortedKeys(known.systems)) {
    const system = known.systems[id];
    const sight = view.systems[id];
    if (!sight.known) {
      system.name = '';
      system.planets = [];
      system.colony = null;
      system.minor = null;
    } else if (!sight.visible) {
      system.colony = null;
    } else if (system.colony && system.colony.owner !== empireId) {
      system.colony = {
        owner: system.colony.owner,
        population: system.colony.population,
        growthProgress: 0,
        foodStock: 0,
        allocation: { food: 0, industry: 0, energy: 0, intel: 0, research: 0 },
        governor: 'manual',
        buildings: {},
        buildQueue: [],
        morale: 100,
        moraleEffects: [],
        unrestTurns: 0,
        minorRace: system.colony.minorRace,
      };
    }
    // An empire knows how a minor race feels about itself, not about its rivals.
    if (system.minor) {
      const own = system.minor.attitude[empireId];
      system.minor.attitude = (own === undefined ? {} : { [empireId]: own }) as typeof system.minor.attitude;
      if (system.minor.leader !== empireId) {
        system.minor.leader = null;
        system.minor.leadTurns = 0;
      }
    }
  }

  for (const id of sortedKeys(known.fleets)) {
    const fleet = known.fleets[id];
    if (fleet.owner !== empireId && !view.visible.has(sectorKey(fleet.sector))) delete known.fleets[id];
  }

  const mine = state.empires[empireId].knownSystems;
  for (const id of sortedKeys(known.empires)) {
    if (id === empireId) continue;
    const rival = known.empires[id];
    rival.research = newResearchState();
    rival.intelPool = 0;
    rival.knownSystems = {};
    rival.lastWarTurn = 0;
    rival.intelSplit = 0;
    rival.revealedUntil = {};
    // A rival's counter-intel is known only while it is under surveillance.
    if ((state.empires[empireId].revealedUntil[id] ?? -1) < state.turn) rival.counterIntel = 0;
    if (mine[rival.homeSystem] !== id) rival.homeSystem = '' as SystemId;
  }

  // Treaties are public. Offers, orders and memories are not, except the ones this empire is part of:
  // it knows what it thinks of others and what they think of it, but not what they think of each other.
  known.offers = known.offers.filter((o) => o.from === empireId || o.to === empireId);
  known.operations = known.operations.filter((o) => o.by === empireId);
  known.pendingEvents = [];
  const opinions = {} as GameState['opinions'];
  for (const of of sortedKeys(known.opinions)) {
    for (const about of sortedKeys(known.opinions[of])) {
      if (of === empireId || about === empireId) (opinions[of] ??= {})[about] = known.opinions[of][about];
    }
  }
  known.opinions = opinions;

  return known;
}
