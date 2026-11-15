import { describe, expect, it } from 'vitest';
import { createPlanner } from '../src/ai/agent';
import { spendCredits } from '../src/ai/credits';
import { survey } from '../src/ai/maps';
import { setTargets } from '../src/ai/operational';
import { scorePostures } from '../src/ai/strategic';
import { admiredFields } from '../src/ai/tactical/minors';
import { colonyToDefend, threatenedColonies } from '../src/ai/tactical/war';
import { summarise, tweak, type BalanceGame } from '../src/runner/balance';
import {
  FIELDS,
  combatBonuses,
  dominationShareOf,
  empireScore,
  empireSupport,
  processTurn,
  researchTotal,
  victoryPaths,
  warKey,
  type BuildingId,
  type FactionId,
  type GameState,
  type MinorId,
} from '../src/sim';
import { ALPHA, BETA, addFleet, colonyOf, homeOf, newGame } from './fixture';

const levels = (state: GameState, empire: typeof ALPHA, each: number) => {
  for (const field of FIELDS) state.empires[empire].research.levels[field] = each;
};

/**
 * The fixture has every new victory switched off; each test turns on the one
 * it is about. Fixture score: 1 a person, 5 a colony, 3 a research level, 10 a member.
 */
describe('the research victory', () => {
  it('goes to the first empire whose field levels reach the total', () => {
    const { state, content } = newGame();
    content.rules.victory.researchLevels = 12;
    levels(state, ALPHA, 2);
    state.empires[ALPHA].research.levels.weapons = 1;
    expect(researchTotal(state, ALPHA)).toBe(11);
    expect(processTurn(state, content).state.winner).toBeNull();

    state.empires[ALPHA].research.levels.weapons = 2;
    const done = processTurn(state, content);
    expect(done.state.winner).toBe(ALPHA);
    expect(done.state.victory).toBe('research');
    expect(done.events).toContainEqual({ type: 'gameWon', empire: ALPHA });
  });

  it('is off at 0, and a dead heat goes to the higher score', () => {
    const { state, content } = newGame();
    levels(state, ALPHA, 2);
    levels(state, BETA, 2);
    expect(processTurn(state, content).state.winner).toBeNull();
    content.rules.victory.researchLevels = 12;
    colonyOf(state, BETA).population += 5;
    expect(processTurn(state, content).state.winner).toBe(BETA);
  });
});

describe('the wealth victory', () => {
  it('goes to a treasury of the set size, and to the richest if there are two', () => {
    const { state, content } = newGame();
    content.rules.victory.wealthCredits = 500;
    state.empires[ALPHA].credits = 400;
    expect(processTurn(state, content).state.winner).toBeNull();
    state.empires[ALPHA].credits = 600;
    const won = processTurn(state, content).state;
    expect([won.winner, won.victory]).toEqual([ALPHA, 'wealth']);
    state.empires[BETA].credits = 900;
    expect(processTurn(state, content).state.winner).toBe(BETA);
  });
});

describe('the score', () => {
  it('lists its causes', () => {
    const { state, content } = newGame();
    levels(state, ALPHA, 1);
    state.empires[ALPHA].members = ['sages' as MinorId, content.rules.morale.rebelRace];
    state.empires[ALPHA].credits = 250;
    content.rules.victory.score.creditsPerPoint = 100;
    expect(empireScore(state, ALPHA, content)).toEqual({
      total: 10 + 5 + 18 + 10 + 2,
      lines: [
        { source: '10 people', kind: 'flat', value: 10 },
        { source: '1 colony', kind: 'flat', value: 5 },
        { source: '6 research levels', kind: 'flat', value: 18 },
        { source: '1 member race', kind: 'flat', value: 10 },
        { source: '250 credits', kind: 'flat', value: 2 },
      ],
    });
  });

  it('settles the game once the last turn has been played, and not before', () => {
    const { state, content } = newGame();
    content.rules.victory.scoreTurn = 3;
    levels(state, BETA, 1);
    const first = processTurn(state, content).state;
    expect(first.winner).toBeNull();
    const second = processTurn(first, content).state;
    expect(second.winner).toBeNull();
    const last = processTurn(second, content).state;
    expect([last.winner, last.victory, last.turn]).toEqual([BETA, 'score', 4]);
  });

  it('gives a dead heat on the last turn to the earlier seat rather than run on', () => {
    const { state, content } = newGame();
    content.rules.victory.scoreTurn = 1;
    colonyOf(state, BETA).population = colonyOf(state, ALPHA).population;
    const done = processTurn(state, content).state;
    expect(empireScore(done, ALPHA, content).total).toBe(empireScore(done, BETA, content).total);
    expect(done.winner).toBe(ALPHA);
  });
});

describe('domination with more than two empires', () => {
  it('asks for a smaller share of the galaxy the more empires began in it', () => {
    const { content } = newGame();
    const duel = content.rules.combat.dominationPercent;
    expect(dominationShareOf(2, content)).toBe(duel);
    expect(dominationShareOf(5, content)).toBe(Math.ceil((duel * 2) / 5));
    content.rules.combat.dominationPercent = 0;
    expect(dominationShareOf(5, content)).toBe(0);
  });
});

describe('ways to win', () => {
  it('lists only what is switched on, with the empire’s own progress', () => {
    const { state, content } = newGame();
    expect(victoryPaths(state, ALPHA, content).map((p) => p.kind)).toEqual(['domination']);
    content.rules.victory.researchLevels = 60;
    content.rules.victory.wealthCredits = 9000;
    content.rules.victory.scoreTurn = 400;
    levels(state, ALPHA, 2);
    state.empires[ALPHA].credits = 123;
    const paths = victoryPaths(state, ALPHA, content);
    expect(paths.map((p) => [p.kind, p.have, p.need])).toEqual([
      ['research', 12, 60],
      ['wealth', 123, 9000],
      ['domination', 0, 1],
      ['score', empireScore(state, ALPHA, content).total, 0],
    ]);
    expect(paths[3].note).toBe('If nobody has won after turn 400, the highest score wins.');
    homeOf(state, BETA).colony!.owner = ALPHA;
    expect(victoryPaths(state, ALPHA, content)[2].have).toBe(1);
  });
});

describe('military traits', () => {
  it('an attack trait adds to every ship’s attack bonus', () => {
    const { state, content } = newGame();
    const before = combatBonuses(state, ALPHA, content).attack;
    content.factions['alpha' as FactionId].traits.attackPercent = 25;
    expect(combatBonuses(state, ALPHA, content).attack).toBe(before + 25);
    expect(combatBonuses(state, BETA, content).attack).toBe(before);
  });

  it('a support trait raises the fleet support cap', () => {
    const { state, content } = newGame();
    const before = empireSupport(state, ALPHA, content).cap;
    content.factions['alpha' as FactionId].traits.supportPercent = 50;
    expect(empireSupport(state, ALPHA, content).cap).toBe(Math.floor((before * 150) / 100));
  });
});

describe('what the AI does with all this', () => {
  const personalityOf = (content: ReturnType<typeof newGame>['content']) => content.ai.personalities['alpha' as FactionId];

  it('a thrifty power stops spending once the wealth victory is in sight', () => {
    const { state, content } = newGame();
    const home = homeOf(state, ALPHA);
    home.colony!.buildQueue = [{ kind: 'building', building: 'factory' as BuildingId, progress: 0 }];
    state.empires[ALPHA].credits = 1000;
    content.rules.victory.wealthCredits = 4000;
    const spend = () => {
      const plan = createPlanner(state, content);
      spendCredits(plan, ALPHA, content, 'develop', personalityOf(content), survey(plan.state, ALPHA, content));
      return plan.issued.map((c) => c.type);
    };
    expect(spend()).toEqual(['buyOut']);
    personalityOf(content).thrift = 25;
    expect(spend()).toEqual([]);
    personalityOf(content).thrift = 30;
    expect(spend()).toEqual(['buyOut']);
  });

  it('an eager power finds war more tempting when its navy is clearly the stronger', () => {
    const { state, content } = newGame();
    state.empires[ALPHA].knownSystems[homeOf(state, BETA).id] = BETA;
    addFleet(state, content, ALPHA, homeOf(state, ALPHA).sector, ['frigate', 'frigate', 'frigate']);
    const war = () => scorePostures(state, ALPHA, content, survey(state, ALPHA, content), personalityOf(content)).war;
    const calm = war();
    personalityOf(content).earlyWar = 80;
    expect(war()).toBe(calm + 80);
    // With no navy to speak of there is nothing to be eager with.
    for (const id of Object.keys(state.fleets) as (keyof typeof state.fleets)[]) delete state.fleets[id];
    expect(war()).toBeLessThan(calm);
  });

  it('answers a fleet bearing down on a colony, but not a guard sitting over its own', () => {
    const { state, content } = newGame();
    content.ai.defence = { alarmRange: 2, responseRange: 5 };
    const home = homeOf(state, ALPHA);
    const near = { x: home.sector.x + (home.sector.x + 1 < 8 ? 1 : -1), y: home.sector.y };
    const raiders = addFleet(state, content, BETA, near, ['frigate']);
    expect(threatenedColonies(state, ALPHA, content)).toEqual([]); // not at war
    state.wars[warKey(ALPHA, BETA)] = 1;
    expect(threatenedColonies(state, ALPHA, content).map((s) => s.id)).toEqual([home.id]);

    const guard = addFleet(state, content, ALPHA, { x: home.sector.x, y: home.sector.y === 0 ? 3 : home.sector.y - 3 }, ['frigate']);
    expect(colonyToDefend(guard, threatenedColonies(state, ALPHA, content), content)?.id).toBe(home.id);
    content.ai.defence.responseRange = 2;
    expect(colonyToDefend(guard, threatenedColonies(state, ALPHA, content), content)).toBeUndefined();

    // Scouts and fleets parked over their own colony are not a threat.
    content.ai.defence.responseRange = 5;
    raiders.ships[0].hull = 'scout' as never;
    expect(threatenedColonies(state, ALPHA, content)).toEqual([]);
    raiders.ships[0].hull = 'frigate' as never;
    const theirs = Object.values(state.systems).find((s) => !s.colony && !s.minor)!;
    theirs.sector = { ...near };
    theirs.colony = { ...structuredClone(homeOf(state, BETA).colony!) };
    expect(threatenedColonies(state, ALPHA, content)).toEqual([]);
    content.ai.defence.responseRange = 0;
    theirs.colony = null;
    expect(threatenedColonies(state, ALPHA, content)).toEqual([]);
  });

  it('leans its research toward a field a courted minor race admires, until it gets there', () => {
    const { state, content } = newGame(5);
    const system = Object.values(state.systems).find((s) => !s.colony && !(s.id in state.empires[ALPHA].knownSystems))!;
    const home = homeOf(state, ALPHA);
    system.sector = { x: home.sector.x + (home.sector.x + 1 < 8 ? 1 : -1), y: home.sector.y };
    system.planets = [{ type: 'terran', maxPopulation: 12, foodBonus: 0, energyBonus: 0 }];
    system.minor = { race: 'sages' as MinorId, population: 8, attitude: { [ALPHA]: 30 }, leader: null, leadTurns: 0 };
    state.empires[ALPHA].knownSystems[system.id] = null;
    const personality = personalityOf(content);
    const picture = survey(state, ALPHA, content);
    expect(picture.minors.map((s) => s.id)).toEqual([system.id]);

    expect(admiredFields(state, picture, ALPHA, content, personality)).toEqual(['computing']);
    const plain = setTargets('develop', picture, personality).research;
    const leaning = setTargets('develop', picture, personality, 0, ['computing']).research;
    expect(leaning.computing).toBeGreaterThan(plain.computing);
    expect(FIELDS.reduce((sum, f) => sum + leaning[f], 0)).toBe(100);

    state.empires[ALPHA].research.levels.computing = content.minors['sages' as MinorId].techLevel;
    expect(admiredFields(state, picture, ALPHA, content, personality)).toEqual([]);
  });
});

describe('the balance report', () => {
  const game = (seed: number, winner: string | null, victory: GameState['victory'], turns: number): BalanceGame => ({ seed, winner, victory, turns, factions: {} });

  it('counts wins by power and kind, and a game settled on score as a stall', () => {
    const summary = summarise(
      [game(1, 'alpha', 'research', 200), game(2, 'alpha', 'domination', 150), game(3, 'beta', 'score', 400), game(4, null, null, 400), game(5, 'beta', 'wealth', 210)],
      ['alpha', 'beta'],
    );
    expect(summary).toEqual({
      games: 5,
      stalls: 2,
      wins: { alpha: 2, beta: 2 },
      kinds: { alpha: { research: 1, domination: 1 }, beta: { score: 1, wealth: 1 } },
      medianTurns: 210,
    });
  });

  it('applies trial numbers to the content, and refuses a path that is not there', () => {
    const { content } = newGame();
    tweak(content, 'rules.victory.wealthCredits=777;factions.alpha.traits.attackPercent=5');
    expect(content.rules.victory.wealthCredits).toBe(777);
    expect(content.factions['alpha' as FactionId].traits.attackPercent).toBe(5);
    expect(() => tweak(content, 'rules.victory.nothing=1')).toThrow('--tweak: nothing at rules.victory.nothing');
  });
});
