import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadContent } from '../data';
import { FIELDS, eraOf, fleetsOf, getOutputs, hashState, serialize, sortedKeys, type Content, type GameState } from '../sim';
import { runGame } from './runGame';

/**
 * Headless runner.
 *   npm run headless -- --seed 1 --turns 500 --preset small --factions concord,vashran --out saves/run.json
 */
function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}"`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    args[arg.slice(2)] = value;
    i++;
  }
  return args;
}

function intArg(args: Record<string, string>, name: string, fallback: number): number {
  if (!(name in args)) return fallback;
  const n = Number(args[name]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number >= 0`);
  return n;
}

function summarise(state: GameState, content: Content): string {
  const lines = [`Turn ${state.turn}  hash ${hashState(state)}`];
  for (const id of sortedKeys(state.empires)) {
    const empire = state.empires[id];
    const owned = sortedKeys(state.systems).filter((s) => state.systems[s].colony?.owner === id);
    const population = owned.reduce((sum, s) => sum + state.systems[s].colony!.population, 0);
    const buildings = owned.reduce(
      (sum, s) => sum + Object.values(state.systems[s].colony!.buildings).reduce((a, b) => a + b, 0),
      0,
    );
    const home = getOutputs(state, empire.homeSystem, content);
    const levels = FIELDS.map((f) => empire.research.levels[f]).join('/');
    const ships = fleetsOf(state, id).reduce((sum, f) => sum + f.ships.length, 0);
    lines.push(
      `  ${content.factions[empire.faction].name.padEnd(18)} systems ${owned.length}  pop ${population}  buildings ${buildings}` +
        `  ships ${ships}  era ${eraOf(empire.research, content)} (${levels})  intel ${empire.intelPool}` +
        `  home F${home.food.total} I${home.industry.total} E${home.energy.total} N${home.intel.total} R${home.research.total}`,
    );
  }
  return lines.join('\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const content = loadContent();
  const seed = intArg(args, 'seed', 1);
  const turns = intArg(args, 'turns', 500);
  const preset = args.preset ?? 'small';
  const factions = (args.factions ?? 'concord,vashran').split(',');

  console.log(`Accord headless: seed ${seed}, ${turns} turns, preset ${preset}, factions ${factions.join(' vs ')}`);
  const started = Date.now();
  const final = runGame({
    content,
    seed,
    turns,
    preset,
    factions,
    onTurn: (state) => {
      if ((state.turn - 1) % 100 === 0 && state.turn - 1 < turns) console.log(summarise(state, content));
    },
  });
  console.log(summarise(final, content));
  console.log(`Completed ${turns} turns in ${Date.now() - started} ms with no errors.`);

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, serialize(final));
    console.log(`Saved to ${args.out}`);
  }
}

try {
  main();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
