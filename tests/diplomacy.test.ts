import { describe, expect, it } from 'vitest';
import {
  accordWinner,
  addOpinion,
  atWar,
  boundToPeace,
  createGame,
  deserialize,
  getOutputs,
  hasMet,
  hasTreaty,
  opinionBreakdown,
  processTurn,
  redactFor,
  sectorKey,
  serialize,
  submitCommand,
  suppliedSectors,
  treatiesBetween,
  visibleSectors,
  warKey,
  type Command,
  type EmpireId,
  type GameState,
  type MinorId,
  type TreatyType,
  type TurnEvent,
} from '../src/sim';
import { ALPHA, BETA, addFleet, colonyOf, fixtureContent, homeOf, introduce, newGame } from './fixture';

const GAMMA = 'emp-3' as EmpireId;

/**
 * Fixture diplomacy: non-aggression +10 opinion for 40 turns, research pact +10
 * (and +5% research), open borders +5, alliance +25 with no end, peace +5 for 20.
 * War -30. Friendship +3 per ten turns to +15. Being declared war on -40,
 * fading 4 per ten turns; a broken treaty -50 to the victim and -15 to onlookers.
 */
function setup(empires = 2) {
  const content = fixtureContent();
  const factions = ['alpha', 'beta', 'alpha'].slice(0, empires);
  const state = createGame(
    { seed: 5, galaxyPreset: 'tiny', empires: factions.map((faction) => ({ faction, controller: 'ai' as const })) },
    content,
  );
  introduce(state, ALPHA, BETA);
  if (empires === 3) {
    introduce(state, ALPHA, GAMMA);
    introduce(state, BETA, GAMMA);
  }
  const apply = (s: GameState, cmd: Command): GameState => {
    const r = submitCommand(s, cmd, content);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.value;
  };
  const why = (s: GameState, cmd: Command) => {
    const r = submitCommand(s, cmd, content);
    return r.ok ? 'ok' : r.error.message;
  };
  /** Alpha proposes and Beta accepts. */
  const sign = (s: GameState, treaty: TreatyType, from = ALPHA, to = BETA): GameState => {
    const offered = apply(s, { type: 'proposeTreaty', empire: from, to, treaty });
    return apply(offered, { type: 'answerOffer', empire: to, offer: offered.offers[offered.offers.length - 1].id, accept: true });
  };
  const opinion = (s: GameState, of: EmpireId, about: EmpireId) => opinionBreakdown(s, of, about, content);
  return { state, content, apply, why, sign, opinion };
}

const run = (state: GameState, content: ReturnType<typeof fixtureContent>, turns: number) => {
  let s = state;
  const events: TurnEvent[] = [];
  for (let i = 0; i < turns; i++) {
    const step = processTurn(s, content);
    s = step.state;
    events.push(...step.events);
  }
  return { state: s, events };
};

describe('contact', () => {
  it('needs one empire to have found a colony of the other before they can negotiate', () => {
    const { state, why } = newGameWithoutContact();
    expect(hasMet(state, ALPHA, BETA)).toBe(false);
    expect(why(state, { type: 'proposeTreaty', empire: ALPHA, to: BETA, treaty: 'nonAggression' })).toBe('You have not made contact with them yet');
    state.empires[BETA].knownSystems[state.empires[ALPHA].homeSystem] = ALPHA;
    expect(hasMet(state, ALPHA, BETA)).toBe(true);
    expect(why(state, { type: 'proposeTreaty', empire: ALPHA, to: BETA, treaty: 'nonAggression' })).toBe('ok');
  });

  function newGameWithoutContact() {
    const { state, content } = newGame(5);
    const why = (s: GameState, cmd: Command) => {
      const r = submitCommand(s, cmd, content);
      return r.ok ? 'ok' : r.error.message;
    };
    return { state, why };
  }
});

describe('proposing and answering', () => {
  it('an offer waits for the other side, and is reported to both', () => {
    const { state, content, apply } = setup();
    const offered = apply(state, { type: 'proposeTreaty', empire: ALPHA, to: BETA, treaty: 'nonAggression' });
    expect(offered.offers).toEqual([{ id: expect.stringMatching(/^off-/), from: ALPHA, to: BETA, type: 'nonAggression', turn: 1 }]);
    expect(offered.treaties).toEqual([]);
    const { events } = processTurn(offered, content);
    expect(events).toContainEqual({ type: 'offerMade', empires: [ALPHA, BETA], offer: offered.offers[0] });
  });

  it('accepting signs the treaty; refusing reports the reason', () => {
    const { state, content, apply } = setup();
    const offered = apply(state, { type: 'proposeTreaty', empire: ALPHA, to: BETA, treaty: 'nonAggression' });
    const id = offered.offers[0].id;

    const signed = apply(offered, { type: 'answerOffer', empire: BETA, offer: id, accept: true });
    expect(signed.offers).toEqual([]);
    expect(signed.treaties).toEqual([{ type: 'nonAggression', parties: [ALPHA, BETA], startTurn: 1, since: 1, endTurn: 41 }]);
    expect(processTurn(signed, content).events).toContainEqual({ type: 'treatySigned', empires: [ALPHA, BETA], treaty: signed.treaties[0] });

    const refused = apply(offered, { type: 'answerOffer', empire: BETA, offer: id, accept: false, note: 'Not today.' });
    expect(refused.offers).toEqual([]);
    expect(refused.treaties).toEqual([]);
    expect(processTurn(refused, content).events).toContainEqual({ type: 'offerRefused', empires: [ALPHA, BETA], offer: offered.offers[0], note: 'Not today.' });
  });

  it('only the empire it was sent to can answer', () => {
    const { state, apply, why } = setup();
    const offered = apply(state, { type: 'proposeTreaty', empire: ALPHA, to: BETA, treaty: 'nonAggression' });
    expect(why(offered, { type: 'answerOffer', empire: ALPHA, offer: offered.offers[0].id, accept: true })).toBe('There is no such offer to answer');
    expect(why(offered, { type: 'answerOffer', empire: BETA, offer: 'off-99999', accept: true })).toBe('There is no such offer to answer');
  });

  it('rejects duplicates, treaties already in force, and peace when there is no war', () => {
    const { state, apply, why, sign } = setup();
    const propose = (treaty: TreatyType, empire = ALPHA, to = BETA): Command => ({ type: 'proposeTreaty', empire, to, treaty });
    const offered = apply(state, propose('nonAggression'));
    expect(why(offered, propose('nonAggression'))).toBe('That treaty has already been proposed');
    expect(why(offered, propose('nonAggression', BETA, ALPHA))).toBe('That treaty has already been proposed');
    expect(why(sign(state, 'nonAggression'), propose('nonAggression'))).toBe('Non-aggression pact is already in force');
    expect(why(state, propose('peace'))).toBe('You are not at war');
    expect(why(state, propose('alliance', ALPHA, ALPHA))).toBe('Choose another empire');
  });

  it('an unanswered offer lapses after three turns', () => {
    const { state, content, apply } = setup();
    const offered = apply(state, { type: 'proposeTreaty', empire: ALPHA, to: BETA, treaty: 'nonAggression' });
    expect(run(offered, content, 2).state.offers).toHaveLength(1);
    expect(run(offered, content, 3).state.offers).toEqual([]);
  });
});

describe('what treaties do', () => {
  it('non-aggression forbids declaring war until it is broken', () => {
    const { state, sign, why } = setup();
    const bound = sign(state, 'nonAggression');
    expect(boundToPeace(bound, ALPHA, BETA)).toBe(true);
    expect(why(bound, { type: 'declareWar', empire: ALPHA, on: BETA })).toBe('A treaty forbids it; break the treaty first');
    expect(why(bound, { type: 'declareWar', empire: BETA, on: ALPHA })).toBe('A treaty forbids it; break the treaty first');
    expect(why(state, { type: 'declareWar', empire: ALPHA, on: BETA })).toBe('ok');
  });

  it('a research pact adds a traceable research bonus for both parties', () => {
    const { state, content, sign } = setup();
    const pact = sign(state, 'researchPact');
    const alpha = getOutputs(pact, homeOf(pact, ALPHA).id, content).research;
    expect(alpha.lines).toContainEqual({ source: 'Research pact with Beta', kind: 'percent', value: 5 });
    expect(getOutputs(pact, homeOf(pact, BETA).id, content).research.lines).toContainEqual({ source: 'Research pact with Alpha', kind: 'percent', value: 5 });
    expect(getOutputs(state, homeOf(state, ALPHA).id, content).research.lines.some((l) => l.source.startsWith('Research pact'))).toBe(false);
  });

  it("open borders lets fleets use the partner's supply range", () => {
    const { state, content, sign, why } = setup();
    const theirHome = homeOf(state, BETA).sector;
    const fleet = addFleet(state, content, ALPHA, homeOf(state, ALPHA).sector, ['frigate']);
    const move: Command = { type: 'moveFleet', empire: ALPHA, fleet: fleet.id, to: theirHome };
    expect(suppliedSectors(state, ALPHA, 2).has(sectorKey(theirHome))).toBe(false);
    // The two homes are too far apart to cross in this galaxy, so judge by the supplied sectors.
    const open = sign(state, 'openBorders');
    expect(suppliedSectors(open, ALPHA, 2).has(sectorKey(theirHome))).toBe(true);
    expect(suppliedSectors(open, BETA, 2).has(sectorKey(homeOf(state, ALPHA).sector))).toBe(true);
    expect(why(state, move)).toBe('That sector is outside supply range');
  });

  it('an alliance shares sight from the following turn, forbids war, and opens borders', () => {
    const { state, content, sign } = setup();
    const theirHome = sectorKey(homeOf(state, BETA).sector);
    const allied = sign(state, 'alliance');
    expect(allied.treaties[0].endTurn).toBeNull();
    expect(boundToPeace(allied, ALPHA, BETA)).toBe(true);
    expect(suppliedSectors(allied, ALPHA, 2).has(theirHome)).toBe(true);
    expect(visibleSectors(allied, ALPHA, content).has(theirHome)).toBe(false); // not the turn it is signed
    const next = processTurn(allied, content).state;
    expect(visibleSectors(next, ALPHA, content).has(theirHome)).toBe(true);
    expect(visibleSectors(next, BETA, content).has(sectorKey(homeOf(next, ALPHA).sector))).toBe(true);
  });

  it('peace ends the war, starts a truce, and calls off invasions', () => {
    const { state, content, apply, why } = setup();
    let s = apply(state, { type: 'declareWar', empire: ALPHA, on: BETA });
    content.rules.fleets.baseRange = 20;
    const troops = addFleet(s, content, ALPHA, homeOf(s, ALPHA).sector, ['transport']);
    s = apply(s, { type: 'invadeSystem', empire: ALPHA, fleet: troops.id, system: homeOf(s, BETA).id });
    expect(why(s, { type: 'proposeTreaty', empire: ALPHA, to: BETA, treaty: 'nonAggression' })).toBe('Make peace first');

    s = apply(s, { type: 'proposeTreaty', empire: BETA, to: ALPHA, treaty: 'peace' });
    s = apply(s, { type: 'answerOffer', empire: ALPHA, offer: s.offers[0].id, accept: true });
    expect(atWar(s, ALPHA, BETA)).toBe(false);
    expect(s.wars[warKey(ALPHA, BETA)]).toBeUndefined();
    expect(s.treaties[0]).toMatchObject({ type: 'peace', endTurn: 21 });
    expect(s.fleets[troops.id].order).toBe('none');
    expect(why(s, { type: 'declareWar', empire: BETA, on: ALPHA })).toBe('A treaty forbids it; break the treaty first');
  });

  it('lapse when their time is up, and are reported', () => {
    const { state, content, sign } = setup();
    const signed = sign(state, 'nonAggression'); // to turn 41
    const before = run(signed, content, 39);
    expect(hasTreaty(before.state, ALPHA, BETA, 'nonAggression')).toBe(true);
    const after = run(before.state, content, 1);
    expect(hasTreaty(after.state, ALPHA, BETA, 'nonAggression')).toBe(false);
    expect(after.events).toContainEqual({ type: 'treatyExpired', empires: [ALPHA, BETA], treaty: signed.treaties[0] });
    expect(boundToPeace(after.state, ALPHA, BETA)).toBe(false);
  });

  it('survive save and load', () => {
    const { state, sign } = setup();
    const signed = sign(state, 'researchPact');
    const loaded = deserialize(serialize(signed));
    expect(loaded.ok && loaded.value.treaties).toEqual(signed.treaties);
  });
});

describe('opinion', () => {
  it('starts at nothing and lists each treaty in force', () => {
    const { state, sign, opinion } = setup();
    expect(opinion(state, BETA, ALPHA)).toEqual({ total: 0, lines: [] });
    const friends = sign(sign(state, 'nonAggression'), 'researchPact');
    expect(opinion(friends, BETA, ALPHA)).toEqual({
      total: 20,
      lines: [
        { source: 'Non-aggression pact in force', kind: 'flat', value: 10 },
        { source: 'Research pact in force', kind: 'flat', value: 10 },
      ],
    });
    expect(opinion(friends, ALPHA, BETA).total).toBe(20);
  });

  it('remembers being attacked, and that memory fades', () => {
    const { state, apply, opinion } = setup();
    const war = apply(state, { type: 'declareWar', empire: ALPHA, on: BETA });
    expect(opinion(war, BETA, ALPHA)).toEqual({
      total: -70,
      lines: [
        { source: 'They declared war on us', kind: 'flat', value: -40 },
        { source: 'At war', kind: 'flat', value: -30 },
      ],
    });
    expect(opinion(war, ALPHA, BETA).total).toBe(-30); // the aggressor only has the war itself against them

    delete war.wars[warKey(ALPHA, BETA)];
    war.turn = 51; // five decades on: -40 + 20
    expect(opinion(war, BETA, ALPHA).total).toBe(-20);
    war.turn = 200;
    expect(opinion(war, BETA, ALPHA).total).toBe(0);
  });

  it('fades more slowly for a power that bears grudges', () => {
    const { state, content, opinion } = setup();
    addOpinion(state, BETA, ALPHA, 'warDeclared');
    state.turn = 51;
    expect(opinion(state, BETA, ALPHA).total).toBe(-20);
    content.factions[state.empires[BETA].faction].grudgePercent = 200;
    expect(opinion(state, BETA, ALPHA).total).toBe(-30);
  });

  it('forgets faded memories altogether', () => {
    const { state, content } = setup();
    addOpinion(state, BETA, ALPHA, 'warDeclared');
    state.turn = 150;
    expect(processTurn(state, content).state.opinions[BETA][ALPHA]).toEqual([]);
  });

  it('grows with a long friendship, kept across a prompt renewal', () => {
    const { state, content, sign, opinion } = setup();
    let s = run(sign(state, 'nonAggression'), content, 30).state; // turn 31
    expect(opinion(s, BETA, ALPHA).lines).toContainEqual({ source: 'Long friendship', kind: 'flat', value: 9 });

    s = run(s, content, 12).state; // lapsed at 41; now turn 43
    expect(hasTreaty(s, ALPHA, BETA, 'nonAggression')).toBe(false);
    s = sign(s, 'nonAggression');
    expect(s.treaties[0]).toMatchObject({ startTurn: 43, since: 1 });
    expect(opinion(s, BETA, ALPHA).lines).toContainEqual({ source: 'Long friendship', kind: 'flat', value: 12 });

    // Left too long, the friendship starts again.
    const late = sign(run(sign(state, 'nonAggression'), content, 60).state, 'nonAggression');
    expect(late.treaties[0].since).toBe(61);
  });

  it('remembers a captured colony and a conquered minor race', () => {
    const { state, opinion } = setup();
    addOpinion(state, BETA, ALPHA, 'colonyCaptured');
    addOpinion(state, BETA, ALPHA, 'minorConquered');
    expect(opinion(state, BETA, ALPHA).total).toBe(-25);
  });

  it('stays within -100 and 100', () => {
    const { state, opinion } = setup();
    for (let i = 0; i < 5; i++) addOpinion(state, BETA, ALPHA, 'treatyBroken');
    expect(opinion(state, BETA, ALPHA).total).toBe(-100);
  });
});

describe('breaking a treaty', () => {
  it('ends it, and costs morale, the victim’s trust, onlookers’ respect and the minors’ regard', () => {
    const { state, content, sign, apply, opinion } = setup(3);
    const minorHome = Object.values(state.systems).find((s) => !s.colony)!;
    minorHome.minor = { race: 'bards' as MinorId, population: 6, attitude: { [ALPHA]: 50, [BETA]: 50 }, leader: null, leadTurns: 0 };
    const signed = sign(state, 'nonAggression');
    const broken = apply(signed, { type: 'breakTreaty', empire: ALPHA, with: BETA, treaty: 'nonAggression' });

    expect(broken.treaties).toEqual([]);
    expect(colonyOf(broken, ALPHA).moraleEffects).toContainEqual({ source: 'treatyBroken', value: -12, turnsLeft: 15 });
    expect(colonyOf(broken, BETA).morale).toBe(100);
    expect(opinion(broken, BETA, ALPHA).lines).toEqual([{ source: 'They broke a treaty with us', kind: 'flat', value: -50 }]);
    expect(opinion(broken, GAMMA, ALPHA).lines).toEqual([{ source: 'They broke their word to another', kind: 'flat', value: -15 }]);
    expect(opinion(broken, ALPHA, BETA).total).toBe(0);
    expect(broken.systems[minorHome.id].minor!.attitude).toEqual({ [ALPHA]: 40, [BETA]: 50 });
    expect(processTurn(broken, content).events).toContainEqual({ type: 'treatyBroken', empires: [ALPHA, BETA], by: ALPHA, treaty: signed.treaties[0] });
  });

  it('frees the breaker to declare war', () => {
    const { state, sign, apply, why } = setup();
    const broken = apply(sign(state, 'nonAggression'), { type: 'breakTreaty', empire: ALPHA, with: BETA, treaty: 'nonAggression' });
    expect(why(broken, { type: 'declareWar', empire: ALPHA, on: BETA })).toBe('ok');
  });

  it('rejects breaking a treaty that does not exist', () => {
    const { state, why } = setup();
    expect(why(state, { type: 'breakTreaty', empire: ALPHA, with: BETA, treaty: 'alliance' })).toBe('There is no such treaty to break');
  });
});

describe('war and the turn report', () => {
  it('names who declared war, once', () => {
    const { state, content, apply } = setup();
    const war = apply(state, { type: 'declareWar', empire: BETA, on: ALPHA });
    const first = processTurn(war, content);
    expect(first.events).toContainEqual({ type: 'warDeclared', by: BETA, on: ALPHA });
    expect(processTurn(first.state, content).events.some((e) => e.type === 'warDeclared')).toBe(false);
    expect(first.state.pendingEvents).toEqual([]);
  });
});

describe('the Accord victory', () => {
  /** Alpha and Beta allied, in a galaxy that began with four minor races. */
  function accord(alphaMembers: string[], betaMembers: string[] = []) {
    const ctx = setup();
    const state = ctx.sign(ctx.state, 'alliance');
    state.minorsPlaced = 4;
    state.empires[ALPHA].members = alphaMembers as MinorId[];
    state.empires[BETA].members = betaMembers as MinorId[];
    return { ...ctx, state };
  }

  it('goes to an empire allied with every rival that holds half the minor races', () => {
    const { state, content } = accord(['sages', 'bards']);
    expect(accordWinner(state, content)).toBe(ALPHA);
    const { state: next, events } = processTurn(state, content);
    expect(next.winner).toBe(ALPHA);
    expect(next.victory).toBe('accord');
    expect(events).toContainEqual({ type: 'gameWon', empire: ALPHA });
    expect(next.empires[BETA].eliminated).toBe(false);
  });

  it('needs the alliance and the members both', () => {
    const { state, content } = accord(['sages']);
    expect(accordWinner(state, content)).toBeNull(); // one of four is not half
    const unallied = accord(['sages', 'bards']);
    unallied.state.treaties = [];
    expect(accordWinner(unallied.state, unallied.content)).toBeNull();
  });

  it('needs every surviving rival as an ally', () => {
    const ctx = setup(3);
    const state = ctx.sign(ctx.state, 'alliance');
    state.minorsPlaced = 4;
    state.empires[ALPHA].members = ['sages', 'bards'] as MinorId[];
    expect(accordWinner(state, ctx.content)).toBeNull();
    const all = ctx.sign(state, 'alliance', ALPHA, GAMMA);
    expect(accordWinner(all, ctx.content)).toBe(ALPHA);
  });

  it('between two who qualify, the one with more members leads; a tie goes to the more learned', () => {
    expect(accordWinner(...pair(accord(['sages', 'bards', 'pilots'], ['wardens'])))).toBe(ALPHA);
    const tied = accord(['sages', 'bards'], ['wardens', 'blades']);
    expect(accordWinner(tied.state, tied.content)).toBeNull();
    tied.state.empires[BETA].research.levels.computing = 2;
    expect(accordWinner(tied.state, tied.content)).toBe(BETA);

    function pair(ctx: ReturnType<typeof accord>) {
      return [ctx.state, ctx.content] as const;
    }
  });

  it('is unavailable in a galaxy with no minor races, or when turned off', () => {
    const none = accord([]);
    none.state.minorsPlaced = 0;
    expect(accordWinner(none.state, none.content)).toBeNull();
    const off = accord(['sages', 'bards']);
    off.content.rules.diplomacy.accordMemberPercent = 0;
    expect(accordWinner(off.state, off.content)).toBeNull();
  });

  it('records how other games were won', () => {
    const { state, content } = setup();
    homeOf(state, BETA).colony = null;
    expect(processTurn(state, content).state.victory).toBe('conquest');
  });
});

describe('what an empire is allowed to know', () => {
  it('knows its own opinions and what others think of it, but not what rivals think of each other', () => {
    const { state, content } = setup(3);
    addOpinion(state, ALPHA, BETA, 'spyCaught');
    addOpinion(state, BETA, ALPHA, 'warDeclared');
    addOpinion(state, BETA, GAMMA, 'treatyBroken');
    const known = redactFor(state, ALPHA, content);
    expect(known.opinions[ALPHA][BETA]).toHaveLength(1);
    expect(known.opinions[BETA][ALPHA]).toHaveLength(1);
    expect(known.opinions[BETA][GAMMA]).toBeUndefined();
  });

  it('sees only offers it is part of, but all treaties', () => {
    const { state, content, apply, sign } = setup(3);
    let s = sign(state, 'researchPact', BETA, GAMMA);
    s = apply(s, { type: 'proposeTreaty', empire: BETA, to: GAMMA, treaty: 'alliance' });
    s = apply(s, { type: 'proposeTreaty', empire: BETA, to: ALPHA, treaty: 'nonAggression' });
    const known = redactFor(s, ALPHA, content);
    expect(known.offers.map((o) => o.type)).toEqual(['nonAggression']);
    expect(treatiesBetween(known, BETA, GAMMA)).toHaveLength(1);
    expect(known.pendingEvents).toEqual([]);
  });
});
