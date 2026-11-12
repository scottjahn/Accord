import { describe, expect, it } from 'vitest';
import { runAgent } from '../../src/ai/agent';
import { standardAgent } from '../../src/ai/standardAgent';
import {
  getOutputs,
  processTurn,
  redactFor,
  serialize,
  submitCommand,
  submitCommands,
  type BuildingId,
  type GameState,
  type StarSystem,
} from '../../src/sim';
import { ALPHA, BETA, addFleet, colonyOf, homeOf, newGame } from '../fixture';

const unknownTo = (state: GameState, empire: typeof ALPHA): StarSystem =>
  Object.values(state.systems).find((s) => !s.colony && !(s.id in state.empires[empire].knownSystems))!;

describe('redacted state', () => {
  it('keeps everything about the empire itself', () => {
    const { state, content } = newGame(5);
    addFleet(state, content, ALPHA, homeOf(state, ALPHA).sector, ['scout']);
    const known = redactFor(state, ALPHA, content);
    expect(known.empires[ALPHA]).toEqual(state.empires[ALPHA]);
    expect(homeOf(known, ALPHA)).toEqual(homeOf(state, ALPHA));
    expect(Object.keys(known.fleets)).toEqual(Object.keys(state.fleets));
    expect(getOutputs(known, homeOf(known, ALPHA).id, content)).toEqual(getOutputs(state, homeOf(state, ALPHA).id, content));
    expect(known.turn).toBe(state.turn);
    expect(known.galaxy).toEqual(state.galaxy);
  });

  it('does not modify the real state', () => {
    const { state, content } = newGame(5);
    const before = serialize(state);
    redactFor(state, ALPHA, content);
    expect(serialize(state)).toBe(before);
  });

  it('strips systems that were never scanned down to their position', () => {
    const { state, content } = newGame(5);
    const hidden = unknownTo(state, ALPHA);
    const known = redactFor(state, ALPHA, content).systems[hidden.id];
    expect(known).toEqual({ id: hidden.id, name: '', sector: hidden.sector, planets: [], colony: null });
  });

  it('removes a rival colony that is out of sight but keeps the last owner seen', () => {
    const { state, content } = newGame(5);
    const enemyHome = homeOf(state, BETA);
    state.empires[ALPHA].knownSystems[enemyHome.id] = BETA;
    const known = redactFor(state, ALPHA, content);
    expect(known.systems[enemyHome.id].colony).toBeNull();
    expect(known.systems[enemyHome.id].planets).toEqual(enemyHome.planets);
    expect(known.empires[ALPHA].knownSystems[enemyHome.id]).toBe(BETA);
    expect(known.empires[BETA].homeSystem).toBe(enemyHome.id);
  });

  it('shows only the owner and population of a rival colony in sight', () => {
    const { state, content } = newGame(5);
    const enemyHome = homeOf(state, BETA);
    addFleet(state, content, ALPHA, enemyHome.sector, ['scout']);
    colonyOf(state, BETA).buildQueue = [{ kind: 'building', building: 'lab' as BuildingId, progress: 7 }];
    colonyOf(state, BETA).foodStock = 33;
    const seen = redactFor(state, ALPHA, content).systems[enemyHome.id].colony!;
    expect(seen).toMatchObject({ owner: BETA, population: 10, buildings: {}, buildQueue: [], foodStock: 0 });
  });

  it('hides rival fleets out of sight and shows those in sight', () => {
    const { state, content } = newGame(5);
    const far = addFleet(state, content, BETA, homeOf(state, BETA).sector, ['frigate']);
    const near = addFleet(state, content, BETA, homeOf(state, ALPHA).sector, ['frigate']);
    const known = redactFor(state, ALPHA, content);
    expect(known.fleets[far.id]).toBeUndefined();
    expect(known.fleets[near.id]).toEqual(near);
  });

  it("blanks rivals' research, pools, knowledge and undiscovered home, plus the seed, RNG and others' memory", () => {
    const { state, content } = newGame(5);
    state.empires[BETA].research.levels.weapons = 4;
    state.empires[BETA].intelPool = 99;
    state.agentMemory[ALPHA] = { posture: 'expand', postureTurn: 1 };
    state.agentMemory[BETA] = { posture: 'fortify', postureTurn: 1 };
    const known = redactFor(state, ALPHA, content);
    expect(known.empires[BETA].research.levels.weapons).toBe(0);
    expect(known.empires[BETA].intelPool).toBe(0);
    expect(known.empires[BETA].knownSystems).toEqual({});
    expect(known.empires[BETA].homeSystem).toBe('');
    expect(known.empires[BETA].faction).toBe('beta');
    expect(known.seed).toBe(0);
    expect(known.rng).toEqual([0, 0, 0, 0]);
    expect(known.agentMemory).toEqual({ [ALPHA]: { posture: 'expand', postureTurn: 1 } });
  });
});

describe('the AI cannot cheat', () => {
  /** Changes only things Alpha cannot see. */
  function alterHidden(state: GameState, content: ReturnType<typeof newGame>['content']): void {
    const hidden = unknownTo(state, ALPHA);
    hidden.planets = [{ type: 'terran', maxPopulation: 99, foodBonus: 50, energyBonus: 50 }];
    hidden.name = 'Eldorado';
    colonyOf(state, BETA).buildings['factory' as BuildingId] = 3;
    colonyOf(state, BETA).population = 30;
    state.empires[BETA].research.levels.weapons = 9;
    addFleet(state, content, BETA, homeOf(state, BETA).sector, ['frigate', 'frigate']);
    const other = Object.values(state.systems).find((s) => !s.colony && s.id !== hidden.id && !(s.id in state.empires[ALPHA].knownSystems))!;
    other.colony = { ...structuredClone(colonyOf(state, BETA)), population: 3 };
    state.rng = [1, 2, 3, 4];
    state.seed = 12345;
  }

  it('gets an identical view when only hidden things differ', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { state, content } = newGame(seed);
      const altered = structuredClone(state);
      alterHidden(altered, content);
      // Fleet and ship ids are a shared counter, which adding hidden rival ships advances.
      altered.nextId = state.nextId;
      expect(redactFor(altered, ALPHA, content)).toEqual(redactFor(state, ALPHA, content));
    }
  });

  it('issues identical commands when only hidden things differ', () => {
    for (const seed of [1, 2, 3]) {
      const { state, content } = newGame(seed);
      addFleet(state, content, ALPHA, homeOf(state, ALPHA).sector, ['scout']);
      addFleet(state, content, ALPHA, homeOf(state, ALPHA).sector, ['colony_ship']);
      const altered = structuredClone(state);
      alterHidden(altered, content);
      altered.nextId = state.nextId;
      const fair = runAgent(standardAgent, state, ALPHA, content);
      expect(fair.commands.length).toBeGreaterThan(0);
      expect(runAgent(standardAgent, altered, ALPHA, content)).toEqual(fair);
    }
  });

  it('issues commands that are legal on the real state', () => {
    const { state, content } = newGame(4);
    addFleet(state, content, ALPHA, homeOf(state, ALPHA).sector, ['scout']);
    addFleet(state, content, ALPHA, homeOf(state, ALPHA).sector, ['colony_ship']);
    const { commands } = runAgent(standardAgent, state, ALPHA, content);
    expect(submitCommands(state, commands, content).ok).toBe(true);
  });
});

describe('orders never reveal what fog hides', () => {
  it('accepts a colonise order for a system settled out of sight, then fails on arrival', () => {
    const { state, content } = newGame(5);
    const home = homeOf(state, ALPHA);
    // A free system Alpha scanned earlier, two sectors away: in supply range, out of sight.
    const target = unknownTo(state, ALPHA);
    target.sector = { x: home.sector.x + (home.sector.x < 6 ? 2 : -2), y: home.sector.y };
    target.planets = [{ type: 'terran', maxPopulation: 12, foodBonus: 10, energyBonus: 0 }];
    state.empires[ALPHA].knownSystems[target.id] = null;
    // Beta has since settled it, unseen.
    target.colony = { ...structuredClone(colonyOf(state, BETA)), population: 2 };

    const fleet = addFleet(state, content, ALPHA, home.sector, ['colony_ship']);
    const order = submitCommand(state, { type: 'coloniseSystem', empire: ALPHA, fleet: fleet.id, system: target.id }, content);
    expect(order.ok).toBe(true);
    if (!order.ok) return;

    let s = order.value;
    const events = [];
    for (let i = 0; i < 2; i++) {
      const step = processTurn(s, content);
      s = step.state;
      events.push(...step.events);
    }
    expect(events).toContainEqual({ type: 'coloniseFailed', empire: ALPHA, system: target.id });
    expect(s.fleets[fleet.id].ships).toHaveLength(1);
    expect(s.systems[target.id].colony!.owner).toBe(BETA);
    // Arriving revealed the truth, so the same order is now refused.
    expect(s.empires[ALPHA].knownSystems[target.id]).toBe(BETA);
    expect(submitCommand(s, { type: 'coloniseSystem', empire: ALPHA, fleet: fleet.id, system: target.id }, content).ok).toBe(false);
  });
});
