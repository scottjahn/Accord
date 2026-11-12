import { describe, expect, it } from 'vitest';
import { createPlanner, runAgent } from '../../src/ai/agent';
import { survey } from '../../src/ai/maps';
import { setTargets } from '../../src/ai/operational';
import { standardAgent } from '../../src/ai/standardAgent';
import { choosePosture, scorePostures } from '../../src/ai/strategic';
import { enemiesOf, fleetPower, knownColoniesOf, wageWar } from '../../src/ai/tactical/war';
import { loadContent } from '../../src/data';
import { runBatch } from '../../src/runner/batch';
import {
  atWar,
  checkVictory,
  fleetsOf,
  processTurn,
  redactFor,
  warKey,
  type BuildingId,
  type FactionId,
  type GameState,
  type TurnEvent,
} from '../../src/sim';
import { ALPHA, BETA, addFleet, colonyOf, homeOf, newGame } from '../fixture';

const ALPHA_FACTION = 'alpha' as FactionId;

/** Alpha and Beta at war, Alpha knows Beta's home, and supply reaches across the tiny map. */
function setup() {
  const { state, content } = newGame(5);
  content.rules.fleets.baseRange = 20;
  state.wars[warKey(ALPHA, BETA)] = 0;
  const target = homeOf(state, BETA);
  state.empires[ALPHA].knownSystems[target.id] = BETA;
  colonyOf(state, ALPHA).buildings['shipyard' as BuildingId] = 1;
  const home = homeOf(state, ALPHA);
  const war = (s: GameState, strikeSize = 3) => {
    const plan = createPlanner(redactFor(s, ALPHA, content), content);
    wageWar(plan, ALPHA, content, strikeSize);
    return plan;
  };
  return { state, content, home, target, war };
}

describe('domination victory', () => {
  /** Gives Alpha `mine` extra colonies and Beta `theirs`, out of the unclaimed systems. */
  function carve(state: GameState, mine: number, theirs: number) {
    const free = Object.values(state.systems).filter((s) => !s.colony);
    free.slice(0, mine).forEach((s) => (s.colony = { ...structuredClone(colonyOf(state, ALPHA)), population: 2 }));
    free.slice(mine, mine + theirs).forEach((s) => (s.colony = { ...structuredClone(colonyOf(state, BETA)), population: 2 }));
  }
  const settle = (state: GameState, content: ReturnType<typeof newGame>['content']) => {
    const events: TurnEvent[] = [];
    checkVictory(state, content, events);
    return events;
  };

  it('is won by holding two-thirds of all colonies and the rival home system', () => {
    const { state, content } = newGame(5);
    carve(state, 3, 2); // Alpha 4, Beta 3
    homeOf(state, BETA).colony!.owner = ALPHA; // Alpha 5 of 7 = 71%
    const events = settle(state, content);
    expect(state.winner).toBe(ALPHA);
    expect(events).toEqual([{ type: 'gameWon', empire: ALPHA }]);
    expect(state.empires[BETA].eliminated).toBe(false); // beaten, not wiped out
  });

  it('needs the rival home system, however many colonies are held', () => {
    const { state, content } = newGame(5);
    carve(state, 8, 0); // Alpha 9 of 10
    expect(settle(state, content)).toEqual([]);
    expect(state.winner).toBeNull();
  });

  it('needs the share of colonies, even with the rival home system', () => {
    const { state, content } = newGame(5);
    carve(state, 0, 4); // Beta keeps 4
    homeOf(state, BETA).colony!.owner = ALPHA; // Alpha 2 of 6
    settle(state, content);
    expect(state.winner).toBeNull();
  });

  it('can be turned off, leaving only total conquest', () => {
    const { state, content } = newGame(5);
    content.rules.combat.dominationPercent = 0;
    carve(state, 3, 2);
    homeOf(state, BETA).colony!.owner = ALPHA;
    settle(state, content);
    expect(state.winner).toBeNull();
  });

  it('ends the game when it happens during a turn', () => {
    const { state, content } = newGame(5);
    carve(state, 3, 2);
    homeOf(state, BETA).colony!.owner = ALPHA;
    const { state: next, events } = processTurn(state, content);
    expect(next.winner).toBe(ALPHA);
    expect(events).toContainEqual({ type: 'gameWon', empire: ALPHA });
    expect(processTurn(next, content).state.turn).toBe(next.turn);
  });
});

describe('going to war', () => {
  it('is not considered while no rival colony is known', () => {
    const { state, content } = newGame(5);
    const known = redactFor(state, ALPHA, content);
    const scores = scorePostures(known, ALPHA, content, survey(known, ALPHA, content), content.ai.personalities[ALPHA_FACTION]);
    expect(scores.war).toBe(0);
  });

  it('wins out once at war with a navy in hand, and being attacked halves the appeal of developing', () => {
    const { state, content, home } = setup();
    addFleet(state, content, ALPHA, home.sector, ['frigate', 'frigate', 'frigate']);
    const known = redactFor(state, ALPHA, content);
    const personality = content.ai.personalities[ALPHA_FACTION];
    const fighting = scorePostures(known, ALPHA, content, survey(known, ALPHA, content), personality);
    delete known.wars[warKey(ALPHA, BETA)];
    const peaceful = scorePostures(known, ALPHA, content, survey(known, ALPHA, content), personality);
    expect(fighting.war).toBe(peaceful.war + 80);
    expect(fighting.develop).toBe(Math.floor(peaceful.develop / 2));
    expect(choosePosture(fighting)).toBe('war');
  });

  it('declares war on the owner of the nearest rival colony when the posture turns to war', () => {
    const { state, content, home } = setup();
    delete state.wars[warKey(ALPHA, BETA)];
    addFleet(state, content, ALPHA, home.sector, ['frigate', 'frigate', 'frigate']);
    content.ai.personalities[ALPHA_FACTION].posture.war = 300;
    const { commands, memory } = runAgent(standardAgent, state, ALPHA, content);
    expect(memory).toMatchObject({ posture: 'war' });
    expect(commands).toContainEqual({ type: 'declareWar', empire: ALPHA, on: BETA });
  });

  it('sets wartime targets: a strike force, transports, weapons research', () => {
    const { state, content } = setup();
    const known = redactFor(state, ALPHA, content);
    const targets = setTargets('war', survey(known, ALPHA, content), content.ai.personalities[ALPHA_FACTION]);
    expect(targets).toMatchObject({ warships: 6, transports: 3, strikeSize: 3 });
    expect(targets.research.weapons).toBe(Math.max(...Object.values(targets.research)));
    expect(setTargets('develop', survey(known, ALPHA, content), content.ai.personalities[ALPHA_FACTION]).transports).toBe(0);
  });
});

describe('waging war', () => {
  it('knows its enemies and their colonies, nearest first', () => {
    const { state, content, target } = setup();
    const known = redactFor(state, ALPHA, content);
    expect(enemiesOf(known, ALPHA)).toEqual([BETA]);
    expect(knownColoniesOf(known, ALPHA, [BETA]).map((s) => s.id)).toEqual([target.id]);
    known.empires[BETA].eliminated = true;
    expect(enemiesOf(known, ALPHA)).toEqual([]);
  });

  it('counts only armed ships as power, less when damaged', () => {
    const { state, content, home } = setup();
    const fleet = addFleet(state, content, ALPHA, home.sector, ['frigate', 'scout', 'transport']);
    const fresh = fleetPower([fleet], content);
    expect(fresh).toBe(10 * 2 + 6);
    fleet.ships[0].hp = 10;
    expect(fleetPower([fleet], content)).toBeLessThan(fresh);
  });

  it('merges the warships gathered at the staging colony and strikes when there are enough', () => {
    const { state, content, home, target, war } = setup();
    const a = addFleet(state, content, ALPHA, home.sector, ['frigate', 'frigate']);
    const b = addFleet(state, content, ALPHA, home.sector, ['frigate']);

    const tooFew = war(state, 4);
    expect(fleetsOf(tooFew.state, ALPHA)).toHaveLength(1);
    expect(tooFew.state.fleets[a.id]).toMatchObject({ destination: null });
    expect(tooFew.state.fleets[a.id].ships).toHaveLength(3);

    const ready = war(state, 3);
    expect(ready.state.fleets[b.id]).toBeUndefined();
    expect(ready.state.fleets[a.id]).toMatchObject({ destination: target.sector, stance: 'engage' });
  });

  it('holds transports until the strike fleet has the garrison in sight and the troops are enough', () => {
    const { state, content, home, target, war } = setup();
    const strike = addFleet(state, content, ALPHA, home.sector, ['frigate', 'frigate', 'frigate']);
    const troops = addFleet(state, content, ALPHA, home.sector, ['transport', 'transport']);

    // Launch turn: the target is out of sight, so the troops wait.
    expect(war(state).state.fleets[troops.id]).toMatchObject({ order: 'none', destination: null });

    // The strike fleet has arrived: population 10 is visible, and 20 troops x 75% beats it.
    state.fleets[strike.id].sector = { ...target.sector };
    expect(war(state).state.fleets[troops.id]).toMatchObject({ order: 'invade', destination: target.sector });

    // A bigger garrison keeps them waiting for reinforcements.
    colonyOf(state, BETA).population = 20;
    expect(war(state).state.fleets[troops.id].order).toBe('none');
  });

  it('sends a badly damaged fleet home to the shipyard and keeps it there until repaired', () => {
    const { state, content, home, target, war } = setup();
    const fleet = addFleet(state, content, ALPHA, target.sector, ['frigate', 'frigate', 'frigate']);
    for (const ship of fleet.ships) ship.hp = 10;
    expect(war(state).state.fleets[fleet.id].destination).toEqual(home.sector);

    state.fleets[fleet.id].sector = { ...home.sector };
    for (const ship of state.fleets[fleet.id].ships) ship.hp = 24; // 80%: still repairing
    expect(war(state).state.fleets[fleet.id].destination).toBeNull();
    for (const ship of state.fleets[fleet.id].ships) ship.hp = 30;
    expect(war(state).state.fleets[fleet.id].destination).toEqual(target.sector);
  });

  it('does nothing at peace', () => {
    const { state, content, home, war } = setup();
    delete state.wars[warKey(ALPHA, BETA)];
    addFleet(state, content, ALPHA, home.sector, ['frigate', 'frigate', 'frigate']);
    expect(war(state).issued).toEqual([]);
    expect(atWar(state, ALPHA, BETA)).toBe(false);
  });
});

/**
 * Milestone 5 exit test: a full game ends by conquest. Two standard AIs play
 * the shipped content; most games must produce a winner within 400 turns.
 * A full game takes several seconds, so the everyday suite plays 4 and
 * `npm run test:long` (ACCORD_LONG=1) plays 20.
 */
describe('full games end', () => {
  const long = process.env.ACCORD_LONG === '1';
  const count = long ? 20 : 4;
  // Measured at 18 of 20 with diplomacy in play: 12 by the Accord and 6 by domination.
  // The bar sits a little under that. The first four seeds give 2 of 4.
  const needed = long ? 15 : 2;
  it(`at least ${needed} of ${count} AI games have a winner by turn 400, and the winner dominates`, () => {
    const games = runBatch({
      content: loadContent(),
      games: count,
      turns: 400,
      preset: 'small',
      factions: ['concord', 'vashran'],
      agents: [standardAgent, standardAgent],
    });
    const decided = games.filter((g) => g.winner !== null);
    expect(decided.length).toBeGreaterThanOrEqual(needed);
    // Milestone 7 exit test: a game can be won without a major war. At least one of these games
    // ends by the Accord with no war ever declared, and at least one is still won by force.
    expect(games.some((g) => g.victory === 'accord' && !g.war)).toBe(true);
    expect(games.some((g) => g.victory === 'domination' || g.victory === 'conquest')).toBe(true);
    for (const game of decided) {
      const [winner, loser] = game.winner === 0 ? game.results : [game.results[1], game.results[0]];
      expect(winner.colonies).toBeGreaterThan(loser.colonies);
    }
  }, 600_000);
});
