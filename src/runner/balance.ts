import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../data';
import { coloniesOf, empireScore, sortedKeys, type Content, type GameState } from '../sim';
import { runGame } from './runGame';

/**
 * The balance report: many all-AI games with every power in each, spread over
 * the machine's cores.
 *   npm run balance -- --games 200 --turns 400 --preset medium --jobs 10 --seed 1
 * A game "stalls" if nobody has won before the last turn, which the score then settles.
 */
export interface BalanceGame {
  seed: number;
  /** Faction that won, or null if the turn limit was reached with no winner. */
  winner: string | null;
  victory: GameState['victory'];
  turns: number;
  /** Final standing per faction. */
  factions: Record<string, { colonies: number; score: number; eliminated: boolean }>;
}

/** Plays one game. The seat order rotates with the seed so no power always starts in the same place. */
export function playBalanceGame(content: Content, seed: number, turns: number, preset: string, factions: string[]): BalanceGame {
  const shift = seed % factions.length;
  const seated = [...factions.slice(shift), ...factions.slice(0, shift)];
  const state = runGame({ content, seed, turns, preset, factions: seated, verify: false });
  const standing: BalanceGame['factions'] = {};
  for (const id of sortedKeys(state.empires)) {
    const empire = state.empires[id];
    standing[empire.faction] = { colonies: coloniesOf(state, id).length, score: empireScore(state, id, content).total, eliminated: empire.eliminated };
  }
  return {
    seed,
    winner: state.winner === null ? null : state.empires[state.winner].faction,
    victory: state.victory,
    turns: state.turn - 1,
    factions: standing,
  };
}

export interface BalanceSummary {
  games: number;
  /** Games nobody won outright: no winner at the limit, or settled on score. */
  stalls: number;
  wins: Record<string, number>;
  /** Wins by faction and kind of victory. */
  kinds: Record<string, Record<string, number>>;
  medianTurns: number;
}

export function summarise(games: BalanceGame[], factions: string[]): BalanceSummary {
  const wins: Record<string, number> = {};
  const kinds: Record<string, Record<string, number>> = {};
  for (const f of factions) {
    wins[f] = 0;
    kinds[f] = {};
  }
  let stalls = 0;
  for (const game of games) {
    if (game.winner === null || game.victory === 'score') stalls += 1;
    if (game.winner === null) continue;
    wins[game.winner] += 1;
    const kind = game.victory ?? 'none';
    kinds[game.winner][kind] = (kinds[game.winner][kind] ?? 0) + 1;
  }
  const lengths = games.map((g) => g.turns).sort((a, b) => a - b);
  return { games: games.length, stalls, wins, kinds, medianTurns: lengths[Math.floor(lengths.length / 2)] ?? 0 };
}

export function reportText(summary: BalanceSummary, content: Content): string {
  const lines = [`${summary.games} games, median length ${summary.medianTurns} turns, stalled ${summary.stalls} (${percent(summary.stalls, summary.games)})`];
  for (const faction of Object.keys(summary.wins)) {
    const kinds = Object.entries(summary.kinds[faction])
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => `${kind} ${n}`)
      .join(', ');
    lines.push(`  ${(content.factions[faction as keyof typeof content.factions]?.name ?? faction).padEnd(18)} ${String(summary.wins[faction]).padStart(4)}  ${percent(summary.wins[faction], summary.games).padStart(6)}   ${kinds}`);
  }
  return lines.join('\n');
}

const percent = (n: number, of: number): string => (of === 0 ? '0%' : `${((n * 100) / of).toFixed(1)}%`);

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

/**
 * Applies trial changes to the content without editing the data files, for
 * tuning: `--tweak "rules.victory.wealthCredits=30000;factions.orrin.traits.creditsPercent=25"`.
 */
export function tweak(content: Content, spec: string | undefined): Content {
  for (const part of (spec ?? '').split(';').filter(Boolean)) {
    const [path, value] = part.split('=');
    const keys = path.trim().split('.');
    let target = content as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) {
      if (typeof target[key] !== 'object' || target[key] === null) throw new Error(`--tweak: nothing at ${path}`);
      target = target[key] as Record<string, unknown>;
    }
    const last = keys[keys.length - 1];
    if (!(last in target)) throw new Error(`--tweak: nothing at ${path}`);
    target[last] = JSON.parse(value);
  }
  return content;
}

/** A worker plays its share of the seeds and prints one JSON line per game. */
function work(args: Record<string, string>): void {
  const content = tweak(loadContent(), args.tweak);
  const factions = args.factions.split(',');
  for (const seed of args.seeds.split(',').map(Number)) {
    console.log(JSON.stringify(playBalanceGame(content, seed, Number(args.turns), args.preset, factions)));
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.seeds) return work(args);

  const content = tweak(loadContent(), args.tweak);
  const games = Number(args.games ?? 100);
  const turns = String(args.turns ?? 400);
  const preset = args.preset ?? 'medium';
  const first = Number(args.seed ?? 1);
  const factions = args.factions ?? sortedKeys(content.factions).join(',');
  const jobs = Math.max(1, Math.min(games, Number(args.jobs ?? Math.max(1, cpus().length - 2))));
  const started = Date.now();

  // Deal the seeds round the workers so each gets a mix of long and short games.
  const hands: number[][] = Array.from({ length: jobs }, () => []);
  for (let i = 0; i < games; i++) hands[i % jobs].push(first + i);
  const results: BalanceGame[] = [];
  await Promise.all(
    hands.map(
      (seeds) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ['--import', 'tsx', fileURLToPath(import.meta.url), '--seeds', seeds.join(','), '--turns', turns, '--preset', preset, '--factions', factions, ...(args.tweak ? ['--tweak', args.tweak] : [])],
            { stdio: ['ignore', 'pipe', 'inherit'] },
          );
          let buffer = '';
          child.stdout.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop()!;
            for (const line of lines) if (line.trim()) results.push(JSON.parse(line) as BalanceGame);
            if (process.stderr.isTTY) process.stderr.write(`\r${results.length} / ${games}`);
          });
          child.on('error', reject);
          child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`A worker stopped with code ${code}`))));
        }),
    ),
  );
  if (process.stderr.isTTY) process.stderr.write('\r');
  results.sort((a, b) => a.seed - b.seed);
  if (args.tweak) console.log(`tweak: ${args.tweak}`);
  console.log(`${preset} galaxy, up to ${turns} turns, seeds ${first} to ${first + games - 1}, ${jobs} workers, ${Math.round((Date.now() - started) / 1000)} s`);
  console.log(reportText(summarise(results, factions.split(',')), content));
  if (args.out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(args.out, JSON.stringify(results));
    console.log(`Games written to ${args.out}`);
  }
}

// Run only as a script, not when imported by tests.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('runner/balance.ts')) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
