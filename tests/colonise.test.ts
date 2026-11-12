import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/data';
import { runGame } from '../src/runner/runGame';
import {
  checkInvariants,
  coloniesOf,
  fleetsOf,
  getEmpireView,
  processTurn,
  sectorDistance,
  sectorKey,
  submitCommand,
  visibleSectors,
  type Command,
  type GameState,
  type StarSystem,
  type SystemId,
} from '../src/sim';
import { ALPHA, BETA, addFleet, colonyOf, homeOf, newGame } from './fixture';

/** An unclaimed system, moved next to Alpha's home so it is in range and already scanned. */
function setup(seed = 5) {
  const { state, content } = newGame(seed);
  const home = homeOf(state, ALPHA);
  const taken = new Set(Object.values(state.systems).map((s) => sectorKey(s.sector)));
  const free = [-1, 0, 1]
    .flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: home.sector.x + dx, y: home.sector.y + dy })))
    .find((s) => s.x >= 0 && s.y >= 0 && s.x < 8 && s.y < 6 && !taken.has(sectorKey(s)))!;
  const target = Object.values(state.systems).find((s) => !s.colony && !(s.id in state.empires[ALPHA].knownSystems))!;
  target.sector = free;
  target.planets = [{ type: 'terran', maxPopulation: 12, foodBonus: 10, energyBonus: 0 }];
  state.empires[ALPHA].knownSystems[target.id] = null;
  state.empires[BETA].knownSystems[target.id] = null;

  const apply = (s: GameState, cmd: Command): GameState => {
    const r = submitCommand(s, cmd, content);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.value;
  };
  const codeOf = (s: GameState, cmd: Command) => {
    const r = submitCommand(s, cmd, content);
    return r.ok ? 'ok' : r.error.code;
  };
  return { state, content, home, target, apply, codeOf };
}

describe('colonisation', () => {
  it('sends a colony ship to a system and founds a colony when it arrives', () => {
    const { state, content, home, target, apply } = setup();
    const fleet = addFleet(state, content, ALPHA, home.sector, ['colony_ship']);
    let s = apply(state, { type: 'coloniseSystem', empire: ALPHA, fleet: fleet.id, system: target.id });
    expect(s.fleets[fleet.id]).toMatchObject({ destination: target.sector, order: 'colonise' });

    const step = processTurn(s, content);
    s = step.state;
    expect(step.events).toContainEqual({ type: 'colonyFounded', empire: ALPHA, system: target.id });
    const colony = s.systems[target.id].colony!;
    expect(colony).toMatchObject({ owner: ALPHA, population: 2, governor: 'balanced', buildings: {}, buildQueue: [] });
    expect(Object.values(colony.allocation).reduce((a, b) => a + b, 0)).toBe(2);
    // The colony ship is used up, and with it the fleet.
    expect(s.fleets[fleet.id]).toBeUndefined();
    expect(coloniesOf(s, ALPHA)).toHaveLength(2);
    expect(s.empires[ALPHA].knownSystems[target.id]).toBe(ALPHA);
    expect(checkInvariants(s, content)).toEqual([]);
  });

  it('uses one colony ship and keeps the rest of the fleet', () => {
    const { state, content, target, apply } = setup();
    const fleet = addFleet(state, content, ALPHA, target.sector, ['frigate', 'colony_ship', 'colony_ship']);
    let s = apply(state, { type: 'coloniseSystem', empire: ALPHA, fleet: fleet.id, system: target.id });
    expect(s.fleets[fleet.id].destination).toBeNull(); // already there
    s = processTurn(s, content).state;
    expect(s.fleets[fleet.id].ships.map((x) => x.hull)).toEqual(['frigate', 'colony_ship']);
    expect(s.fleets[fleet.id].order).toBe('none');
  });

  it('extends supply range from the new colony', () => {
    const { state, content, home, target, apply } = setup();
    const settlers = addFleet(state, content, ALPHA, target.sector, ['colony_ship']);
    const scout = addFleet(state, content, ALPHA, home.sector, ['frigate']);
    // A sector in range of the target but not of home.
    const beyond = [-3, 3]
      .flatMap((d) => [
        { x: home.sector.x + d, y: home.sector.y },
        { x: home.sector.x, y: home.sector.y + d },
      ])
      .find((s) => s.x >= 0 && s.y >= 0 && s.x < 8 && s.y < 6 && sectorDistance(s, target.sector) <= 2);
    if (!beyond) return; // this seed's geometry leaves no such sector on the map
    const move: Command = { type: 'moveFleet', empire: ALPHA, fleet: scout.id, to: beyond };
    expect(submitCommand(state, move, content).ok).toBe(false);
    let s = apply(state, { type: 'coloniseSystem', empire: ALPHA, fleet: settlers.id, system: target.id });
    s = processTurn(s, content).state;
    expect(submitCommand(s, move, content).ok).toBe(true);
  });

  it('rejects colonising without a colony ship, an owned system, a tiny system or an unknown one', () => {
    const { state, content, home, target, codeOf } = setup();
    const warships = addFleet(state, content, ALPHA, home.sector, ['frigate']);
    const settlers = addFleet(state, content, ALPHA, home.sector, ['colony_ship']);
    const order = (fleet: string, system: SystemId): Command => ({ type: 'coloniseSystem', empire: ALPHA, fleet: fleet as never, system });

    expect(codeOf(state, order(warships.id, target.id))).toBe('cannotColonise');
    expect(codeOf(state, order(settlers.id, home.id))).toBe('cannotColonise');

    const unknown = Object.values(state.systems).find((s) => !(s.id in state.empires[ALPHA].knownSystems))!;
    expect(codeOf(state, order(settlers.id, unknown.id))).toBe('unknownSystem');

    target.planets = [{ type: 'barren', maxPopulation: 1, foodBonus: -5, energyBonus: 5 }];
    expect(codeOf(state, order(settlers.id, target.id))).toBe('cannotColonise');
  });

  it('rejects known systems outside supply range', () => {
    const { state, content, home, codeOf } = setup();
    const settlers = addFleet(state, content, ALPHA, home.sector, ['colony_ship']);
    const far = Object.values(state.systems).find((s: StarSystem) => !s.colony && sectorDistance(s.sector, home.sector) > 2)!;
    state.empires[ALPHA].knownSystems[far.id] = null;
    expect(codeOf(state, { type: 'coloniseSystem', empire: ALPHA, fleet: settlers.id, system: far.id })).toBe('outOfRange');
  });

  it('fails cleanly if someone else settles the system first', () => {
    const { state, content, home, target, apply } = setup();
    const fleet = addFleet(state, content, ALPHA, home.sector, ['colony_ship']);
    const s = apply(state, { type: 'coloniseSystem', empire: ALPHA, fleet: fleet.id, system: target.id });
    s.systems[target.id].colony = { ...structuredClone(colonyOf(s, BETA)), population: 2 };
    const step = processTurn(s, content);
    expect(step.events).toContainEqual({ type: 'coloniseFailed', empire: ALPHA, system: target.id });
    expect(step.state.fleets[fleet.id]).toMatchObject({ order: 'none', destination: null });
    expect(step.state.fleets[fleet.id].ships).toHaveLength(1);
    expect(step.state.systems[target.id].colony!.owner).toBe(BETA);
  });

  it('settles a same-turn race with a seeded roll: one winner, the loser keeps its ship', () => {
    const winners = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { state, content, target, apply } = setup(seed);
      const a = addFleet(state, content, ALPHA, target.sector, ['colony_ship']);
      const b = addFleet(state, content, BETA, target.sector, ['colony_ship']);
      // Beta's fleet sits outside Beta's supply; give the order directly.
      let s = apply(state, { type: 'coloniseSystem', empire: ALPHA, fleet: a.id, system: target.id });
      s.fleets[b.id].order = 'colonise';

      const first = processTurn(s, content);
      const again = processTurn(s, content);
      expect(first.state).toEqual(again.state); // same seed, same outcome

      const owner = first.state.systems[target.id].colony!.owner;
      const loser = owner === ALPHA ? b : a;
      winners.add(owner);
      expect(first.state.fleets[loser.id].ships).toHaveLength(1);
      expect(first.state.fleets[owner === ALPHA ? a.id : b.id]).toBeUndefined();
      expect(first.events).toContainEqual({ type: 'coloniseFailed', empire: loser.owner, system: target.id });
      expect(first.events.filter((e) => e.type === 'colonyFounded')).toHaveLength(1);
    }
    expect(winners.size).toBe(2); // across seeds both sides win sometimes
  });
});

describe('fog of war', () => {
  it('sees around colonies and fleets only', () => {
    const { state, content, home } = setup();
    const visible = visibleSectors(state, ALPHA, content);
    expect(visible.has(sectorKey(home.sector))).toBe(true);
    for (const key of visible) {
      const [x, y] = key.split(',').map(Number);
      expect(sectorDistance({ x, y }, home.sector)).toBeLessThanOrEqual(1);
    }
    const enemyHome = homeOf(state, BETA).sector;
    expect(visible.has(sectorKey(enemyHome))).toBe(false);

    const far = { x: home.sector.x < 4 ? 7 : 0, y: home.sector.y };
    addFleet(state, content, ALPHA, far, ['scout']); // scan 2
    const wider = visibleSectors(state, ALPHA, content);
    expect(wider.has(sectorKey(far))).toBe(true);
    expect(wider.has(sectorKey({ x: far.x === 7 ? 5 : 2, y: far.y }))).toBe(true);
  });

  it('starts knowing only what the home system can scan', () => {
    const { state } = newGame(5);
    const known = state.empires[ALPHA].knownSystems;
    const home = homeOf(state, ALPHA);
    expect(known[home.id]).toBe(ALPHA);
    for (const id of Object.keys(known) as SystemId[]) {
      expect(sectorDistance(state.systems[id].sector, home.sector)).toBeLessThanOrEqual(1);
    }
    expect(homeOf(state, BETA).id in known).toBe(false);
  });

  it('remembers the last owner seen after losing sight', () => {
    const { state, content } = newGame(5);
    const enemyHome = homeOf(state, BETA);
    const scout = addFleet(state, content, ALPHA, enemyHome.sector, ['scout']);

    let s = processTurn(state, content).state;
    expect(s.empires[ALPHA].knownSystems[enemyHome.id]).toBe(BETA);
    let view = getEmpireView(s, ALPHA, content);
    expect(view.systems[enemyHome.id]).toEqual({ known: true, visible: true, owner: BETA });

    delete s.fleets[scout.id];
    s = processTurn(s, content).state;
    view = getEmpireView(s, ALPHA, content);
    expect(view.systems[enemyHome.id]).toEqual({ known: true, visible: false, owner: BETA });
  });

  it('hides unscanned systems and foreign fleets outside vision', () => {
    const { state, content } = newGame(5);
    const enemyHome = homeOf(state, BETA);
    const theirs = addFleet(state, content, BETA, enemyHome.sector, ['frigate']);
    const mine = addFleet(state, content, ALPHA, homeOf(state, ALPHA).sector, ['frigate']);

    const view = getEmpireView(state, ALPHA, content);
    expect(view.systems[enemyHome.id]).toEqual({ known: false, visible: false, owner: null });
    expect(view.fleets.map((f) => f.id)).toEqual([mine.id]);

    const theirView = getEmpireView(state, BETA, content);
    expect(theirView.fleets.map((f) => f.id)).toEqual([theirs.id]);

    state.fleets[theirs.id].sector = { ...homeOf(state, ALPHA).sector };
    expect(getEmpireView(state, ALPHA, content).fleets.map((f) => f.id).sort()).toEqual([theirs.id, mine.id].sort());
  });
});

/**
 * Milestone 3 exit test: you can expand and build a navy. Played headless by
 * the baseline agents on the shipped content.
 */
describe('expansion', () => {
  const content = loadContent();

  it.each([1, 2, 3])('seed %i: by turn 150 each empire holds 4+ systems and 3+ warships', (seed) => {
    const state = runGame({ content, seed, turns: 150, preset: 'small', factions: ['concord', 'vashran'] });
    for (const empire of Object.values(state.empires)) {
      const warships = fleetsOf(state, empire.id)
        .flatMap((f) => f.ships)
        .filter((s) => content.hulls[s.hull].role === 'warship');
      expect(coloniesOf(state, empire.id).length).toBeGreaterThanOrEqual(4);
      expect(warships.length).toBeGreaterThanOrEqual(3);
      expect(Object.values(empire.research.levels).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    }
  });

  it('gives each empire its starting ships as separate fleets by role', () => {
    const state = runGame({ content, seed: 1, turns: 0, preset: 'small', factions: ['concord', 'vashran'] });
    for (const empire of Object.values(state.empires)) {
      const fleets = fleetsOf(state, empire.id);
      expect(fleets.map((f) => f.ships.map((s) => s.hull))).toEqual([['scout'], ['colony_ship']]);
      for (const f of fleets) expect(f.sector).toEqual(state.systems[empire.homeSystem].sector);
    }
  });
});
