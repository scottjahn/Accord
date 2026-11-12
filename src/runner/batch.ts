import { baselineAsAgent, type Agent } from '../ai/agent';
import { standardAgent } from '../ai/standardAgent';
import { loadContent } from '../data';
import { FIELDS, coloniesOf, fleetsOf, sortedKeys, type Content, type EmpireId, type GameState } from '../sim';
import { runGame } from './runGame';

export const AGENTS: Record<string, Agent> = { standard: standardAgent, baseline: baselineAsAgent };

export interface Metrics {
  colonies: number;
  population: number;
  ships: number;
  research: number;
}

export function measure(state: GameState, empireId: EmpireId): Metrics {
  const colonies = coloniesOf(state, empireId);
  return {
    colonies: colonies.length,
    population: colonies.reduce((sum, s) => sum + s.colony!.population, 0),
    ships: fleetsOf(state, empireId).reduce((sum, f) => sum + f.ships.length, 0),
    research: FIELDS.reduce((sum, f) => sum + state.empires[empireId].research.levels[f], 0),
  };
}

export interface BatchOptions {
  content: Content;
  games: number;
  turns: number;
  preset: string;
  /** Two factions; the agents swap factions every other game so neither is favoured. */
  factions: [string, string];
  agents: [Agent, Agent];
  firstSeed?: number;
}

export interface BatchGame {
  seed: number;
  /** Metrics at the final turn, indexed like `agents` (not by seat). */
  results: [Metrics, Metrics];
  /** Which agent won by conquest (index into `agents`), or null if nobody had by the turn limit. */
  winner: 0 | 1 | null;
  /** Turns played. */
  turns: number;
}

/** Plays many two-player games headless and reports how each agent did. */
export function runBatch(options: BatchOptions): BatchGame[] {
  const games: BatchGame[] = [];
  for (let i = 0; i < options.games; i++) {
    const seed = (options.firstSeed ?? 1) + i;
    const swapped = i % 2 === 1;
    const agents = swapped ? [options.agents[1], options.agents[0]] : options.agents;
    const state = runGame({ ...options, seed, agents, verify: false });
    const seats = sortedKeys(state.empires);
    const [first, second] = seats.map((id) => measure(state, id));
    const seat = state.winner === null ? null : seats.indexOf(state.winner);
    games.push({
      seed,
      results: swapped ? [second, first] : [first, second],
      winner: seat === null ? null : ((swapped ? 1 - seat : seat) as 0 | 1),
      turns: state.turn - 1,
    });
  }
  return games;
}

/** Games in which agent 0 ended at least level with agent 1 on a metric. */
export function aheadCount(games: BatchGame[], metric: keyof Metrics): number {
  return games.filter((g) => g.results[0][metric] >= g.results[1][metric]).length;
}

function main(): void {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  const names: [string, string] = [args.a ?? 'standard', args.b ?? 'baseline'];
  for (const name of names) if (!AGENTS[name]) throw new Error(`Unknown agent "${name}". Choose from ${Object.keys(AGENTS).join(', ')}`);
  const games = Number(args.games ?? 20);
  const turns = Number(args.turns ?? 100);

  const results = runBatch({
    content: loadContent(),
    games,
    turns,
    preset: args.preset ?? 'small',
    factions: ['concord', 'vashran'],
    agents: [AGENTS[names[0]], AGENTS[names[1]]],
    firstSeed: Number(args.seed ?? 1),
  });

  const metrics: (keyof Metrics)[] = ['colonies', 'population', 'ships', 'research'];
  const average = (agent: 0 | 1, metric: keyof Metrics) =>
    (results.reduce((sum, g) => sum + g.results[agent][metric], 0) / results.length).toFixed(1);
  console.log(`${games} games, ${turns} turns, ${names[0]} (A) vs ${names[1]} (B), factions swapped every other game`);
  console.log('metric       avg A     avg B     A level or ahead');
  for (const metric of metrics) {
    console.log(
      `${metric.padEnd(12)} ${average(0, metric).padStart(6)}    ${average(1, metric).padStart(6)}    ${aheadCount(results, metric)} of ${games}`,
    );
  }
  const decided = results.filter((g) => g.winner !== null);
  const lengths = decided.map((g) => g.turns).sort((a, b) => a - b);
  console.log(
    `ended by conquest: ${decided.length} of ${games}` +
      (decided.length > 0
        ? ` (A won ${decided.filter((g) => g.winner === 0).length}, B won ${decided.filter((g) => g.winner === 1).length}; ` +
          `turns ${lengths[0]} to ${lengths[lengths.length - 1]}, median ${lengths[Math.floor(lengths.length / 2)]})`
        : ''),
  );
}

// Run only as a script, not when imported by tests.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('runner/batch.ts')) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
