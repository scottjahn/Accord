import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  getEmpireView,
  processTurn,
  sectorKey,
  submitCommand,
  suppliedSectors,
  territoryAsKnown,
  validateCommand,
  visibleSectors,
  warKey,
  type Command,
  type GameState,
  type OutpostId,
  type Sector,
  type SystemId,
} from '../src/sim';
import { createPlanner } from '../src/ai/agent';
import { survey } from '../src/ai/maps';
import { plantOutposts } from '../src/ai/tactical/outposts';
import { buildScene } from '../src/ui/map/scene';
import { ALPHA, BETA, addFleet, homeOf, introduce, newGame } from './fixture';

/**
 * The borders layout from territory.test.ts: an 8x6 galaxy with Alpha's home at
 * (1,2) and Beta's at (5,2), borders at range 2 (Alpha holds columns 0-2 of
 * rows 0-4, Beta columns 4-7, column 3 is no one's), every other star on row 5
 * or at (7,0) and (0,0). Outposts claim range 1, see range 1, stand 3 apart, and each
 * colony allows one.
 */
function setup() {
  const { state, content } = newGame(1);
  content.rules.fleets.borderRange = 2;
  content.rules.fleets.baseRange = 8;
  content.rules.outposts = { borderRange: 1, scanRange: 1, minSpacing: 3, coloniesPerOutpost: 1 };
  const alphaHome = homeOf(state, ALPHA);
  const betaHome = homeOf(state, BETA);
  alphaHome.sector = { x: 1, y: 2 };
  betaHome.sector = { x: 5, y: 2 };
  const others = Object.keys(state.systems)
    .sort()
    .filter((id) => id !== alphaHome.id && id !== betaHome.id) as SystemId[];
  others.forEach((id, i) => {
    state.systems[id].sector = i < 8 ? { x: i, y: 5 } : i === 8 ? { x: 7, y: 0 } : { x: 0, y: 0 };
    state.systems[id].colony = null;
  });
  introduce(state, ALPHA, BETA);
  return { state, content };
}

const at = (s: Sector) => sectorKey(s);
const build = (fleet: string): Command => ({ type: 'buildOutpost', empire: ALPHA, fleet: fleet as never });

function apply(state: GameState, command: Command, content: ReturnType<typeof setup>['content']): GameState {
  const result = submitCommand(state, command, content);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('outposts', () => {
  it('a transport builds one in empty space when the turn resolves, and is used up', () => {
    const { state, content } = setup();
    const fleet = addFleet(state, content, ALPHA, { x: 3, y: 0 }, ['transport', 'transport']);
    const ordered = apply(state, build(fleet.id), content);
    expect(ordered.fleets[fleet.id].order).toBe('outpost');
    expect(ordered.outposts).toEqual({});
    const { state: next, events } = processTurn(ordered, content);
    const outposts = Object.values(next.outposts);
    expect(outposts).toEqual([{ id: outposts[0].id, owner: ALPHA, sector: { x: 3, y: 0 }, built: 1 }]);
    expect(events).toContainEqual({ type: 'outpostBuilt', empire: ALPHA, outpost: outposts[0].id, sector: { x: 3, y: 0 } });
    expect(next.fleets[fleet.id].ships).toHaveLength(1);
    expect(next.fleets[fleet.id].order).toBe('none');
    expect(checkInvariants(next, content)).toEqual([]);
  });

  it('says why it cannot be built', () => {
    const { state, content } = setup();
    const why = (sector: Sector, hulls = ['transport']) => validateCommand(state, build(addFleet(state, content, ALPHA, sector, hulls).id), content)?.message;
    expect(why({ x: 3, y: 0 }, ['frigate'])).toBe('Only a troop transport can build an outpost');
    expect(why({ x: 1, y: 2 })).toBe('Outposts are built in empty space, not at a star system');
    expect(why({ x: 5, y: 4 })).toBe("This sector lies inside Beta's border");
    state.outposts['out-99999' as OutpostId] = { id: 'out-99999' as OutpostId, owner: BETA, sector: { x: 3, y: 4 }, built: 1 };
    expect(why({ x: 3, y: 2 })).toBe('Too close to another outpost (they must be 3 sectors apart)');
    // One colony allows one outpost; one already ordered counts.
    const first = addFleet(state, content, ALPHA, { x: 3, y: 0 }, ['transport']);
    const ordered = apply(state, build(first.id), content);
    const second = addFleet(ordered, content, ALPHA, { x: 2, y: 0 }, ['transport']);
    expect(validateCommand(ordered, build(second.id), content)?.message).toBe('Too close to another outpost being built');
    const third = addFleet(ordered, content, ALPHA, { x: 0, y: 4 }, ['transport']);
    expect(validateCommand(ordered, build(third.id), content)?.message).toBe('The empire can keep 1 outpost: one for every 1 colonies');
    content.rules.outposts.coloniesPerOutpost = 0;
    expect(validateCommand(state, build(first.id), content)?.message).toBe('Outposts are not in use');
  });

  it('claims territory, extends supply and gives sight', () => {
    const { state, content } = setup();
    content.rules.fleets.baseRange = 1;
    expect(territoryAsKnown(state, ALPHA, content)[at({ x: 4, y: 0 })]).toBe(BETA);
    expect(suppliedSectors(state, ALPHA, 1).has(at({ x: 4, y: 0 }))).toBe(false);
    state.outposts['out-00090' as OutpostId] = { id: 'out-00090' as OutpostId, owner: ALPHA, sector: { x: 3, y: 0 }, built: 1 };
    const territory = territoryAsKnown(state, ALPHA, content);
    // Nearer the outpost (1) than Beta's home (2), so Alpha's; Beta agrees, since outposts are public.
    expect(territory[at({ x: 4, y: 0 })]).toBe(ALPHA);
    expect(territory[at({ x: 3, y: 1 })]).toBe(ALPHA);
    expect(territoryAsKnown(state, BETA, content)[at({ x: 4, y: 0 })]).toBe(ALPHA);
    expect(suppliedSectors(state, ALPHA, 1).has(at({ x: 4, y: 0 }))).toBe(true);
    expect(visibleSectors(state, ALPHA, content).has(at({ x: 4, y: 1 }))).toBe(true);
    // The map draws it in Alpha's colour.
    const scene = buildScene(state, content, getEmpireView(state, ALPHA, content));
    expect(scene.outposts.map((o) => o.sector)).toEqual([{ x: 3, y: 0 }]);
  });

  it('of two ordered too close together, the first stands', () => {
    const { state, content } = setup();
    content.rules.outposts.coloniesPerOutpost = 1;
    homeOf(state, BETA).colony!.owner = BETA;
    const a = addFleet(state, content, ALPHA, { x: 3, y: 0 }, ['transport']);
    const b = addFleet(state, content, BETA, { x: 3, y: 2 }, ['transport']);
    let ordered = apply(state, build(a.id), content);
    // Beta judges spacing only against outposts that stand, so its order is legal too.
    ordered = apply(ordered, { type: 'buildOutpost', empire: BETA, fleet: b.id }, content);
    const { state: next, events } = processTurn(ordered, content);
    expect(Object.values(next.outposts).map((o) => o.owner)).toEqual([ALPHA]);
    expect(events).toContainEqual({ type: 'outpostFailed', empire: BETA, sector: { x: 3, y: 2 }, reason: 'Too close to another outpost (they must be 3 sectors apart)' });
  });

  it('falls to armed enemies at war when nothing armed of its owner is there', () => {
    const { state, content } = setup();
    const id = 'out-00090' as OutpostId;
    state.outposts[id] = { id, owner: ALPHA, sector: { x: 3, y: 0 }, built: 1 };
    addFleet(state, content, BETA, { x: 3, y: 0 }, ['frigate']);
    // At peace nothing happens.
    expect(processTurn(state, content).state.outposts[id]).toBeDefined();
    state.wars[warKey(ALPHA, BETA)] = 1;
    // An unarmed fleet of the owner does not hold it.
    const transport = addFleet(state, content, ALPHA, { x: 3, y: 0 }, ['transport']);
    const { state: lost, events } = processTurn(state, content);
    expect(lost.outposts[id]).toBeUndefined();
    expect(events).toContainEqual({ type: 'outpostLost', empire: ALPHA, by: BETA, sector: { x: 3, y: 0 } });
    // A frigate of the owner's that survives the battle does.
    delete state.fleets[transport.id];
    addFleet(state, content, ALPHA, { x: 3, y: 0 }, ['destroyer']);
    expect(processTurn(state, content).state.outposts[id]).toBeDefined();
  });

  it('disappear with an eliminated empire', () => {
    const { state, content } = setup();
    const id = 'out-00090' as OutpostId;
    state.outposts[id] = { id, owner: ALPHA, sector: { x: 3, y: 0 }, built: 1 };
    homeOf(state, ALPHA).colony = null;
    const { state: next } = processTurn(state, content);
    expect(next.empires[ALPHA].eliminated).toBe(true);
    expect(next.outposts).toEqual({});
  });

  it('the AI sends an idle transport to a site and builds there on arrival', () => {
    const { state, content } = setup();
    // Narrower borders leave row 4 open, which is where a site is worth having.
    content.rules.fleets.borderRange = 1;
    const fleet = addFleet(state, content, ALPHA, { x: 1, y: 2 }, ['transport']);
    const picture = survey(state, ALPHA, content);
    expect(picture.outpostSlots).toBe(1);
    expect(picture.outpostSites.length).toBeGreaterThan(0);
    const plan = createPlanner(state, content);
    plantOutposts(plan, ALPHA, content, picture);
    expect(plan.issued).toHaveLength(1);
    const move = plan.issued[0];
    if (move.type !== 'moveFleet') throw new Error(`expected a move, got ${move.type}`);
    // Once there, it builds.
    state.fleets[fleet.id].sector = move.to;
    const arrived = createPlanner(state, content);
    plantOutposts(arrived, ALPHA, content, survey(state, ALPHA, content));
    expect(arrived.issued).toEqual([build(fleet.id)]);
  });
});
