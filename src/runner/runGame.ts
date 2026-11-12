import type { Agent } from '../ai/agent';
import { standardAgent } from '../ai/standardAgent';
import { playTurn } from '../game/turn';
import { checkInvariants, createGame, sortedKeys, type Content, type Difficulty, type GameState, type TurnEvent } from '../sim';

export interface RunOptions {
  content: Content;
  seed: number;
  turns: number;
  preset: string;
  /** One AI empire per faction id. */
  factions: string[];
  /** The agent for each empire, in the same order as `factions`. Defaults to the standard AI. */
  agents?: Agent[];
  difficulty?: Difficulty;
  /** Check state invariants after every turn and throw on the first violation. Default true. */
  verify?: boolean;
  onTurn?: (state: GameState, events: TurnEvent[]) => void;
}

/** Plays one turn of an all-AI game with the standard AI. */
export const stepGame = (state: GameState, content: Content) => playTurn(state, content);

/** Runs an AI-vs-AI game headless until the turn limit or a winner, and returns the final state. */
export function runGame(options: RunOptions): GameState {
  const { content, verify = true } = options;
  let state = createGame(
    {
      seed: options.seed,
      galaxyPreset: options.preset,
      empires: options.factions.map((faction) => ({ faction, controller: 'ai' as const })),
      difficulty: options.difficulty,
    },
    content,
  );
  const seats = sortedKeys(state.empires);
  const pick = (_state: GameState, empireId: (typeof seats)[number]) => options.agents?.[seats.indexOf(empireId)] ?? standardAgent;

  for (let i = 0; i < options.turns && state.winner === null; i++) {
    const step = playTurn(state, content, pick);
    state = step.state;
    if (verify) {
      const problems = checkInvariants(state, content);
      if (problems.length > 0) {
        throw new Error(`Invariants broken entering turn ${state.turn}:\n  ${problems.join('\n  ')}`);
      }
    }
    options.onTurn?.(state, step.events);
  }
  return state;
}
