import { describe, expect, it } from 'vitest';
import { createPlanner, runAgent } from '../../src/ai/agent';
import { answerOffers, attackable, concedesTo, guardAccord, judgeOffer, proposeTreaties, wantsPeace } from '../../src/ai/diplomacy';
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
