import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  empireRange,
  empireSupport,
  findPath,
  fleetPlan,
  fleetRange,
  fleetSpeed,
  fleetsOf,
  processTurn,
  sectorDistance,
  sectorKey,
  submitCommand,
  suppliedSectors,
  type BuildingId,
  type Command,
  type GameState,
  type HullId,
  type Sector,
  type ShipId,
} from '../src/sim';
import { ALPHA, BETA, addFleet, colonyOf, homeOf, newGame } from './fixture';

const H = (id: string) => id as HullId;

/** Alpha's home with a shipyard, and a sector two steps away that is inside supply range. */
function setup() {
  const { state, content } = newGame(5);
  colonyOf(state, ALPHA).buildings['shipyard' as BuildingId] = 1;
  const home = homeOf(state, ALPHA);
  const apply = (s: GameState, cmd: Command): GameState => {
    const r = submitCommand(s, cmd, content);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.value;
  };
  const codeOf = (s: GameState, cmd: Command) => {
    const r = submitCommand(s, cmd, content);
    return r.ok ? 'ok' : r.error.code;
  };
  const supplied = suppliedSectors(state, ALPHA, 2);
  const inRange = (dx: number, dy: number): Sector | null => {
    const s = { x: home.sector.x + dx, y: home.sector.y + dy };
    return supplied.has(sectorKey(s)) ? s : null;
  };
  // A sector exactly two steps from home in whichever direction stays on the map.
  const twoAway = (inRange(2, 0) ?? inRange(-2, 0))!;
  return { state, content, home, apply, codeOf, twoAway };
}

describe('supply range', () => {
  it('covers sectors within range of an owned colony, clipped to the map', () => {
    const { state, home } = setup();
    const supplied = suppliedSectors(state, ALPHA, 2);
    for (const key of supplied) {
      const [x, y] = key.split(',').map(Number);
      expect(sectorDistance({ x, y }, home.sector)).toBeLessThanOrEqual(2);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(8);
      expect(y).toBeLessThan(6);
    }
    expect(supplied.has(sectorKey(home.sector))).toBe(true);
    expect(supplied.has(sectorKey(homeOf(state, BETA).sector))).toBe(false);
  });

  it('grows with Propulsion and with hull range bonuses, limited by the shortest-ranged ship', () => {
    const { state, content, home } = setup();
    expect(empireRange(state, ALPHA, content)).toBe(2);
    const scouts = addFleet(state, content, ALPHA, home.sector, ['scout']);
    const mixed = addFleet(state, content, ALPHA, home.sector, ['scout', 'frigate']);
    expect(fleetRange(state, scouts, content)).toBe(3);
    expect(fleetRange(state, mixed, content)).toBe(2);
    state.empires[ALPHA].research.levels.propulsion = 4;
    expect(empireRange(state, ALPHA, content)).toBe(4);
    expect(fleetRange(state, scouts, content)).toBe(5);
  });
});

describe('fleet movement', () => {
  it('moves at the speed of the slowest ship', () => {
    const { state, content, home } = setup();
    expect(fleetSpeed(addFleet(state, content, ALPHA, home.sector, ['scout']), content)).toBe(3);
    expect(fleetSpeed(addFleet(state, content, ALPHA, home.sector, ['scout', 'frigate']), content)).toBe(2);
    expect(fleetSpeed(addFleet(state, content, ALPHA, home.sector, ['scout', 'colony_ship']), content)).toBe(1);
  });

  it('finds a shortest path of adjacent in-range sectors', () => {
    const { state, content, home, twoAway } = setup();
    const fleet = addFleet(state, content, ALPHA, home.sector, ['frigate']);
    const path = findPath(state, fleet, twoAway, content)!;
    expect(path).toHaveLength(2);
    expect(path[1]).toEqual(twoAway);
    expect(sectorDistance(home.sector, path[0])).toBe(1);
    expect(sectorDistance(path[0], path[1])).toBe(1);
    expect(findPath(state, fleet, home.sector, content)).toEqual([]);
    expect(fleetPlan(state, fleet, twoAway, content)).toMatchObject({ turns: 1 });
  });

  it('refuses destinations off the map or outside supply range', () => {
    const { state, content, home, codeOf } = setup();
    const fleet = addFleet(state, content, ALPHA, home.sector, ['frigate']);
    const enemyHome = homeOf(state, BETA).sector;
    expect(findPath(state, fleet, enemyHome, content)).toBeNull();
    expect(codeOf(state, { type: 'moveFleet', empire: ALPHA, fleet: fleet.id, to: enemyHome })).toBe('outOfRange');
    expect(codeOf(state, { type: 'moveFleet', empire: ALPHA, fleet: fleet.id, to: { x: -1, y: 0 } })).toBe('outOfRange');
    expect(codeOf(state, { type: 'moveFleet', empire: ALPHA, fleet: fleet.id, to: { x: 0.5, y: 0 } })).toBe('outOfRange');
  });

  it('only lets the owner give orders', () => {
    const { state, content, home, codeOf, twoAway } = setup();
    const fleet = addFleet(state, content, ALPHA, home.sector, ['frigate']);
    expect(codeOf(state, { type: 'moveFleet', empire: BETA, fleet: fleet.id, to: twoAway })).toBe('notOwner');
    expect(codeOf(state, { type: 'stopFleet', empire: ALPHA, fleet: 'flt-99999' as never })).toBe('unknownFleet');
  });

  it('travels over several turns, arrives and reports it', () => {
    const { state, content, home, apply, twoAway } = setup();
    const fleet = addFleet(state, content, ALPHA, home.sector, ['colony_ship']); // speed 1
    let s = apply(state, { type: 'moveFleet', empire: ALPHA, fleet: fleet.id, to: twoAway });
    expect(s.fleets[fleet.id].destination).toEqual(twoAway);
    expect(s.fleets[fleet.id].sector).toEqual(home.sector);

    let step = processTurn(s, content);
    s = step.state;
    expect(sectorDistance(s.fleets[fleet.id].sector, home.sector)).toBe(1);
    expect(s.fleets[fleet.id].destination).toEqual(twoAway);
    expect(step.events.some((e) => e.type === 'fleetArrived')).toBe(false);

    step = processTurn(s, content);
    s = step.state;
    expect(s.fleets[fleet.id].sector).toEqual(twoAway);
    expect(s.fleets[fleet.id].destination).toBeNull();
    expect(step.events).toContainEqual({ type: 'fleetArrived', empire: ALPHA, fleet: fleet.id, sector: twoAway });
    expect(checkInvariants(s, content)).toEqual([]);
  });

  it('stops on command and treats a move to the current sector as a stop', () => {
    const { state, content, home, apply, twoAway } = setup();
    const fleet = addFleet(state, content, ALPHA, home.sector, ['frigate']);
    const moving = apply(state, { type: 'moveFleet', empire: ALPHA, fleet: fleet.id, to: twoAway });
    expect(apply(moving, { type: 'stopFleet', empire: ALPHA, fleet: fleet.id }).fleets[fleet.id].destination).toBeNull();
    expect(apply(moving, { type: 'moveFleet', empire: ALPHA, fleet: fleet.id, to: home.sector }).fleets[fleet.id].destination).toBeNull();
  });

  it('halts a fleet whose destination falls out of range', () => {
    const { state, content, home, twoAway } = setup();
    const fleet = addFleet(state, content, ALPHA, home.sector, ['scout']);
    fleet.destination = { ...homeOf(state, BETA).sector };
    const { state: next, events } = processTurn(state, content);
    expect(next.fleets[fleet.id].destination).toBeNull();
    expect(next.fleets[fleet.id].sector).toEqual(home.sector);
    expect(events).toContainEqual({ type: 'fleetBlocked', empire: ALPHA, fleet: fleet.id });
    expect(twoAway).toBeDefined();
  });
});

describe('merging and splitting', () => {
  it('merges two fleets in the same sector', () => {
    const { state, content, home, apply, codeOf, twoAway } = setup();
    const a = addFleet(state, content, ALPHA, home.sector, ['frigate']);
    const b = addFleet(state, content, ALPHA, home.sector, ['scout', 'frigate']);
    const far = addFleet(state, content, ALPHA, twoAway, ['scout']);
    const merged = apply(state, { type: 'mergeFleets', empire: ALPHA, from: b.id, into: a.id });
    expect(merged.fleets[a.id].ships).toHaveLength(3);
    expect(merged.fleets[b.id]).toBeUndefined();
    expect(codeOf(state, { type: 'mergeFleets', empire: ALPHA, from: far.id, into: a.id })).toBe('badFleets');
    expect(codeOf(state, { type: 'mergeFleets', empire: ALPHA, from: a.id, into: a.id })).toBe('badFleets');
  });

  it('splits chosen ships into a new idle fleet', () => {
    const { state, content, home, apply, codeOf } = setup();
    const fleet = addFleet(state, content, ALPHA, home.sector, ['scout', 'frigate', 'frigate']);
    const scout = fleet.ships[0].id;
    const split = apply(state, { type: 'splitFleet', empire: ALPHA, fleet: fleet.id, ships: [scout] });
    const mine = fleetsOf(split, ALPHA);
    expect(mine).toHaveLength(2);
    expect(split.fleets[fleet.id].ships.map((s) => s.hull)).toEqual(['frigate', 'frigate']);
    const created = mine.find((f) => f.id !== fleet.id)!;
    expect(created.ships.map((s) => s.id)).toEqual([scout]);
    expect(created).toMatchObject({ sector: home.sector, destination: null, order: 'none' });
    expect(checkInvariants(split, content)).toEqual([]);

    const all = fleet.ships.map((s) => s.id);
    expect(codeOf(state, { type: 'splitFleet', empire: ALPHA, fleet: fleet.id, ships: all })).toBe('badFleets');
    expect(codeOf(state, { type: 'splitFleet', empire: ALPHA, fleet: fleet.id, ships: [] })).toBe('badFleets');
    expect(codeOf(state, { type: 'splitFleet', empire: ALPHA, fleet: fleet.id, ships: ['shp-99999' as ShipId] })).toBe('badFleets');
  });
});

describe('building ships', () => {
  it('needs a shipyard', () => {
    const { state, content, home, codeOf } = setup();
    delete colonyOf(state, ALPHA).buildings['shipyard' as BuildingId];
    expect(codeOf(state, { type: 'enqueueShip', empire: ALPHA, system: home.id, hull: H('scout') })).toBe('noShipyard');
    expect(content.rules.fleets.shipyardBuilding).toBe('shipyard');
  });

  it('launches a finished ship as a fleet at the system', () => {
    const { state, content, home, apply } = setup();
    let s = apply(state, { type: 'enqueueShip', empire: ALPHA, system: home.id, hull: H('scout') });
    colonyOf(s, ALPHA).buildQueue[0].progress = 19; // costs 20
    const step = processTurn(s, content);
    s = step.state;
    const fleets = fleetsOf(s, ALPHA);
    expect(fleets).toHaveLength(1);
    expect(fleets[0]).toMatchObject({ sector: home.sector, destination: null, order: 'none' });
    expect(fleets[0].ships).toEqual([{ id: expect.stringMatching(/^shp-/), hull: 'scout', hp: 10 }]);
    expect(step.events).toContainEqual({ type: 'shipBuilt', system: home.id, hull: 'scout', fleet: fleets[0].id });
    expect(colonyOf(s, ALPHA).buildQueue).toEqual([]);
  });

  it('adds new ships to an idle fleet of the same role, not to other roles or busy fleets', () => {
    const { state, content, home, apply, twoAway } = setup();
    const scouts = addFleet(state, content, ALPHA, home.sector, ['scout']);
    const frigates = addFleet(state, content, ALPHA, home.sector, ['frigate']);
    let s = apply(state, { type: 'enqueueShip', empire: ALPHA, system: home.id, hull: H('frigate') });
    colonyOf(s, ALPHA).buildQueue[0].progress = 29;
    s = processTurn(s, content).state;
    expect(s.fleets[frigates.id].ships).toHaveLength(2);
    expect(s.fleets[scouts.id].ships).toHaveLength(1);

    // A fleet with orders is leaving, so the next ship forms its own fleet.
    s = apply(s, { type: 'enqueueShip', empire: ALPHA, system: home.id, hull: H('scout') });
    s = apply(s, { type: 'moveFleet', empire: ALPHA, fleet: scouts.id, to: twoAway });
    colonyOf(s, ALPHA).buildQueue[0].progress = 19;
    s = processTurn(s, content).state;
    expect(fleetsOf(s, ALPHA)).toHaveLength(3);
  });

  it('counts built and queued ships against the support cap', () => {
    const { state, content, home, apply, codeOf } = setup();
    // cap = 4 + 10 pop / 5 = 6
    expect(empireSupport(state, ALPHA, content)).toEqual({ used: 0, cap: 6 });
    addFleet(state, content, ALPHA, home.sector, ['frigate']); // 2
    let s = apply(state, { type: 'enqueueShip', empire: ALPHA, system: home.id, hull: H('frigate') }); // 4
    s = apply(s, { type: 'enqueueShip', empire: ALPHA, system: home.id, hull: H('scout') }); // 5
    expect(empireSupport(s, ALPHA, content)).toEqual({ used: 5, cap: 6 });
    expect(codeOf(s, { type: 'enqueueShip', empire: ALPHA, system: home.id, hull: H('frigate') })).toBe('supportCap');
    expect(codeOf(s, { type: 'enqueueShip', empire: ALPHA, system: home.id, hull: H('scout') })).toBe('ok');
    expect(empireSupport(s, BETA, content).used).toBe(0);
  });

  it('rejects unknown hulls', () => {
    const { state, home, codeOf } = setup();
    expect(codeOf(state, { type: 'enqueueShip', empire: ALPHA, system: home.id, hull: H('dreadnought') })).toBe('unknownHull');
  });
});

describe('refits', () => {
  function withFrigate() {
    const ctx = setup();
    ctx.state.empires[ALPHA].research.levels.weapons = 1;
    const fleet = addFleet(ctx.state, ctx.content, ALPHA, ctx.home.sector, ['frigate', 'scout']);
    const refit = (ship: ShipId, hull = 'destroyer'): Command => ({
      type: 'enqueueRefit',
      empire: ALPHA,
      system: ctx.home.id,
      ship,
      hull: H(hull),
    });
    return { ...ctx, fleet, frigate: fleet.ships[0].id, scout: fleet.ships[1].id, refit };
  }

  it('upgrades a docked ship for half the new hull cost, keeping its id', () => {
    const { state, content, home, apply, fleet, frigate, refit } = withFrigate();
    let s = apply(state, refit(frigate));
    expect(colonyOf(s, ALPHA).buildQueue).toEqual([{ kind: 'refit', ship: frigate, hull: 'destroyer', progress: 0 }]);
    colonyOf(s, ALPHA).buildQueue[0].progress = 29; // destroyer costs 60, refit 30
    const step = processTurn(s, content);
    s = step.state;
    expect(s.fleets[fleet.id].ships[0]).toEqual({ id: frigate, hull: 'destroyer', hp: 50 });
    expect(step.events).toContainEqual({ type: 'refitCompleted', system: home.id, hull: 'destroyer' });
  });

  it('only allows a newer hull of the same role, once, for a ship that is here', () => {
    const { state, content, apply, codeOf, twoAway, frigate, scout, refit } = withFrigate();
    expect(codeOf(state, refit(scout))).toBe('badRefit'); // scout -> warship
    expect(codeOf(state, refit(frigate, 'frigate'))).toBe('badRefit'); // same tier
    expect(codeOf(state, refit('shp-99999' as ShipId))).toBe('unknownShip');
    expect(codeOf(apply(state, refit(frigate)), refit(frigate))).toBe('badRefit');

    const away = addFleet(state, content, ALPHA, twoAway, ['frigate']);
    expect(codeOf(state, refit(away.ships[0].id))).toBe('unknownShip');

    state.empires[ALPHA].research.levels.weapons = 0;
    expect(codeOf(state, refit(frigate))).toBe('locked');
  });

  it('wastes the work if the ship leaves before the refit finishes', () => {
    const { state, content, apply, fleet, frigate, refit, twoAway } = withFrigate();
    let s = apply(state, refit(frigate));
    s = apply(s, { type: 'moveFleet', empire: ALPHA, fleet: fleet.id, to: twoAway });
    s = processTurn(s, content).state; // fleet leaves
    colonyOf(s, ALPHA).buildQueue[0].progress = 29;
    const step = processTurn(s, content);
    expect(step.state.fleets[fleet.id].ships[0].hull).toBe('frigate');
    expect(colonyOf(step.state, ALPHA).buildQueue).toEqual([]);
    expect(step.events.some((e) => e.type === 'refitCompleted')).toBe(false);
  });
});
