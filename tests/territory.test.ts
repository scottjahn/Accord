import { describe, expect, it } from 'vitest';
import {
  getEmpireView,
  idleReport,
  processTurn,
  redactFor,
  sectorKey,
  submitCommand,
  suppliedSectors,
  territoryAsKnown,
  validateCommand,
  warKey,
  findPath,
  type Command,
  type GameState,
  type Sector,
  type SystemId,
} from '../src/sim';
import { buildScene } from '../src/ui/map/scene';
import { ALPHA, BETA, addFleet, homeOf, introduce, newGame } from './fixture';

/**
 * Borders at range 2 on a hand-laid 8x6 galaxy: Alpha's home at (1,2), Beta's
 * at (5,2). Alpha holds columns 0-2 of rows 0-4, Beta columns 4-7, and column 3
 * is equally near both, so it belongs to neither. Every other system is moved
 * to row 5 (outside both borders) except one free system at (4,4), inside
 * Beta's border. Supply range is wide enough that only borders matter.
 */
function setup() {
  const { state, content } = newGame(1);
  content.rules.fleets.borderRange = 2;
  content.rules.fleets.baseRange = 8;
  const alphaHome = homeOf(state, ALPHA);
  const betaHome = homeOf(state, BETA);
  alphaHome.sector = { x: 1, y: 2 };
  betaHome.sector = { x: 5, y: 2 };
  const others = Object.keys(state.systems)
    .sort()
    .filter((id) => id !== alphaHome.id && id !== betaHome.id) as SystemId[];
  const free = state.systems[others[0]];
  free.sector = { x: 4, y: 4 };
  free.colony = null;
  free.minor = null;
  others.slice(1).forEach((id, i) => {
    state.systems[id].sector = { x: i % 8, y: 5 };
    state.systems[id].colony = null;
  });
  introduce(state, ALPHA, BETA);
  state.empires[ALPHA].knownSystems[free.id] = null;
  return { state, content, free };
}

const at = (s: Sector) => sectorKey(s);

function move(state: GameState, fleet: string, to: Sector): Command {
  return { type: 'moveFleet', empire: ALPHA, fleet: fleet as never, to };
}

function openBorders(state: GameState): void {
  state.treaties.push({ type: 'openBorders', parties: [ALPHA, BETA], startTurn: state.turn, since: state.turn, endTurn: null });
}

describe('borders', () => {
  it('each sector goes to the nearest colony, and a tie between empires leaves it unclaimed', () => {
    const { state, content } = setup();
    const territory = territoryAsKnown(state, ALPHA, content);
    expect(territory[at({ x: 2, y: 2 })]).toBe(ALPHA);
    expect(territory[at({ x: 1, y: 0 })]).toBe(ALPHA);
    expect(territory[at({ x: 3, y: 2 })]).toBeUndefined();
    expect(territory[at({ x: 4, y: 4 })]).toBe(BETA);
    expect(territory[at({ x: 7, y: 2 })]).toBe(BETA);
    expect(territory[at({ x: 1, y: 5 })]).toBeUndefined();
    // The view hands the same map to the UI.
    expect(getEmpireView(state, ALPHA, content).territory).toEqual(territory);
  });

  it('a range of 0 turns borders off', () => {
    const { state, content } = setup();
    content.rules.fleets.borderRange = 0;
    expect(territoryAsKnown(state, ALPHA, content)).toEqual({});
  });

  it('is judged on what the empire knows, and the redacted state agrees', () => {
    const { state, content } = setup();
    delete state.empires[ALPHA].knownSystems[homeOf(state, BETA).id];
    // Alpha has not found Beta's home, so Beta has no border Alpha can see.
    expect(Object.values(territoryAsKnown(state, ALPHA, content))).not.toContain(BETA);
    // Beta always knows its own colonies.
    expect(territoryAsKnown(state, BETA, content)[at({ x: 5, y: 2 })]).toBe(BETA);
    const known = setup();
    expect(territoryAsKnown(redactFor(known.state, ALPHA, known.content), ALPHA, known.content)).toEqual(
      territoryAsKnown(known.state, ALPHA, known.content),
    );
  });

  it('a fleet at peace may not enter a rival border, and routes around it', () => {
    const { state, content } = setup();
    const fleet = addFleet(state, content, ALPHA, { x: 1, y: 2 }, ['frigate']);
    const refused = validateCommand(state, move(state, fleet.id, { x: 4, y: 2 }), content);
    expect(refused?.code).toBe('closedBorder');
    expect(refused?.message).toBe("That sector lies inside Beta's border: it takes open borders, an alliance or war to enter");
    // The unclaimed column between the two is open.
    expect(validateCommand(state, move(state, fleet.id, { x: 3, y: 2 }), content)).toBeNull();
    // Row 5 is outside both borders; the route keeps out of Beta's.
    const path = findPath(state, fleet, { x: 6, y: 5 }, content)!;
    expect(path).not.toBeNull();
    const beta = territoryAsKnown(state, ALPHA, content);
    expect(path.filter((s) => beta[at(s)] === BETA)).toEqual([]);
  });

  it("open borders supply a fleet only from the partner colonies it knows of, so fog cannot change a route", () => {
    const { state, content } = setup();
    content.rules.fleets.baseRange = 1;
    openBorders(state);
    const betaHome = homeOf(state, BETA);
    expect(suppliedSectors(state, ALPHA, 1).has(at({ x: 6, y: 2 }))).toBe(true);
    // Alpha has never seen Beta's home: no supply from it, in the real state or the redacted one.
    delete state.empires[ALPHA].knownSystems[betaHome.id];
    expect(suppliedSectors(state, ALPHA, 1).has(at({ x: 6, y: 2 }))).toBe(false);
    const known = redactFor(state, ALPHA, content);
    expect([...suppliedSectors(known, ALPHA, 1)].sort()).toEqual([...suppliedSectors(state, ALPHA, 1)].sort());
  });

  it('war, open borders and an alliance open a border', () => {
    for (const open of ['war', 'openBorders', 'alliance'] as const) {
      const { state, content } = setup();
      if (open === 'war') state.wars[warKey(ALPHA, BETA)] = state.turn;
      else if (open === 'openBorders') openBorders(state);
      else state.treaties.push({ type: 'alliance', parties: [ALPHA, BETA], startTurn: 0, since: 0, endTurn: null });
      const fleet = addFleet(state, content, ALPHA, { x: 1, y: 2 }, ['frigate']);
      expect(validateCommand(state, move(state, fleet.id, { x: 4, y: 2 }), content)).toBeNull();
    }
  });

  it('scouts cross borders, so the galaxy can still be explored', () => {
    const { state, content } = setup();
    const scout = addFleet(state, content, ALPHA, { x: 1, y: 2 }, ['scout']);
    expect(validateCommand(state, move(state, scout.id, { x: 4, y: 2 }), content)).toBeNull();
    // A scout escorted by a warship is held to the border like any other fleet.
    const mixed = addFleet(state, content, ALPHA, { x: 1, y: 2 }, ['scout', 'frigate']);
    expect(validateCommand(state, move(state, mixed.id, { x: 4, y: 2 }), content)?.code).toBe('closedBorder');
  });

  it('a fleet caught inside a border may cross it to leave, but not go deeper', () => {
    const { state, content } = setup();
    const fleet = addFleet(state, content, ALPHA, { x: 6, y: 3 }, ['frigate']);
    expect(validateCommand(state, move(state, fleet.id, { x: 1, y: 2 }), content)).toBeNull();
    expect(validateCommand(state, move(state, fleet.id, { x: 6, y: 2 }), content)?.code).toBe('closedBorder');
  });

  it('a fleet en route is stopped when the border closes', () => {
    const { state, content } = setup();
    openBorders(state);
    const fleet = addFleet(state, content, ALPHA, { x: 1, y: 2 }, ['frigate']);
    const result = submitCommand(state, move(state, fleet.id, { x: 6, y: 2 }), content);
    if (!result.ok) throw new Error(result.error.message);
    const ordered = result.value;
    ordered.treaties = [];
    const { state: next, events } = processTurn(ordered, content);
    expect(events).toContainEqual({ type: 'fleetBlocked', empire: ALPHA, fleet: fleet.id });
    expect(next.fleets[fleet.id].sector).toEqual({ x: 1, y: 2 });
  });

  it('no empire may settle inside another empire’s border', () => {
    const { state, content, free } = setup();
    const settler = addFleet(state, content, ALPHA, free.sector, ['colony_ship']);
    const order: Command = { type: 'coloniseSystem', empire: ALPHA, fleet: settler.id, system: free.id };
    const refused = validateCommand(state, order, content);
    expect(refused).toEqual({ code: 'cannotColonise', message: `${free.name} lies inside Beta's border` });
    // Open borders let the ship in, not settle.
    openBorders(state);
    expect(validateCommand(state, order, content)?.code).toBe('cannotColonise');
    // An order given before the border was known still fails when the turn resolves.
    state.fleets[settler.id].order = 'colonise';
    const { state: next, events } = processTurn(state, content);
    expect(next.systems[free.id].colony).toBeNull();
    expect(events).toContainEqual({ type: 'coloniseFailed', empire: ALPHA, system: free.id });
  });

  it('the turn report does not count a system inside a rival border as somewhere to settle', () => {
    const { state, content } = setup();
    const unsettled = () => idleReport(state, ALPHA, content).find((i) => i.kind === 'unsettled');
    const withBorders = unsettled();
    content.rules.fleets.borderRange = 0;
    const without = unsettled();
    expect(without && 'count' in without ? without.count : 0).toBe((withBorders && 'count' in withBorders ? withBorders.count : 0) + 1);
  });

  it('the map draws each border with a line where it meets anyone else', () => {
    const { state, content } = setup();
    const scene = buildScene(state, content, getEmpireView(state, ALPHA, content));
    const cell = (x: number, y: number) => scene.territory.find((t) => t.sector.x === x && t.sector.y === y);
    expect(cell(3, 2)).toBeUndefined();
    expect(cell(2, 2)?.own).toBe(true);
    expect(cell(2, 2)?.edges).toEqual({ top: false, right: true, bottom: false, left: false });
    expect(cell(4, 2)?.own).toBe(false);
    expect(cell(4, 2)?.edges.left).toBe(true);
    // A selected warship's reachable area leaves out the closed border.
    const fleet = addFleet(state, content, ALPHA, { x: 1, y: 2 }, ['frigate']);
    const withFleet = buildScene(state, content, getEmpireView(state, ALPHA, content), fleet);
    expect(withFleet.range?.has(at({ x: 4, y: 2 }))).toBe(false);
    expect(withFleet.range?.has(at({ x: 3, y: 2 }))).toBe(true);
  });
});
