import { describe, expect, it } from 'vitest';
import { createPlanner } from '../../src/ai/agent';
import { GIFT_EVERY_TURNS, giveGift } from '../../src/ai/credits';
import { loadContent } from '../../src/data';
import { opinionBreakdown, redactFor, type Content, type FactionId, type GameState } from '../../src/sim';
import { ALPHA, BETA, introduce, newGame } from '../fixture';

const of = (content: Content, faction: string) => content.ai.personalities[faction as FactionId];

/** Alpha gives once it has four gifts' worth (200 credits) to spare; the fixture's gift is 50. */
function setup() {
  const { state, content } = newGame(3);
  of(content, 'alpha').gifts = 4;
  introduce(state, ALPHA, BETA);
  state.empires[ALPHA].credits = 200;
  /** Alpha decides from what it knows, as in a real turn. */
  const give = (s: GameState) => {
    const plan = createPlanner(redactFor(s, ALPHA, content), content);
    const gave = giveGift(plan, ALPHA, content, of(content, 'alpha'));
    return { gave, issued: plan.issued, after: plan.state };
  };
  return { state, content, give };
}

describe('the AI giving gifts', () => {
  it('sends one remembered gift from a full treasury to a power it is at peace with', () => {
    const { state, content, give } = setup();
    const { gave, issued, after } = give(state);
    expect(gave).toBe(true);
    expect(issued).toEqual([{ type: 'giftCredits', empire: ALPHA, to: BETA, amount: 50 }]);
    expect(after.empires[ALPHA].credits).toBe(150);
    expect(opinionBreakdown(after, BETA, ALPHA, content).lines).toContainEqual({ source: 'They sent us a gift', kind: 'flat', value: 10 });
  });

  it('keeps its money when short, when it does not give, and when it has met nobody', () => {
    const { state, content, give } = setup();
    const short = structuredClone(state);
    short.empires[ALPHA].credits = 199;
    expect(give(short).gave).toBe(false);

    of(content, 'alpha').gifts = 0;
    expect(give(state).gave).toBe(false);
    of(content, 'alpha').gifts = 4;

    const { state: strangers } = newGame(3);
    strangers.empires[ALPHA].credits = 500;
    expect(give(strangers).gave).toBe(false);
  });

  it('gives nothing to an empire it is fighting, or one that is gone', () => {
    const { state, give } = setup();
    const war = structuredClone(state);
    war.wars[`${ALPHA}|${BETA}`] = 1;
    war.wars[`${BETA}|${ALPHA}`] = 1;
    expect(give(war).gave).toBe(false);

    const gone = structuredClone(state);
    gone.empires[BETA].eliminated = true;
    expect(give(gone).gave).toBe(false);
  });

  it('waits before giving to the same empire again', () => {
    const { state, give } = setup();
    state.empires[ALPHA].credits = 1000;
    const first = give(state).after;
    // The redacted copy was Alpha's; carry the gift over to the real game.
    state.empires[ALPHA].credits = first.empires[ALPHA].credits;
    state.opinions[BETA] = { [ALPHA]: [{ cause: 'gift', turn: state.turn }] };

    state.turn += GIFT_EVERY_TURNS - 1;
    expect(give(state).gave).toBe(false);
    state.turn += 1;
    expect(give(state).gave).toBe(true);
  });

  it('is switched on for the powers that give in the shipped data', () => {
    const shipped = loadContent();
    expect(of(shipped, 'concord').gifts).toBeGreaterThan(0);
    expect(of(shipped, 'orrin').gifts).toBeGreaterThan(0);
    expect(of(shipped, 'vashran').gifts).toBe(0);
  });
});
