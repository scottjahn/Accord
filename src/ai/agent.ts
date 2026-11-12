import {
  applyValidated,
  redactFor,
  validateCommand,
  type Command,
  type Content,
  type EmpireId,
  type GameState,
  type Json,
} from '../sim';
import { baselineAgent } from './baselineAgent';

export interface AgentResult {
  commands: Command[];
  /** Saved with the game and handed back next turn. */
  memory: Json;
}

/**
 * An AI player. `known` is the game as this empire knows it (already redacted
 * by fog of war), so an agent cannot cheat however it is written. It must
 * return commands that are legal in order; `createPlanner` takes care of that.
 */
export type Agent = (known: GameState, empire: EmpireId, content: Content, memory: Json | null) => AgentResult;

/** Runs an agent for one empire on its redacted view of the real state. */
export function runAgent(agent: Agent, state: GameState, empireId: EmpireId, content: Content): AgentResult {
  return agent(redactFor(state, empireId, content), empireId, content, state.agentMemory[empireId] ?? null);
}

export interface Planner {
  /** A private working copy that reflects every command accepted so far. */
  readonly state: GameState;
  readonly issued: Command[];
  /** Issues the command if it is legal right now. Returns whether it was. */
  attempt(command: Command): boolean;
}

export function createPlanner(known: GameState, content: Content): Planner {
  const state = structuredClone(known);
  const issued: Command[] = [];
  return {
    state,
    issued,
    attempt(command) {
      if (validateCommand(state, command, content)) return false;
      applyValidated(state, command, content);
      issued.push(command);
      return true;
    },
  };
}

/** The milestone 1-3 placeholder, kept as the opponent the real AI is measured against. */
export const baselineAsAgent: Agent = (known, empire, content) => ({
  commands: baselineAgent(known, empire, content),
  memory: null,
});
