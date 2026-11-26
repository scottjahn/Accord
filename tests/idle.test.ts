import { describe, expect, it } from 'vitest';
import {
  effectivePins,
  fleetRange,
  governorAllocation,
  idleReport,
  processTurn,
  sectorDistance,
  sectorKey,
  submitCommand,
  suppliedSectors,
  systemSummary,
  type BuildingId,
  type Command,
  type GameState,
  type IdleItem,
  type Outputs,
} from '../src/sim';
import { ALPHA, BETA, addFleet, colonyOf, homeOf, newGame } from './fixture';

const NONE: Outputs = { food: 0, industry: 0, energy: 0, intel: 0, research: 0 };

function setup() {
  const { state, content } = newGame(5);
  const home = homeOf(state, ALPHA);
  const apply = (s: GameState, cmd: Command): GameState => {
    const r = submitCommand(s, cmd, content);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.value;
  };
  const why = (s: GameState, cmd: Command) => {
    const r = submitCommand(s, cmd, content);
    return r.ok ? 'ok' : r.error.message;
  };
  const govern = (s: GameState, governor: 'balanced' | 'growth' | 'manual') => apply(s, { type: 'setGovernor', empire: ALPHA, system: home.id, governor });
  const pin = (s: GameState, pinned: Partial<Outputs>) => apply(s, { type: 'adjustWorkers', empire: ALPHA, system: home.id, pinned: { ...NONE, ...pinned } });
  return { state, content, home, apply, why, govern, pin };
}

describe('placing workers by hand under a governor', () => {
  it('keeps hand-placed workers where they are and lets the governor place the rest', () => {
    const { state, govern, pin } = setup();
    const balanced = govern(state, 'balanced');
    expect(colonyOf(balanced, ALPHA).allocation).toEqual({ food: 5, industry: 0, energy: 0, intel: 1, research: 4 });

    const adjusted = pin(balanced, { industry: 2 });
    const colony = colonyOf(adjusted, ALPHA);
    expect(colony.governor).toBe('balanced');
    expect(colony.pinned).toEqual({ ...NONE, industry: 2 });
    // The other eight: five still farm, and the governor splits three.
    expect(colony.allocation).toEqual({ food: 5, industry: 2, energy: 0, intel: 0, research: 3 });
    expect(Object.values(colony.allocation).reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('counts hand-placed workers toward what the colony needs', () => {
    const { state, content, govern, pin } = setup();
    // Six farmers by hand already feed everyone, so the governor adds none.
    const adjusted = pin(govern(state, 'balanced'), { food: 6 });
    expect(colonyOf(adjusted, ALPHA).allocation.food).toBe(6);
    expect(governorAllocation(adjusted, homeOf(adjusted, ALPHA), content, 'balanced').food).toBe(6);
  });

  it('survives the turn: new population goes where the governor sends it', () => {
    const { state, content, govern, pin } = setup();
    const adjusted = pin(govern(state, 'growth'), { industry: 2 });
    colonyOf(adjusted, ALPHA).growthProgress = 59;
    const next = processTurn(adjusted, content).state;
    const colony = colonyOf(next, ALPHA);
    expect(colony.population).toBe(11);
    expect(colony.governor).toBe('growth');
    expect(colony.pinned.industry).toBe(2);
    expect(colony.allocation.industry).toBeGreaterThanOrEqual(2);
    expect(Object.values(colony.allocation).reduce((a, b) => a + b, 0)).toBe(11);
  });

  it('keeps the adjustment when the governor is changed, and drops it under Manual', () => {
    const { state, govern, pin } = setup();
    const adjusted = pin(govern(state, 'balanced'), { industry: 2 });
    expect(colonyOf(govern(adjusted, 'growth'), ALPHA).pinned.industry).toBe(2);
    const manual = govern(adjusted, 'manual');
    expect(colonyOf(manual, ALPHA).pinned).toEqual(NONE);
    expect(colonyOf(manual, ALPHA).allocation).toEqual(colonyOf(adjusted, ALPHA).allocation);
  });

  it('is dropped when the player sets the allocation directly', () => {
    const { state, home, apply, govern, pin } = setup();
    const adjusted = pin(govern(state, 'balanced'), { industry: 2 });
    const direct = apply(adjusted, { type: 'setAllocation', empire: ALPHA, system: home.id, allocation: { ...NONE, food: 6, industry: 4 } });
    expect(colonyOf(direct, ALPHA)).toMatchObject({ governor: 'manual', pinned: NONE });
  });

  it('gives way if the population falls below the hand-placed workers', () => {
    const { state, content, govern, pin } = setup();
    const adjusted = pin(govern(state, 'balanced'), { industry: 4, research: 5 });
    const colony = colonyOf(adjusted, ALPHA);
    colony.population = 6;
    // Research is given up first, then the rest in order.
    expect(effectivePins(colony)).toEqual({ ...NONE, industry: 4, research: 2 });
    const allocation = governorAllocation(adjusted, homeOf(adjusted, ALPHA), content, 'balanced');
    expect(Object.values(allocation).reduce((a, b) => a + b, 0)).toBe(6);
  });

  it('is refused under Manual, for more workers than there are, or for bad numbers', () => {
    const { state, home, why, govern } = setup();
    const cmd = (pinned: unknown): Command => ({ type: 'adjustWorkers', empire: ALPHA, system: home.id, pinned: pinned as Outputs });
    expect(why(state, cmd({ ...NONE, industry: 1 }))).toMatch(/under Manual, set the workers directly/);
    const balanced = govern(state, 'balanced');
    expect(why(balanced, cmd({ ...NONE, industry: 11 }))).toBe('That places 11 workers by hand but population is 10');
    expect(why(balanced, cmd({ ...NONE, industry: -1 }))).toMatch(/whole number/);
    expect(why(balanced, cmd({ industry: 1 }))).toMatch(/whole number/);
    expect(why(balanced, { ...cmd({ ...NONE, industry: 1 }), empire: BETA } as Command)).toMatch(/does not own/);
    expect(why(balanced, cmd({ ...NONE, industry: 10 }))).toBe('ok');
  });
});

describe('limiting workers under a governor', () => {
  const FREE = { food: null, industry: null, energy: null, intel: null, research: null };
  const total = (a: Outputs) => Object.values(a).reduce((x, y) => x + y, 0);

  it('holds an output to the limit and sends the workers turned away elsewhere', () => {
    const { state, home, apply, govern } = setup();
    const balanced = govern(state, 'balanced');
    const limited = apply(balanced, { type: 'capWorkers', empire: ALPHA, system: home.id, capped: { ...FREE, research: 2 } });
    const colony = colonyOf(limited, ALPHA);
    expect(colony.governor).toBe('balanced');
    expect(colony.capped).toEqual({ ...FREE, research: 2 });
    // Research had four; the two turned away join the one on intel.
    expect(colony.allocation).toEqual({ food: 5, industry: 0, energy: 0, intel: 3, research: 2 });
  });

  it('is a fixed number: it does not grow with the colony', () => {
    const { state, content, home, apply, govern } = setup();
    const limited = apply(govern(state, 'growth'), { type: 'capWorkers', empire: ALPHA, system: home.id, capped: { ...FREE, research: 1 } });
    colonyOf(limited, ALPHA).growthProgress = 59;
    let next = processTurn(limited, content).state;
    expect(colonyOf(next, ALPHA).population).toBe(11);
    colonyOf(next, ALPHA).population = 30;
    next = apply(next, { type: 'setGovernor', empire: ALPHA, system: home.id, governor: 'research' as never });
    const colony = colonyOf(next, ALPHA);
    expect(colony.capped.research).toBe(1);
    expect(colony.allocation.research).toBe(1);
    expect(total(colony.allocation)).toBe(30);
  });

  it('may hold food below what the colony eats', () => {
    const { state, home, apply, govern } = setup();
    const hungry = apply(govern(state, 'balanced'), { type: 'placeWorkers', empire: ALPHA, system: home.id, output: 'food', workers: 2 });
    expect(colonyOf(hungry, ALPHA).allocation.food).toBe(2);
    expect(total(colonyOf(hungry, ALPHA).allocation)).toBe(10);
  });

  it('leaves workers idle only when every output is at its limit', () => {
    const { state, content, home, apply, govern } = setup();
    const shut = apply(govern(state, 'balanced'), {
      type: 'capWorkers',
      empire: ALPHA,
      system: home.id,
      capped: { food: 3, industry: 1, energy: 0, intel: 1, research: 1 },
    });
    expect(colonyOf(shut, ALPHA).allocation).toEqual({ food: 3, industry: 1, energy: 0, intel: 1, research: 1 });
    expect(idleReport(shut, ALPHA, content)).toContainEqual({ kind: 'idleWorkers', blocking: true, system: home.id, count: 4 });
  });

  it('never moves workers the player placed by hand', () => {
    const { state, home, apply, govern, pin } = setup();
    const pinned = pin(govern(state, 'balanced'), { research: 3 });
    const limited = apply(pinned, { type: 'capWorkers', empire: ALPHA, system: home.id, capped: { ...FREE, research: 1 } });
    // The governor adds none of its own, but the three stay.
    expect(colonyOf(limited, ALPHA).allocation.research).toBe(3);
  });

  it('placeWorkers turns one number into a limit, hand-placed workers, or neither', () => {
    const { state, home, apply, govern } = setup();
    const place = (s: GameState, output: keyof Outputs, workers: number) =>
      apply(s, { type: 'placeWorkers', empire: ALPHA, system: home.id, output, workers });
    const balanced = govern(state, 'balanced');
    expect(colonyOf(balanced, ALPHA).allocation.research).toBe(4);

    const fewer = place(balanced, 'research', 2);
    expect(colonyOf(fewer, ALPHA)).toMatchObject({ capped: { ...FREE, research: 2 }, pinned: NONE });
    expect(colonyOf(fewer, ALPHA).allocation.research).toBe(2);

    // Asking for more lifts the limit and places the difference by hand.
    const more = place(fewer, 'research', 7);
    expect(colonyOf(more, ALPHA).capped).toEqual(FREE);
    expect(colonyOf(more, ALPHA).pinned.research).toBeGreaterThan(0);
    expect(colonyOf(more, ALPHA).allocation.research).toBe(7);
    expect(total(colonyOf(more, ALPHA).allocation)).toBe(10);

    // Asking for what the governor would do anyway leaves no adjustment behind.
    const same = place(more, 'research', 4);
    expect(colonyOf(same, ALPHA)).toMatchObject({ capped: FREE, pinned: NONE });
    expect(colonyOf(same, ALPHA).allocation).toEqual(colonyOf(balanced, ALPHA).allocation);

    for (let n = 0; n <= 10; n++) expect(colonyOf(place(balanced, 'industry', n), ALPHA).allocation.industry).toBe(n);
  });

  it('is dropped under Manual and when the allocation is set directly', () => {
    const { state, home, apply, govern } = setup();
    const limited = apply(govern(state, 'balanced'), { type: 'capWorkers', empire: ALPHA, system: home.id, capped: { ...FREE, research: 2 } });
    expect(colonyOf(govern(limited, 'growth'), ALPHA).capped.research).toBe(2);
    expect(colonyOf(govern(limited, 'manual'), ALPHA).capped).toEqual(FREE);
    const direct = apply(limited, { type: 'setAllocation', empire: ALPHA, system: home.id, allocation: { ...NONE, food: 6, industry: 4 } });
    expect(colonyOf(direct, ALPHA).capped).toEqual(FREE);
  });

  it('is refused under Manual, for bad numbers, and for more workers than are free', () => {
    const { state, home, why, govern, pin } = setup();
    const cap = (capped: unknown): Command => ({ type: 'capWorkers', empire: ALPHA, system: home.id, capped: capped as never });
    const place = (workers: number, output = 'research'): Command => ({ type: 'placeWorkers', empire: ALPHA, system: home.id, output: output as never, workers });
    expect(why(state, cap({ ...FREE, research: 1 }))).toMatch(/under Manual, set the workers directly/);
    expect(why(state, place(1))).toMatch(/Under Manual, set the workers directly/);
    const balanced = govern(state, 'balanced');
    expect(why(balanced, cap({ ...FREE, research: -1 }))).toMatch(/whole number/);
    expect(why(balanced, cap({ ...FREE, research: 1.5 }))).toMatch(/whole number/);
    expect(why(balanced, cap({ research: 1 }))).toMatch(/whole number/);
    expect(why(balanced, { ...cap(FREE), empire: BETA } as Command)).toMatch(/does not own/);
    expect(why(balanced, cap({ ...FREE, research: 0 }))).toBe('ok');
    expect(why(balanced, place(-1))).toMatch(/whole number/);
    expect(why(balanced, place(1, 'gold'))).toBe('No output gold');
    expect(why(balanced, place(10))).toBe('ok');
    expect(why(pin(balanced, { industry: 4 }), place(7))).toBe('Only 6 workers are free: 4 are placed by hand elsewhere');
  });
});

describe('what is idle', () => {
  type C = ReturnType<typeof newGame>['content'];
  /** The items worth a warning; free systems nearby are reported separately and only mentioned. */
  const urgent = (state: GameState, content: C) => idleReport(state, ALPHA, content).filter((i) => i.blocking);
  const kinds = (state: GameState, content: C) => urgent(state, content).map((i) => i.kind);
  const unsettled = (state: GameState, content: C) =>
    idleReport(state, ALPHA, content).flatMap((i) => (i.kind === 'unsettled' ? [i.count] : []))[0] ?? 0;

  it('flags idle workers and an empty build queue in a colony', () => {
    const { state, content, home } = setup();
    expect(urgent(state, content)).toEqual([{ kind: 'emptyQueue', blocking: true, system: home.id }]);

    colonyOf(state, ALPHA).allocation = { ...NONE, food: 6, industry: 1 };
    colonyOf(state, ALPHA).buildQueue = [{ kind: 'building', building: 'lab' as BuildingId, progress: 0 }];
    expect(urgent(state, content)).toEqual([{ kind: 'idleWorkers', blocking: true, system: home.id, count: 3 }]);
  });

  it('does not flag an empty queue when nothing can be built', () => {
    const { state, content } = setup();
    const colony = colonyOf(state, ALPHA);
    for (const id of Object.keys(content.buildings) as BuildingId[]) colony.buildings[id] = content.buildings[id].maxPerSystem;
    state.empires[ALPHA].research.levels.weapons = 1;
    // Everything is built to its limit, and fleet support is used up by ships already in service.
    addFleet(state, content, ALPHA, homeOf(state, ALPHA).sector, ['frigate', 'frigate', 'frigate']);
    expect(kinds(state, content)).toEqual([]);
  });

  it('flags a colony ship with no orders, and says when it could found a colony where it is', () => {
    const { state, content, home } = setup();
    colonyOf(state, ALPHA).buildQueue = [{ kind: 'building', building: 'lab' as BuildingId, progress: 0 }];
    const fleet = addFleet(state, content, ALPHA, home.sector, ['colony_ship']);
    expect(urgent(state, content)).toEqual([{ kind: 'colonyShip', blocking: true, fleet: fleet.id, canFound: null }]);
    const before = unsettled(state, content);

    const free = Object.values(state.systems).find((s) => !s.colony)!;
    const taken = new Set(Object.values(state.systems).map((s) => sectorKey(s.sector)));
    free.sector = [-1, 0, 1]
      .flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: home.sector.x + dx, y: home.sector.y + dy })))
      .find((s) => s.x >= 0 && s.y >= 0 && s.x < 8 && s.y < 6 && !taken.has(sectorKey(s)))!;
    free.planets = [{ type: 'terran', maxPopulation: 12, foodBonus: 10, energyBonus: 0 }];
    state.empires[ALPHA].knownSystems[free.id] = null;

    // In range but nobody is going: mentioned, not a warning.
    expect(unsettled(state, content)).toBe(before + 1);
    expect(idleReport(state, ALPHA, content)).toContainEqual({ kind: 'unsettled', blocking: false, count: before + 1 });

    state.fleets[fleet.id].sector = { ...free.sector };
    expect(idleReport(state, ALPHA, content)).toContainEqual({ kind: 'colonyShip', blocking: true, fleet: fleet.id, canFound: free.id });

    // Once it has its order it is no longer idle, and the system is spoken for.
    state.fleets[fleet.id].order = 'colonise';
    expect(kinds(state, content)).toEqual([]);
    expect(unsettled(state, content)).toBe(before);
  });

  it('leaves warships alone: standing guard is not idleness', () => {
    const { state, content, home } = setup();
    colonyOf(state, ALPHA).buildQueue = [{ kind: 'building', building: 'lab' as BuildingId, progress: 0 }];
    addFleet(state, content, ALPHA, home.sector, ['frigate']);
    expect(kinds(state, content)).toEqual([]);
  });

  it('flags a scout with no orders only while there is something in reach it has not seen', () => {
    const { state, content, home } = setup();
    colonyOf(state, ALPHA).buildQueue = [{ kind: 'building', building: 'lab' as BuildingId, progress: 0 }];
    const scout = addFleet(state, content, ALPHA, home.sector, ['scout']);
    const within = suppliedSectors(state, ALPHA, fleetRange(state, scout, content));
    const unseen = Object.values(state.systems).filter((s) => !(s.id in state.empires[ALPHA].knownSystems) && within.has(sectorKey(s.sector)));
    expect(unseen.length).toBeGreaterThan(0);
    expect(urgent(state, content)).toEqual([{ kind: 'scout', blocking: true, fleet: scout.id, unexplored: expect.any(Array) }]);
    // It names each unexplored system, nearest first.
    const listed = (urgent(state, content)[0] as Extract<IdleItem, { kind: 'scout' }>).unexplored;
    expect([...listed].sort()).toEqual(unseen.map((s) => s.id).sort());
    const away = listed.map((id) => sectorDistance(scout.sector, state.systems[id].sector));
    expect(away).toEqual([...away].sort((a, b) => a - b));

    // On its way somewhere, it is busy.
    const moving = structuredClone(state);
    moving.fleets[scout.id].destination = { ...unseen[0].sector };
    expect(kinds(moving, content)).toEqual([]);

    // With everything in reach scanned, a parked scout is standing watch.
    for (const system of unseen) state.empires[ALPHA].knownSystems[system.id] = null;
    expect(kinds(state, content)).toEqual([]);

    // A rival's scout is never the player's problem.
    expect(idleReport(state, ALPHA, content).some((i) => i.kind === 'scout')).toBe(false);
  });

  it('reports only the empire asked about, and nothing once the game is over', () => {
    const { state, content } = setup();
    expect(idleReport(state, BETA, content).every((i) => i.kind !== 'emptyQueue' || i.system === homeOf(state, BETA).id)).toBe(true);
    state.winner = BETA;
    expect(idleReport(state, ALPHA, content)).toEqual([]);
  });
});

describe('system summary', () => {
  it('adds up room for people and the planets’ bonuses', () => {
    const { state } = setup();
    expect(systemSummary(homeOf(state, ALPHA))).toEqual({ maxPopulation: 40, foodBonus: 5, energyBonus: 5 });
  });
});
