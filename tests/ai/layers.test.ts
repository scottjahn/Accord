import { describe, expect, it } from 'vitest';
import { createPlanner } from '../../src/ai/agent';
import { survey, threatDistance } from '../../src/ai/maps';
import { setTargets, toPercents } from '../../src/ai/operational';
import { readMemory, standardAgent } from '../../src/ai/standardAgent';
import { choosePosture, scorePostures } from '../../src/ai/strategic';
import { chooseGovernor, manageColonies, scoreBuilding } from '../../src/ai/tactical/colonies';
import { directFleets } from '../../src/ai/tactical/fleets';
import {
  FIELDS,
  computeColonyEconomy,
  forecastColony,
  redactFor,
  sectorKey,
  type BuildingId,
  type FieldId,
  type GameState,
  type Sector,
  type StarSystem,
} from '../../src/sim';
import { ALPHA, BETA, addFleet, colonyOf, homeOf, newGame } from '../fixture';

/** Empty sectors next to Alpha's home, in a stable order. */
function neighbours(state: GameState): Sector[] {
  const home = homeOf(state, ALPHA).sector;
  const taken = new Set(Object.values(state.systems).map((s) => sectorKey(s.sector)));
  return [-1, 0, 1]
    .flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: home.x + dx, y: home.y + dy })))
    .filter((s) => s.x >= 0 && s.y >= 0 && s.x < 8 && s.y < 6 && !taken.has(sectorKey(s)));
}

/** Moves an unclaimed, unscanned system next to Alpha's home and marks it scanned. */
function placeFree(state: GameState, sector: Sector, maxPopulation: number, foodBonus = 0): StarSystem {
  const system = Object.values(state.systems).find((s) => !s.colony && !(s.id in state.empires[ALPHA].knownSystems))!;
  system.sector = sector;
  system.planets = [{ type: 'terran', maxPopulation, foodBonus, energyBonus: 0 }];
  state.empires[ALPHA].knownSystems[system.id] = null;
  return system;
}

/** A fresh game where Alpha's scanned neighbourhood is cleared of other systems, so tests control it. */
function setup(seed = 5) {
  const { state, content } = newGame(seed);
  const home = homeOf(state, ALPHA);
  for (const id of Object.keys(state.empires[ALPHA].knownSystems) as (keyof typeof state.systems)[]) {
    if (id !== home.id) delete state.empires[ALPHA].knownSystems[id];
  }
  // Push every other system out of the home's scan range so nothing is rediscovered.
  let parked = 0;
  for (const system of Object.values(state.systems)) {
    if (system.id === home.id || system.colony) continue;
    if (Math.max(Math.abs(system.sector.x - home.sector.x), Math.abs(system.sector.y - home.sector.y)) <= 1) {
      const far = { x: home.sector.x < 4 ? 7 : 0, y: parked++ };
      const clash = Object.values(state.systems).find((s) => s.id !== system.id && sectorKey(s.sector) === sectorKey(far));
      if (clash) clash.sector = { ...system.sector, x: far.x === 7 ? 6 : 1 };
      system.sector = far;
    }
  }
  const personality = content.ai.personalities[state.empires[ALPHA].faction];
  const look = () => survey(redactFor(state, ALPHA, content), ALPHA, content);
  return { state, content, home, personality, look };
}

describe('survey', () => {
  it('ranks free systems in reach by capacity, food and distance', () => {
    const { state, look } = setup();
    const [a, b] = neighbours(state);
    const small = placeFree(state, a, 6);
    const rich = placeFree(state, b, 20, 10);
    const picture = look();
    expect(picture.opportunities.map((o) => o.system.id)).toEqual([rich.id, small.id]);
    expect(picture.opportunities[0].score).toBeGreaterThan(picture.opportunities[1].score);
    expect(picture.colonies).toHaveLength(1);
    expect(picture.population).toBe(10);
  });

  it('ignores systems too small to settle or already owned', () => {
    const { state, look } = setup();
    const [a] = neighbours(state);
    placeFree(state, a, 1);
    expect(look().opportunities).toEqual([]);
  });

  it('measures threat from known rival colonies and visible rival fleets', () => {
    const { state, content, home, look } = setup();
    expect(threatDistance(look(), home.sector)).toBe(Infinity);
    state.empires[ALPHA].knownSystems[homeOf(state, BETA).id] = BETA;
    const far = threatDistance(look(), home.sector);
    expect(far).toBeGreaterThan(2);
    addFleet(state, content, BETA, neighbours(state)[0], ['frigate']);
    expect(threatDistance(look(), home.sector)).toBe(1);
  });
});

describe('strategic layer', () => {
  it('expands while there are good free systems in reach', () => {
    const { state, content, personality, look } = setup();
    const [a, b] = neighbours(state);
    placeFree(state, a, 12);
    placeFree(state, b, 12);
    const scores = scorePostures(state, ALPHA, content, look(), personality);
    expect(scores).toEqual({ expand: 90, develop: 70, fortify: 10, war: 0 });
    expect(choosePosture(scores)).toBe('expand');
  });

  it('develops when nothing is left to settle', () => {
    const { state, content, personality, look } = setup();
    const scores = scorePostures(state, ALPHA, content, look(), personality);
    expect(scores.expand).toBe(0);
    expect(choosePosture(scores)).toBe('develop');
  });

  it('fortifies when a rival is close and the navy is thin', () => {
    const { state, content, personality, look } = setup();
    addFleet(state, content, BETA, neighbours(state)[0], ['frigate']);
    const scores = scorePostures(state, ALPHA, content, look(), personality);
    expect(scores.fortify).toBe(85);
    expect(choosePosture(scores)).toBe('develop'); // 110 with nothing to settle and room to grow

    colonyOf(state, ALPHA).population = 30; // colonies mostly full: developing is less urgent
    expect(choosePosture(scorePostures(state, ALPHA, content, look(), personality))).toBe('develop');
    expect(scorePostures(state, ALPHA, content, look(), { ...personality, posture: { expand: 100, develop: 50, fortify: 100, war: 100 } }).fortify).toBe(85);
    expect(choosePosture(scorePostures(state, ALPHA, content, look(), { ...personality, posture: { expand: 100, develop: 50, fortify: 100, war: 100 } }))).toBe('fortify');
  });

  it('applies personality multipliers', () => {
    const { state, content, personality, look } = setup();
    const scores = scorePostures(state, ALPHA, content, look(), { ...personality, posture: { expand: 100, develop: 150, fortify: 200, war: 100 } });
    expect(scores.develop).toBe(165);
    expect(scores.fortify).toBe(20);
  });

  it('breaks ties toward the earlier posture', () => {
    expect(choosePosture({ expand: 50, develop: 50, fortify: 50, war: 50 })).toBe('expand');
    expect(choosePosture({ expand: 10, develop: 50, fortify: 50, war: 0 })).toBe('develop');
  });

  it('reviews the posture every ten turns and remembers it in between', () => {
    const { state, content } = setup();
    const first = standardAgent(redactFor(state, ALPHA, content), ALPHA, content, null);
    expect(first.memory).toEqual({ posture: 'develop', postureTurn: 1 });

    // Free systems appear, but the review is not due yet.
    const [a, b] = neighbours(state);
    placeFree(state, a, 12);
    placeFree(state, b, 12);
    state.turn = 6;
    expect(standardAgent(redactFor(state, ALPHA, content), ALPHA, content, first.memory).memory).toEqual(first.memory);
    state.turn = 11;
    expect(standardAgent(redactFor(state, ALPHA, content), ALPHA, content, first.memory).memory).toEqual({ posture: 'expand', postureTurn: 11 });
  });

  it('ignores memory it cannot read', () => {
    expect(readMemory(null)).toBeNull();
    expect(readMemory('expand')).toBeNull();
    expect(readMemory({ posture: 'conquer', postureTurn: 3 })).toBeNull();
    expect(readMemory({ posture: 'expand' })).toBeNull();
    expect(readMemory({ posture: 'fortify', postureTurn: 3 })).toEqual({ posture: 'fortify', postureTurn: 3 });
  });
});

describe('operational layer', () => {
  it('turns weights into whole percents that sum to 100', () => {
    const even = toPercents({ biology: 1, construction: 1, energy: 1, propulsion: 1, computing: 1, weapons: 1 });
    expect(FIELDS.reduce((sum, f) => sum + even[f], 0)).toBe(100);
    expect(Math.max(...Object.values(even)) - Math.min(...Object.values(even))).toBeLessThanOrEqual(1);
    expect(toPercents({ biology: 3, construction: 1, energy: 0, propulsion: 0, computing: 0, weapons: 0 })).toMatchObject({ biology: 75, construction: 25 });
    for (const weights of [[7, 3, 9, 1, 4, 2], [100, 0, 0, 0, 0, 1], [13, 13, 13, 13, 13, 14]]) {
      const w = Object.fromEntries(FIELDS.map((f, i) => [f, weights[i]])) as Record<FieldId, number>;
      const p = toPercents(w);
      expect(FIELDS.reduce((sum, f) => sum + p[f], 0)).toBe(100);
      for (const f of FIELDS) expect(Number.isInteger(p[f]) && p[f] >= 0).toBe(true);
    }
  });

  it('sets ship targets and research focus from the posture', () => {
    const { state, personality, look } = setup();
    const [a, b, c] = neighbours(state);
    placeFree(state, a, 12);
    placeFree(state, b, 12);
    placeFree(state, c, 12);
    const picture = look();

    const expand = setTargets('expand', picture, personality);
    expect(expand.settlers).toBe(2); // min(3 free, 2 + colonies / 2)
    expect(expand.scouts).toBe(1);
    expect(expand.warships).toBe(0); // one colony needs no navy yet
    expect(expand.research.propulsion).toBeGreaterThan(expand.research.weapons);

    const develop = setTargets('develop', picture, personality);
    expect(develop.settlers).toBe(1);
    expect(develop.research.computing).toBeGreaterThan(develop.research.propulsion);

    const fortify = setTargets('fortify', picture, personality);
    expect(fortify.research.weapons).toBe(Math.max(...Object.values(fortify.research)));

    // With more colonies the navy target scales, and more so when fortifying.
    const empire = { ...picture, colonies: Array(6).fill(picture.colonies[0]) };
    expect(setTargets('develop', empire, personality).warships).toBe(6);
    expect(setTargets('fortify', empire, personality).warships).toBe(9);
    expect(setTargets('expand', empire, personality).warships).toBe(4);
    expect(setTargets('expand', { ...empire, opportunities: [], unexplored: [] }, personality)).toMatchObject({ settlers: 0, scouts: 0 });
  });
});

describe('tactical layer: colonies', () => {
  const scoreOf = (state: GameState, content: ReturnType<typeof newGame>['content'], building: string, posture = 'expand' as const) => {
    const home = homeOf(state, ALPHA);
    return scoreBuilding(
      content.buildings[building as BuildingId],
      home,
      computeColonyEconomy(state, home, content),
      forecastColony(state, home, content),
      posture,
    );
  };

  it('values power when the colony is short of it', () => {
    const { state, content } = setup();
    const comfortable = scoreOf(state, content, 'reactor');
    colonyOf(state, ALPHA).buildings = { factory: 3, farm: 1 } as never;
    colonyOf(state, ALPHA).allocation = { food: 6, industry: 2, energy: 0, intel: 0, research: 2 };
    expect(scoreOf(state, content, 'reactor')).toBeGreaterThan(comfortable);
    expect(scoreOf(state, content, 'reactor')).toBeGreaterThan(scoreOf(state, content, 'factory'));
  });

  it('marks down a building the colony cannot power', () => {
    const { state, content } = setup();
    const powered = scoreOf(state, content, 'factory');
    colonyOf(state, ALPHA).buildings = { farm: 1 } as never; // no reactor
    colonyOf(state, ALPHA).allocation = { food: 6, industry: 4, energy: 0, intel: 0, research: 0 };
    expect(scoreOf(state, content, 'factory')).toBeLessThan(powered);
  });

  it('stops valuing food once the colony is full', () => {
    const { state, content } = setup();
    const growing = scoreOf(state, content, 'farm');
    colonyOf(state, ALPHA).population = 40;
    colonyOf(state, ALPHA).allocation = { food: 20, industry: 10, energy: 5, intel: 0, research: 5 };
    expect(scoreOf(state, content, 'farm')).toBeLessThan(growing);
  });

  it('values research more when developing', () => {
    const { state, content } = setup();
    colonyOf(state, ALPHA).allocation = { food: 5, industry: 0, energy: 0, intel: 0, research: 5 };
    expect(scoreBuilding.length).toBe(5);
    const home = homeOf(state, ALPHA);
    const args = [home, computeColonyEconomy(state, home, content), forecastColony(state, home, content)] as const;
    const lab = content.buildings['lab' as BuildingId];
    expect(scoreBuilding(lab, ...args, 'develop')).toBeGreaterThan(scoreBuilding(lab, ...args, 'expand'));
  });

  it('picks a governor to suit the colony', () => {
    const { state, content } = setup();
    const home = homeOf(state, ALPHA);
    const economy = () => computeColonyEconomy(state, home, content);
    expect(chooseGovernor(home, economy(), 'expand', false)).toBe('balanced');
    expect(chooseGovernor(home, economy(), 'expand', true)).toBe('industry');
    colonyOf(state, ALPHA).population = 3;
    colonyOf(state, ALPHA).allocation = { food: 3, industry: 0, energy: 0, intel: 0, research: 0 };
    expect(chooseGovernor(home, economy(), 'expand', true)).toBe('growth');
    colonyOf(state, ALPHA).population = 30;
    expect(chooseGovernor(home, economy(), 'develop', true)).toBe('research');
  });

  it('queues the most urgent ship first and a building otherwise', () => {
    const { state, content } = setup();
    colonyOf(state, ALPHA).buildings['shipyard' as BuildingId] = 1;
    const targets = { settlers: 1, scouts: 0, warships: 0, transports: 0, strikeSize: 3, research: state.empires[ALPHA].research.allocation };

    const withSettler = createPlanner(state, content);
    manageColonies(withSettler, ALPHA, content, 'expand', targets);
    expect(colonyOf(withSettler.state, ALPHA).buildQueue).toMatchObject([{ kind: 'ship', hull: 'colony_ship' }]);
    expect(colonyOf(withSettler.state, ALPHA).governor).toBe('industry');

    const noShips = createPlanner(state, content);
    manageColonies(noShips, ALPHA, content, 'expand', { ...targets, settlers: 0 });
    expect(colonyOf(noShips.state, ALPHA).buildQueue).toMatchObject([{ kind: 'building' }]);
    expect(colonyOf(state, ALPHA).buildQueue).toEqual([]); // the planner works on its own copy
  });

  it('leaves a busy queue alone', () => {
    const { state, content } = setup();
    colonyOf(state, ALPHA).buildQueue = [{ kind: 'building', building: 'lab' as BuildingId, progress: 3 }];
    const plan = createPlanner(state, content);
    manageColonies(plan, ALPHA, content, 'expand', { settlers: 0, scouts: 0, warships: 0, transports: 0, strikeSize: 3, research: state.empires[ALPHA].research.allocation });
    expect(plan.issued.every((c) => c.type === 'setGovernor')).toBe(true);
  });
});

describe('tactical layer: fleets', () => {
  it('sends colony ships to the best free systems, one each', () => {
    const { state, content, home, look } = setup();
    const [a, b] = neighbours(state);
    const small = placeFree(state, a, 6);
    const rich = placeFree(state, b, 20, 10);
    const first = addFleet(state, content, ALPHA, home.sector, ['colony_ship']);
    const second = addFleet(state, content, ALPHA, home.sector, ['colony_ship']);

    const plan = createPlanner(state, content);
    directFleets(plan, ALPHA, content, 'expand', look());
    expect(plan.state.fleets[first.id]).toMatchObject({ order: 'colonise', destination: rich.sector });
    expect(plan.state.fleets[second.id]).toMatchObject({ order: 'colonise', destination: small.sector });
  });

  it('sends scouts to the nearest unexplored system in range and not two to the same one', () => {
    const { state, content, home, look } = setup();
    const one = addFleet(state, content, ALPHA, home.sector, ['scout']);
    const two = addFleet(state, content, ALPHA, home.sector, ['scout']);
    const plan = createPlanner(state, content);
    directFleets(plan, ALPHA, content, 'expand', look());
    const destinations = [one, two].map((f) => plan.state.fleets[f.id].destination).filter(Boolean) as Sector[];
    expect(destinations.length).toBeGreaterThan(0);
    expect(new Set(destinations.map(sectorKey)).size).toBe(destinations.length);
    for (const d of destinations) {
      const target = Object.values(state.systems).find((s) => sectorKey(s.sector) === sectorKey(d))!;
      expect(target.id in state.empires[ALPHA].knownSystems).toBe(false);
    }
  });

  it('spreads warships so each colony has a guard', () => {
    const { state, content, home, look } = setup();
    const outpost = placeFree(state, neighbours(state)[0], 12);
    outpost.colony = { ...structuredClone(colonyOf(state, ALPHA)), population: 2, allocation: { food: 2, industry: 0, energy: 0, intel: 0, research: 0 }, buildings: {} };
    state.empires[ALPHA].knownSystems[outpost.id] = ALPHA;
    const one = addFleet(state, content, ALPHA, home.sector, ['frigate']);
    const two = addFleet(state, content, ALPHA, home.sector, ['frigate']);

    const plan = createPlanner(state, content);
    directFleets(plan, ALPHA, content, 'develop', look());
    const moved = [one, two].filter((f) => plan.state.fleets[f.id].destination);
    expect(moved).toHaveLength(1);
    expect(plan.state.fleets[moved[0].id].destination).toEqual(outpost.sector);
  });

  it('leaves fleets that already have orders alone', () => {
    const { state, content, home, look } = setup();
    const scout = addFleet(state, content, ALPHA, home.sector, ['scout']);
    scout.destination = neighbours(state)[0];
    const plan = createPlanner(state, content);
    directFleets(plan, ALPHA, content, 'expand', look());
    expect(plan.issued).toEqual([]);
  });
});
