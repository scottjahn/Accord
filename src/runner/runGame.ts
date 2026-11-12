import { baselineAgent } from '../ai/baselineAgent';
import {
  checkInvariants,
  createGame,
  processTurn,
  sortedKeys,
  submitCommand,
  type Content,
  type GameState,
  type TurnEvent,
} from '../sim';

export interface RunOptions {
  content: Content;
  seed: number;
  turns: number;
  preset: string;
  /** One empire per faction id, all played by the baseline agent. */
  factions: string[];
  /** Check state invariants after every turn and throw on the first violation. Default true. */
  verify?: boolean;
  onTurn?: (state: GameState, events: TurnEvent[]) => void;
}

/**
 * Plays one turn: every empire's agent issues commands, then the turn resolves.
 * Throws if an agent issues an illegal command, since that is an agent bug.
 */
export function stepGame(state: GameState, content: Content): { state: GameState; events: TurnEvent[] } {
  let current = state;
  for (const empireId of sortedKeys(current.empires)) {
    for (const command of baselineAgent(current, empireId, content)) {
      const result = submitCommand(current, command, content);
      if (!result.ok) {
        throw new Error(
          `Turn ${current.turn}: ${empireId} issued an illegal ${command.type}: ${result.error.message}`,
        );
      }
      current = result.value;
    }
  }
  return processTurn(current, content);
}

/** Runs a full agent-vs-agent game headless and returns the final state. */
export function runGame(options: RunOptions): GameState {
  const { content, verify = true } = options;
  let state = createGame(
    {
      seed: options.seed,
      galaxyPreset: options.preset,
      empires: options.factions.map((faction) => ({ faction, controller: 'ai' as const })),
    },
    content,
  );

  for (let i = 0; i < options.turns; i++) {
    const step = stepGame(state, content);
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
