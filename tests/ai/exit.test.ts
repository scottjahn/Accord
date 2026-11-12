import { describe, expect, it } from 'vitest';
import { baselineAsAgent, type Agent } from '../../src/ai/agent';
import { standardAgent } from '../../src/ai/standardAgent';
import { loadContent } from '../../src/data';
import { createSession, startNewGame } from '../../src/game/session';
import { playTurn } from '../../src/game/turn';
import { aheadCount, runBatch } from '../../src/runner/batch';
import { runGame } from '../../src/runner/runGame';
import {
  coloniesOf,
  createGame,
  deserialize,
  fleetsOf,
  getOutputs,
  hashState,
  serialize,
  sortedKeys,
  submitCommands,
  validateCommand,
  type Command,
  type EmpireId,
  type GameState,
} from '../../src/sim';
import { fixtureContent } from '../fixture';

const content = loadContent();
const factions: [string, string] = ['concord', 'vashran'];

/**
 * Milestone 4 exit test: the AI expands as fast as you do. There is no human in
 * a headless run, so the yardstick is the earlier placeholder agent, which
 * settles greedily: the AI must at least match it in most games.
 */
describe('the standard AI against the baseline', () => {
  it('matches or beats it on colonies and population at turn 100 in at least 16 of 20 games', () => {
    const games = runBatch({ content, games: 20, turns: 100, preset: 'small', factions, agents: [standardAgent, baselineAsAgent] });
    expect(aheadCount(games, 'colonies')).toBeGreaterThanOrEqual(16);
    expect(aheadCount(games, 'population')).toBeGreaterThanOrEqual(16);
    for (const game of games) expect(game.results[0].colonies).toBeGreaterThanOrEqual(4);
  });
});

describe('the standard AI never stalls', () => {
  it.each([1, 2])('seed %i: no idle colony or settler when there is something legal to do', (seed) => {
    const problems: string[] = [];
    /** Runs the AI, then checks the state its commands leave behind. */
    const watched: Agent = (known, empire, c, memory) => {
      const result = standardAgent(known, empire, c, memory);
      const after = submitCommands(known, result.commands, c);
      if (!after.ok) throw new Error(after.error.message);
      const s = after.value;

      for (const system of coloniesOf(s, empire)) {
        if (system.colony!.buildQueue.length > 0) continue;
        const options: Command[] = [
          ...sortedKeys(c.buildings).map((building): Command => ({ type: 'enqueueBuild', empire, system: system.id, building })),
          ...sortedKeys(c.hulls).map((hull): Command => ({ type: 'enqueueShip', empire, system: system.id, hull })),
        ];
        // Ships are only wanted up to the AI's targets, so judge idleness by buildings.
        if (options.some((o) => o.type === 'enqueueBuild' && !validateCommand(s, o, c))) {
          problems.push(`turn ${s.turn}: ${system.name} has an empty queue but could build`);
        }
      }
      for (const fleet of fleetsOf(s, empire)) {
        if (fleet.destination || fleet.order !== 'none') continue;
        if (!fleet.ships.some((ship) => c.hulls[ship.hull].role === 'colony')) continue;
        const target = sortedKeys(s.empires[empire].knownSystems).find(
          (id) => !validateCommand(s, { type: 'coloniseSystem', empire, fleet: fleet.id, system: id }, c),
        );
        if (target) problems.push(`turn ${s.turn}: a colony ship is idle but could settle ${s.systems[target].name}`);
      }
      return result;
    };
    runGame({ content, seed, turns: 100, preset: 'small', factions, agents: [watched, watched] });
    expect(problems).toEqual([]);
  });
});

describe('AI memory and determinism', () => {
  it('stores each AI empire memory in the state and leaves the human none', () => {
    const state = startNewGame(content, { seed: 3, preset: 'small', faction: 'concord' });
    const next = playTurn(state, content).state;
    const [human, ai] = sortedKeys(next.empires);
    expect(next.agentMemory[ai]).toMatchObject({ postureTurn: 1 });
    expect(human in next.agentMemory).toBe(false);
  });

  it('resumes a saved game with the same plans', () => {
    const play = (state: GameState, turns: number) => {
      let s = state;
      for (let i = 0; i < turns; i++) s = playTurn(s, content).state;
      return s;
    };
    const start = createGame(
      { seed: 9, galaxyPreset: 'small', empires: factions.map((faction) => ({ faction, controller: 'ai' as const })) },
      content,
    );
    const straight = play(start, 60);
    const loaded = deserialize(serialize(play(start, 25)));
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(hashState(play(loaded.value, 35))).toBe(hashState(straight));
  });

  it('plays the same game twice from the same seed', () => {
    const run = () => runGame({ content, seed: 4, turns: 80, preset: 'small', factions });
    expect(hashState(run())).toBe(hashState(run()));
  });

  it('gives the two powers different research priorities', () => {
    const state = runGame({ content, seed: 2, turns: 1, preset: 'small', factions });
    const [concord, vashran] = sortedKeys(state.empires).map((id) => state.empires[id].research.allocation);
    expect(concord).not.toEqual(vashran);
    expect(vashran.weapons).toBeGreaterThan(concord.weapons);
    expect(concord.computing).toBeGreaterThan(vashran.computing);
  });
});

describe('difficulty', () => {
  const fixture = fixtureContent();
  const game = (difficulty?: 'easy' | 'normal' | 'hard') =>
    startNewGame(fixture, { seed: 3, preset: 'tiny', faction: 'alpha', difficulty });
  const homeOutputs = (state: GameState, empire: EmpireId) => getOutputs(state, state.empires[empire].homeSystem, fixture);
  const [HUMAN, AI] = ['emp-1', 'emp-2'] as EmpireId[];

  it('defaults to normal, which changes nothing', () => {
    const state = game();
    expect(state.difficulty).toBe('normal');
    expect(homeOutputs(state, AI).food.lines.some((l) => l.source.startsWith('Difficulty'))).toBe(false);
  });

  it('adds a visible output modifier to AI empires only', () => {
    const normal = homeOutputs(game('normal'), AI).food.total;
    const hard = game('hard');
    const food = homeOutputs(hard, AI).food;
    expect(food.lines).toContainEqual({ source: 'Difficulty (hard)', kind: 'percent', value: 25 });
    expect(food.total).toBeGreaterThan(normal);
    expect(homeOutputs(hard, HUMAN).food.lines.some((l) => l.source.startsWith('Difficulty'))).toBe(false);

    const easy = homeOutputs(game('easy'), AI).food;
    expect(easy.lines).toContainEqual({ source: 'Difficulty (easy)', kind: 'percent', value: -20 });
    expect(easy.total).toBeLessThan(normal);
  });

  it('survives save and load and rejects unknown levels', () => {
    const session = createSession(fixture, game('hard'));
    const loaded = deserialize(session.exportSave());
    expect(loaded.ok && loaded.value.difficulty).toBe('hard');
    expect(() => createGame({ seed: 1, galaxyPreset: 'tiny', empires: [{ faction: 'alpha', controller: 'ai' }], difficulty: 'brutal' as never }, fixture)).toThrow(/difficulty/);
    const broken = JSON.parse(session.exportSave());
    delete broken.difficulty;
    expect(deserialize(JSON.stringify(broken)).ok).toBe(false);
  });

  it('lets a hard AI out-grow a normal one from the same start', () => {
    const run = (difficulty: 'normal' | 'hard') => {
      const state = runGame({ content, seed: 6, turns: 80, preset: 'small', factions, difficulty });
      return sortedKeys(state.empires).reduce((sum, id) => sum + coloniesOf(state, id).reduce((n, s) => n + s.colony!.population, 0), 0);
    };
    expect(run('hard')).toBeGreaterThan(run('normal'));
  });
});
