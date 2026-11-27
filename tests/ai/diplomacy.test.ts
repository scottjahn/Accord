import { describe, expect, it } from 'vitest';
import { createPlanner, runAgent } from '../../src/ai/agent';
import { answerOffers, attackable, concedesTo, guardAccord, judgeOffer, peacePrice, peaceTerms, proposeTreaties, termsValue, wantsPeace } from '../../src/ai/diplomacy';
import { standardAgent } from '../../src/ai/standardAgent';
import {
  addColonyMorale,
  addOpinion,
  hasTreaty,
  redactFor,
  signTreaty,
  submitCommand,
  warKey,
  type FactionId,
  type GameState,
  type MinorId,
  type PeaceTerms,
  type SystemId,
} from '../../src/sim';
import { ALPHA, BETA, addFleet, colonyOf, homeOf, introduce, newGame } from '../fixture';

/** Beta is the AI under test; Alpha is the empire dealing with it. They have met. */
function setup() {
  const { state, content } = newGame(5);
  introduce(state, ALPHA, BETA);
  const personality = content.ai.personalities[state.empires[BETA].faction as FactionId];
  const judge = (s: GameState, type: Parameters<typeof judgeOffer>[3], ambitious = false) =>
    judgeOffer(redactFor(s, BETA, content), BETA, ALPHA, type, content, 'develop', ambitious);
  const plan = (s: GameState = state) => createPlanner(redactFor(s, BETA, content), content);
  return { state, content, personality, judge, plan };
}

describe('judging an offer', () => {
  it('accepts lesser treaties from a stranger but wants trust before an alliance', () => {
    const { state, judge } = setup();
    expect(judge(state, 'nonAggression')).toEqual({ accept: true, note: '' });
    expect(judge(state, 'openBorders').accept).toBe(true);
    expect(judge(state, 'researchPact')).toEqual({
      accept: false,
      note: 'They do not think well enough of you for a research pact (opinion 0, needs 5).',
    });
    expect(judge(state, 'alliance').note).toMatch(/opinion 0, needs 35/);
  });

  it('climbs the ladder as treaties build opinion', () => {
    const { state, content, judge } = setup();
    signTreaty(state, ALPHA, BETA, 'nonAggression', content); // +10
    expect(judge(state, 'researchPact').accept).toBe(true);
    signTreaty(state, ALPHA, BETA, 'researchPact', content); // +20
    signTreaty(state, ALPHA, BETA, 'openBorders', content); // +25
    expect(judge(state, 'alliance').accept).toBe(false);
    state.turn = 41; // four decades of friendship: +12
    expect(judge(state, 'alliance')).toEqual({ accept: true, note: '' });
  });

  it('refuses anyone it holds a grudge against', () => {
    const { state, judge } = setup();
    addOpinion(state, BETA, ALPHA, 'treatyBroken');
    expect(judge(state, 'nonAggression').note).toMatch(/opinion -50, needs -10/);
  });

  it('will not tie its hands when war looks as good as peace', () => {
    const { state, judge } = setup();
    expect(judge(state, 'nonAggression', true)).toEqual({ accept: false, note: 'They see no reason to tie their hands.' });
    expect(judge(state, 'openBorders', true).accept).toBe(true);
  });

  it('will not ally with an equal that has more minor races, but concedes to a far greater power', () => {
    const { state, content, judge } = setup();
    signTreaty(state, ALPHA, BETA, 'nonAggression', content);
    signTreaty(state, ALPHA, BETA, 'researchPact', content);
    signTreaty(state, ALPHA, BETA, 'openBorders', content);
    state.turn = 41;
    state.minorsPlaced = 4;
    state.empires[ALPHA].members = ['sages'] as MinorId[];
    expect(judge(state, 'alliance')).toEqual({
      accept: false,
      note: 'They will not accept your leadership of the Accord while they are your equal.',
    });

    // Beta learns that Alpha holds half as many colonies again as it does (two to Beta's one).
    const spare = Object.values(state.systems).find((s) => !s.colony)!;
    spare.colony = { ...structuredClone(colonyOf(state, ALPHA)), population: 2 };
    state.empires[BETA].knownSystems[spare.id] = ALPHA;
    expect(concedesTo(redactFor(state, BETA, content), BETA, ALPHA)).toBe(true);
    expect(judge(state, 'alliance').accept).toBe(true);
  });

  it('makes peace when weary or outgunned, and not when it thinks it is winning', () => {
    const { state, content, judge } = setup();
    state.wars[warKey(ALPHA, BETA)] = 1;
    expect(judge(state, 'peace')).toEqual({ accept: false, note: 'They believe they are winning the war.' });

    const weary = structuredClone(state);
    for (const kind of ['colonyLost', 'battleLost', 'starvation'] as const) addColonyMorale(weary, homeOf(weary, BETA), kind, content);
    expect(wantsPeace(redactFor(weary, BETA, content), BETA, ALPHA, content)).toBe(true);
    expect(judge(weary, 'peace').accept).toBe(true);

    const outgunned = structuredClone(state);
    addFleet(outgunned, content, ALPHA, homeOf(outgunned, BETA).sector, ['destroyer', 'destroyer']);
    addFleet(outgunned, content, BETA, homeOf(outgunned, BETA).sector, ['frigate']);
    expect(judge(outgunned, 'peace').accept).toBe(true);
  });
});

describe('answering and proposing', () => {
  it('answers every offer waiting for it, with its reason when it refuses', () => {
    const { state, content, plan } = setup();
    const offered = [
      { type: 'proposeTreaty', empire: ALPHA, to: BETA, treaty: 'nonAggression' },
      { type: 'proposeTreaty', empire: ALPHA, to: BETA, treaty: 'alliance' },
    ].reduce((s, cmd) => {
      const r = submitCommand(s, cmd as never, content);
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    }, state);

    const p = plan(offered);
    answerOffers(p, BETA, content, 'develop');
    expect(p.issued).toMatchObject([
      { type: 'answerOffer', accept: true },
      { type: 'answerOffer', accept: false, note: expect.stringMatching(/needs 35/) },
    ]);
    expect(hasTreaty(p.state, ALPHA, BETA, 'nonAggression')).toBe(true);
    expect(p.state.offers).toEqual([]);
  });

  it('proposes the next treaty up the ladder, one at a time, and only to empires it has met', () => {
    const { state, content, plan } = setup();
    const p = plan();
    proposeTreaties(p, BETA, content, 'develop');
    expect(p.issued).toEqual([{ type: 'proposeTreaty', empire: BETA, to: ALPHA, treaty: 'nonAggression' }]);

    signTreaty(state, ALPHA, BETA, 'nonAggression', content);
    const next = plan();
    proposeTreaties(next, BETA, content, 'develop');
    expect(next.issued).toEqual([{ type: 'proposeTreaty', empire: BETA, to: ALPHA, treaty: 'researchPact' }]);

    const strangers = newGame(5);
    const q = createPlanner(redactFor(strangers.state, BETA, strangers.content), strangers.content);
    proposeTreaties(q, BETA, strangers.content, 'develop');
    expect(q.issued).toEqual([]);
  });

  it('sues for peace when the war is going badly, and proposes nothing else while at war', () => {
    const { state, content, plan } = setup();
    state.wars[warKey(ALPHA, BETA)] = 1;
    const fine = plan();
    proposeTreaties(fine, BETA, content, 'war');
    expect(fine.issued).toEqual([]);

    for (const kind of ['colonyLost', 'battleLost', 'starvation'] as const) addColonyMorale(state, homeOf(state, BETA), kind, content);
    const weary = plan();
    proposeTreaties(weary, BETA, content, 'war');
    expect(weary.issued).toEqual([{ type: 'proposeTreaty', empire: BETA, to: ALPHA, treaty: 'peace' }]);
  });
});

describe('treaties and war', () => {
  it('leaves treaty partners alone unless war is tempting enough to overcome its honour', () => {
    const { state, content, personality } = setup();
    const known = () => redactFor(state, BETA, content);
    expect(attackable(known(), BETA, personality, 0)).toEqual([ALPHA]);
    signTreaty(state, ALPHA, BETA, 'nonAggression', content);
    expect(attackable(known(), BETA, personality, 0)).toEqual([]);
    expect(attackable(known(), BETA, personality, personality.honour)).toEqual([]);
    expect(attackable(known(), BETA, personality, personality.honour + 1)).toEqual([ALPHA]);
  });

  it('does not declare war on a partner it has no wish to betray', () => {
    const { state, content } = setup();
    signTreaty(state, ALPHA, BETA, 'nonAggression', content);
    addFleet(state, content, BETA, homeOf(state, BETA).sector, ['frigate', 'frigate', 'frigate']);
    const { commands } = runAgent(standardAgent, state, BETA, content);
    expect(commands.some((c) => c.type === 'declareWar' || c.type === 'breakTreaty')).toBe(false);
  });

  it('leaves an alliance rather than let an equal take the Accord', () => {
    const { state, content, plan } = setup();
    signTreaty(state, ALPHA, BETA, 'alliance', content);
    state.minorsPlaced = 4;
    state.empires[ALPHA].members = ['sages'] as MinorId[]; // one more would make half
    const p = plan();
    guardAccord(p, BETA, content);
    expect(p.issued).toEqual([{ type: 'breakTreaty', empire: BETA, with: ALPHA, treaty: 'alliance' }]);

    // With more members itself, it is the one who stands to gain, and stays.
    state.empires[BETA].members = ['bards', 'pilots'] as MinorId[];
    const q = plan();
    guardAccord(q, BETA, content);
    expect(q.issued).toEqual([]);
  });
});

describe('after making peace', () => {
  it('does not break the treaty it has just signed to go back to war', () => {
    const { state, content } = setup();
    state.wars[warKey(ALPHA, BETA)] = 1;
    // Alpha's fleet over Beta's home: Beta is outgunned and wants peace.
    addFleet(state, content, ALPHA, homeOf(state, BETA).sector, ['destroyer', 'destroyer', 'destroyer', 'destroyer']);
    const offered = submitCommand(state, { type: 'proposeTreaty', empire: ALPHA, to: BETA, treaty: 'peace' }, content);
    if (!offered.ok) throw new Error(offered.error.message);
    // Its posture is still war from its last review.
    const out = standardAgent(redactFor(offered.value, BETA, content), BETA, content, { posture: 'war', postureTurn: offered.value.turn });
    const diplomacy = out.commands.filter((c) => ['answerOffer', 'breakTreaty', 'declareWar'].includes(c.type));
    expect(diplomacy).toEqual([{ type: 'answerOffer', empire: BETA, offer: offered.value.offers[0].id, accept: true, note: '' }]);
    // It reconsidered its posture there and then.
    expect(out.memory).toMatchObject({ postureTurn: offered.value.turn });
    expect((out.memory as { posture: string }).posture).not.toBe('war');
  });
});

describe('paying for peace', () => {
  /** Paying for peace switched on, Alpha and Beta at war, and Beta with a second colony away from home. */
  function war() {
    const ctx = setup();
    const { state, content } = ctx;
    content.ai.peace = { colonyValue: 300, takePercent: 100, perPopulation: 20, freeBelowEdgePercent: 100, nearVictoryPercent: 100, treasuryPercent: 50, maxColonies: 1 };
    state.wars[warKey(ALPHA, BETA)] = 1;
    const spare = (Object.keys(state.systems) as SystemId[]).sort().find((id) => !state.systems[id].colony)!;
    state.systems[spare].minor = null;
    state.systems[spare].colony = { ...structuredClone(homeOf(state, BETA).colony!), population: 5, minorRace: null };
    state.empires[ALPHA].knownSystems[spare] = BETA;
    return { ...ctx, spare };
  }
  const beta = (c: ReturnType<typeof war>['content']) => c.ai.personalities[Object.keys(c.ai.personalities).find((k) => k === 'beta') as FactionId];

  it('prices peace by the colonies at stake, the edge in fleet power and the appetite for war', () => {
    const { content } = war();
    const p = beta(content);
    expect(peacePrice(100, 4, p, content)).toBe(0);
    expect(peacePrice(150, 4, p, content)).toBe((4 * 300 * 50 * p.posture.war) / 10000);
    // Beyond double the enemy's power the price stops growing.
    expect(peacePrice(500, 4, p, content)).toBe(peacePrice(200, 4, p, content));
  });

  it('a winner sells peace for its price and says what it wants when the offer falls short', () => {
    const { state, content, spare } = war();
    // Alpha, the winner here, has the fleet; Beta has none.
    addFleet(state, content, ALPHA, homeOf(state, ALPHA).sector, ['destroyer', 'destroyer']);
    const judge = (terms: PeaceTerms | null) =>
      judgeOffer(redactFor(state, ALPHA, content), ALPHA, BETA, 'peace', content, 'war', false, terms);
    // Two Beta colonies known, edge beyond double: 2 x 300 x 100% x war weight.
    const price = peacePrice(1000, 2, content.ai.personalities[state.empires[ALPHA].faction], content);
    expect(price).toBeGreaterThan(0);
    expect(judge(null)).toEqual({ accept: false, note: `They want at least ${price} credits' worth for peace (offered 0).` });
    expect(judge({ credits: price, systems: [] }).accept).toBe(true);
    // A colony is worth its base value and its people, if they can be seen; out of sight, the base value alone.
    expect(termsValue(state, { credits: 0, systems: [spare] }, content)).toBe(300 + 5 * 20);
    expect(termsValue(redactFor(state, ALPHA, content), { credits: 0, systems: [spare] }, content)).toBe(300);
  });

  it('will not be bought off with victory in sight', () => {
    const { state, content } = war();
    addFleet(state, content, ALPHA, homeOf(state, ALPHA).sector, ['destroyer', 'destroyer']);
    content.ai.peace.nearVictoryPercent = 1;
    expect(judgeOffer(redactFor(state, ALPHA, content), ALPHA, BETA, 'peace', content, 'war', false, { credits: 99999, systems: [] })).toEqual({
      accept: false,
      note: 'Victory is in their sight; they will not stop now.',
    });
  });

  it('a loser pays in credits first, and adds its most exposed colony when they fall short', () => {
    const { state, content, spare, plan } = war();
    addFleet(state, content, ALPHA, homeOf(state, BETA).sector, ['destroyer', 'destroyer']);
    state.empires[BETA].knownSystems[homeOf(state, ALPHA).id] = ALPHA;
    state.empires[BETA].credits = 10000;
    const rich = peaceTerms(redactFor(state, BETA, content), BETA, ALPHA, content)!;
    expect(rich.systems).toEqual([]);
    expect(rich.credits).toBeGreaterThan(0);

    state.empires[BETA].credits = 100;
    const poor = peaceTerms(redactFor(state, BETA, content), BETA, ALPHA, content)!;
    expect(poor).toEqual({ credits: 50, systems: [spare] });

    // Suing for peace sends those terms.
    const sued = plan();
    proposeTreaties(sued, BETA, content, 'war');
    expect(sued.issued).toEqual([{ type: 'proposeTreaty', empire: BETA, to: ALPHA, treaty: 'peace', terms: { credits: 50, systems: [spare] } }]);
  });
});
