import { describe, expect, it } from 'vitest';
import {
  borderContact,
  opinionBreakdown,
  processTurn,
  submitCommand,
  territoryAsKnown,
  warKey,
  type GameState,
  type SystemId,
} from '../src/sim';
import { survey } from '../src/ai/maps';
import { resentedRivals, scorePostures } from '../src/ai/strategic';
import { ALPHA, BETA, addFleet, homeOf, introduce, newGame } from './fixture';

/**
 * An 8x6 galaxy with borders at range 2 and every other system moved to row 5.
 * With Beta's home at (4,2) the two territories touch along columns 2 and 3 of
 * rows 1-3 (the corners are equally near both): three sectors of each side's
 * border face the other's, and three make a grievance.
 */
function setup(betaX = 4) {
  const { state, content } = newGame(1);
  content.rules.fleets.borderRange = 2;
  content.rules.fleets.baseRange = 8;
  content.rules.outposts = { borderRange: 1, scanRange: 1, minSpacing: 3, coloniesPerOutpost: 1 };
  content.rules.diplomacy.borderPressure = { everyTurns: 10, sectorsPerGrievance: 3, maxGrievances: 3 };
  const alphaHome = homeOf(state, ALPHA);
  const betaHome = homeOf(state, BETA);
  alphaHome.sector = { x: 1, y: 2 };
  betaHome.sector = { x: betaX, y: 2 };
  const others = Object.keys(state.systems)
    .sort()
    .filter((id) => id !== alphaHome.id && id !== betaHome.id) as SystemId[];
  others.forEach((id, i) => {
    state.systems[id].sector = { x: i % 8, y: 5 };
    state.systems[id].colony = null;
  });
  introduce(state, ALPHA, BETA);
  state.turn = 10;
  return { state, content };
}

const grievances = (state: GameState, of = ALPHA, about = BETA, cause = 'bordersPress') =>
  (state.opinions[of]?.[about] ?? []).filter((e) => e.cause === cause).length;

describe('border pressure', () => {
  it('counts the sectors of a territory that touch a rival’s', () => {
    const { state, content } = setup();
    expect(borderContact(territoryAsKnown(state, ALPHA, content), ALPHA)).toEqual({ [BETA]: 3 });
  });

  it('every ten turns, neighbours at peace add a grievance for every so many touching sectors', () => {
    const { state, content } = setup();
    const { state: next } = processTurn(state, content);
    expect(grievances(next, ALPHA, BETA)).toBe(1);
    expect(grievances(next, BETA, ALPHA)).toBe(1);
    expect(opinionBreakdown(next, ALPHA, BETA, content).lines).toContainEqual({ source: 'Our borders press against theirs', kind: 'flat', value: -5 });
    // Nothing more on the turns between.
    expect(grievances(processTurn(next, content).state)).toBe(1);
    // A grievance fades after ten turns, so a long border keeps a steady weight.
    next.turn = 20;
    expect(opinionBreakdown(next, ALPHA, BETA, content).lines.filter((l) => l.source === 'Our borders press against theirs')).toHaveLength(0);
  });

  it('is capped, and absent when borders are apart, open, allied or at war', () => {
    const { state, content } = setup();
    content.rules.diplomacy.borderPressure = { everyTurns: 10, sectorsPerGrievance: 1, maxGrievances: 3 };
    expect(grievances(processTurn(state, content).state)).toBe(3);

    const apart = setup(5);
    expect(grievances(processTurn(apart.state, apart.content).state)).toBe(0);

    const open = setup();
    open.state.treaties.push({ type: 'openBorders', parties: [ALPHA, BETA], startTurn: 1, since: 1, endTurn: null });
    expect(grievances(processTurn(open.state, open.content).state)).toBe(0);

    const war = setup();
    war.state.wars[warKey(ALPHA, BETA)] = 1;
    expect(grievances(processTurn(war.state, war.content).state)).toBe(0);

    const off = setup();
    off.content.rules.diplomacy.borderPressure.everyTurns = 0;
    expect(grievances(processTurn(off.state, off.content).state)).toBe(0);
  });

  it('an outpost that takes space a rival claimed is resented, and the turn report says so', () => {
    const { state, content } = setup(5);
    state.turn = 11;
    // At (3,0) the outpost is nearer (4,0) than Beta's home is, so that sector becomes Alpha's.
    const fleet = addFleet(state, content, ALPHA, { x: 3, y: 0 }, ['transport']);
    const ordered = submitCommand(state, { type: 'buildOutpost', empire: ALPHA, fleet: fleet.id }, content);
    if (!ordered.ok) throw new Error(ordered.error.message);
    const { state: next, events } = processTurn(ordered.value, content);
    expect(events).toContainEqual({ type: 'borderEncroached', empire: BETA, by: ALPHA, sectors: 1 });
    expect(grievances(next, BETA, ALPHA, 'borderEncroached')).toBe(1);
    expect(opinionBreakdown(next, BETA, ALPHA, content).lines).toContainEqual({ source: 'Their border took space we claimed', kind: 'flat', value: -10 });
    // Alpha lost nothing, so it has nothing to resent.
    expect(grievances(next, ALPHA, BETA, 'borderEncroached')).toBe(0);
  });

  it('is not resented at war, nor by an empire it has not met', () => {
    const war = setup(5);
    war.state.turn = 11;
    war.state.wars[warKey(ALPHA, BETA)] = 1;
    war.state.outposts = {};
    const fleet = addFleet(war.state, war.content, ALPHA, { x: 3, y: 0 }, ['transport']);
    const ordered = submitCommand(war.state, { type: 'buildOutpost', empire: ALPHA, fleet: fleet.id }, war.content);
    if (!ordered.ok) throw new Error(ordered.error.message);
    expect(processTurn(ordered.value, war.content).events.filter((e) => e.type === 'borderEncroached')).toEqual([]);

    const strangers = setup(5);
    strangers.state.turn = 11;
    strangers.state.empires[ALPHA].knownSystems = {};
    strangers.state.empires[BETA].knownSystems = {};
    const scout = addFleet(strangers.state, strangers.content, ALPHA, { x: 3, y: 0 }, ['transport']);
    const built = submitCommand(strangers.state, { type: 'buildOutpost', empire: ALPHA, fleet: scout.id }, strangers.content);
    if (!built.ok) throw new Error(built.error.message);
    expect(processTurn(built.value, strangers.content).events.filter((e) => e.type === 'borderEncroached')).toEqual([]);
  });

  it('a resented neighbour makes war more tempting for the AI', () => {
    const { state, content } = setup();
    const personality = content.ai.personalities[state.empires[ALPHA].faction];
    const war = () => scorePostures(state, ALPHA, content, survey(state, ALPHA, content), personality).war;
    // The fixture leaves this off.
    expect(content.ai.borders.warScore).toBe(0);
    content.ai.borders = { resentAt: -10, warScore: 20 };
    const calm = war();
    expect(resentedRivals(state, ALPHA, content, [BETA])).toEqual([]);
    state.opinions[ALPHA] = { [BETA]: [{ cause: 'bordersPress', turn: 10 }, { cause: 'bordersPress', turn: 10 }] };
    expect(resentedRivals(state, ALPHA, content, [BETA])).toEqual([BETA]);
    expect(war()).toBe(calm + 20);
  });
});
