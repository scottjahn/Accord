import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  deserialize,
  hasTreaty,
  processTurn,
  redactFor,
  serialize,
  submitCommand,
  termsBlocker,
  validateCommand,
  warKey,
  type Command,
  type GameState,
  type MinorId,
  type PeaceTerms,
  type SystemId,
} from '../src/sim';
import { ALPHA, BETA, homeOf, introduce, newGame } from './fixture';

/**
 * Alpha and Beta at war. Alpha holds a second colony, Tarsis, with a member
 * race living there, and has 500 credits.
 */
function setup() {
  const { state, content } = newGame(1);
  introduce(state, ALPHA, BETA);
  state.wars[warKey(ALPHA, BETA)] = 1;
  const home = homeOf(state, ALPHA);
  const id = (Object.keys(state.systems) as SystemId[]).sort().find((s) => !state.systems[s].colony && s !== homeOf(state, BETA).id)!;
  const tarsis = state.systems[id];
  tarsis.name = 'Tarsis';
  tarsis.minor = null;
  tarsis.colony = { ...structuredClone(home.colony!), population: 6, minorRace: 'sages' as MinorId, buildQueue: [] };
  state.empires[ALPHA].members = ['sages' as MinorId];
  state.empires[ALPHA].knownSystems[id] = ALPHA;
  state.empires[ALPHA].credits = 500;
  state.empires[BETA].credits = 100;
  return { state, content, tarsis: id };
}

function run(state: GameState, command: Command, content: ReturnType<typeof setup>['content']): GameState {
  const result = submitCommand(state, command, content);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const offerPeace = (terms: PeaceTerms): Command => ({ type: 'proposeTreaty', empire: ALPHA, to: BETA, treaty: 'peace', terms });

describe('paying for peace', () => {
  it('holds the credits offered, and pays them and the colonies over when peace is signed', () => {
    const { state, content, tarsis } = setup();
    const offered = run(state, offerPeace({ credits: 300, systems: [tarsis] }), content);
    expect(offered.empires[ALPHA].credits).toBe(200);
    expect(offered.offers[0].terms).toEqual({ credits: 300, systems: [tarsis] });

    const signed = run(offered, { type: 'answerOffer', empire: BETA, offer: offered.offers[0].id, accept: true }, content);
    expect(hasTreaty(signed, ALPHA, BETA, 'peace')).toBe(true);
    expect(signed.empires[ALPHA].credits).toBe(200);
    expect(signed.empires[BETA].credits).toBe(400);
    expect(signed.pendingEvents).toContainEqual({ type: 'peaceBought', empires: [ALPHA, BETA], by: ALPHA, credits: 300, systems: [tarsis] });
    // The payer's people take it hard.
    expect(homeOf(signed, ALPHA).colony!.moraleEffects.map((e) => e.source)).toContain('peaceBought');
    // The colony changes hands when the turn resolves, so neither side learns anything mid-turn.
    expect(signed.systems[tarsis].colony!.owner).toBe(ALPHA);
    expect(termsBlocker(signed, ALPHA, 'peace', { credits: 0, systems: [tarsis] })).toBe('Tarsis has already been given up');
    const next = processTurn(signed, content).state;
    // It changes hands whole: its people, buildings and member race.
    const colony = next.systems[tarsis].colony!;
    expect(colony).toMatchObject({ owner: BETA, minorRace: 'sages' });
    expect(colony.population).toBeGreaterThanOrEqual(6);
    expect(colony.buildings).toEqual(state.systems[tarsis].colony!.buildings);
    expect(next.empires[ALPHA].members).toEqual([]);
    expect(next.empires[BETA].members).toEqual(['sages']);
    expect(next.empires[BETA].knownSystems[tarsis]).toBe(BETA);
    expect(next.cessions).toEqual([]);
    expect(checkInvariants(next, content)).toEqual([]);
  });

  it('hands the credits back when the offer is refused or runs out', () => {
    const { state, content } = setup();
    const offered = run(state, offerPeace({ credits: 300, systems: [] }), content);
    const refused = run(offered, { type: 'answerOffer', empire: BETA, offer: offered.offers[0].id, accept: false }, content);
    expect(refused.empires[ALPHA].credits).toBe(500);
    expect(refused.offers).toEqual([]);

    let lapsed = offered;
    for (let i = 0; i < content.rules.diplomacy.offerTurns; i++) lapsed = processTurn(lapsed, content).state;
    expect(lapsed.offers).toEqual([]);
    expect(lapsed.empires[ALPHA].credits).toBeGreaterThanOrEqual(500);
  });

  it('hands the credits back when the other side signs its own offer of peace first', () => {
    const { state, content } = setup();
    const offered = run(state, offerPeace({ credits: 300, systems: [] }), content);
    // Beta's own plain offer would be refused as a duplicate, so put it in by hand.
    offered.offers.push({ id: 'off-00777', from: BETA, to: ALPHA, type: 'peace', turn: offered.turn, terms: null });
    const signed = run(offered, { type: 'answerOffer', empire: ALPHA, offer: 'off-00777', accept: true }, content);
    expect(signed.offers).toEqual([]);
    expect(signed.empires[ALPHA].credits).toBe(500);
    expect(signed.empires[BETA].credits).toBe(100);
  });

  it('says why terms cannot be offered', () => {
    const { state, content, tarsis } = setup();
    const why = (command: Command, s: GameState = state) => validateCommand(s, command, content)?.message;
    expect(why(offerPeace({ credits: 600, systems: [] }))).toBe('That costs 600 credits; you have 500');
    expect(why(offerPeace({ credits: 0, systems: [] }))).toBe('Offer credits or a colony, or propose a plain peace');
    expect(why(offerPeace({ credits: 10, systems: [homeOf(state, ALPHA).id] }))).toBe(`${homeOf(state, ALPHA).name} is your home system and cannot be given away`);
    expect(why(offerPeace({ credits: 0, systems: [homeOf(state, BETA).id] }))).toBe(`${homeOf(state, BETA).name} is not yours to give`);
    expect(why(offerPeace({ credits: 0, systems: [tarsis, tarsis] }))).toBe('A colony is offered twice');
    expect(why({ type: 'proposeTreaty', empire: ALPHA, to: BETA, treaty: 'nonAggression', terms: { credits: 10, systems: [] } }, { ...state, wars: {} })).toBe(
      'Only a peace can be paid for',
    );
    // A colony lost before the answer cannot be handed over, so the offer cannot be accepted.
    const offered = run(state, offerPeace({ credits: 0, systems: [tarsis] }), content);
    offered.systems[tarsis].colony!.owner = BETA;
    expect(why({ type: 'answerOffer', empire: BETA, offer: offered.offers[0].id, accept: true }, offered)).toBe('Tarsis is not yours to give');
  });

  it('keeps the terms between the two empires', () => {
    const { state, content, tarsis } = setup();
    state.empires['emp-3' as never] = { ...structuredClone(state.empires[BETA]), id: 'emp-3' } as never;
    const offered = run(state, offerPeace({ credits: 300, systems: [tarsis] }), content);
    expect(redactFor(offered, BETA, content).offers[0].terms).toEqual({ credits: 300, systems: [tarsis] });
    expect(redactFor(offered, 'emp-3' as never, content).offers).toEqual([]);
  });

  it('upgrades a version 11 save with offers that carry no terms', () => {
    const { state } = setup();
    const raw = JSON.parse(serialize(state));
    raw.saveVersion = 11;
    raw.offers = [{ id: 'off-00001', from: ALPHA, to: BETA, type: 'peace', turn: 1 }];
    const loaded = deserialize(JSON.stringify(raw));
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(loaded.value.offers[0].terms).toBeNull();
  });
});
