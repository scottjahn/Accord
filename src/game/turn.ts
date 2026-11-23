import { runAgent, type Agent } from '../ai/agent';
import { standardAgent } from '../ai/standardAgent';
import {
  processTurn,
  sortedKeys,
  submitCommands,
  type Content,
  type EmpireId,
  type GameState,
  type TurnEvent,
  type TurnOptions,
} from '../sim';

/** Which agent plays an AI empire. Defaults to the standard AI for everyone. */
export type AgentPicker = (state: GameState, empireId: EmpireId) => Agent;

/**
 * Ends the turn: every AI-controlled empire decides from its own redacted view
 * and issues its commands, then the turn resolves. Human empires are left
 * exactly as the player set them. Each agent's memory is stored in the state so
 * a saved game resumes with the same plans.
 * Throws if an agent issues an illegal command, since that is an agent bug.
 */
export function playTurn(
  state: GameState,
  content: Content,
  pick: AgentPicker = () => standardAgent,
  options: TurnOptions = {},
): { state: GameState; events: TurnEvent[] } {
  return processTurn(prepareTurn(state, content, pick), content, options);
}

/**
 * The first half of `playTurn`: every AI empire issues its commands, and the
 * state is returned ready for `processTurn`. Lets the session look at the
 * battles ahead before the turn resolves.
 */
export function prepareTurn(state: GameState, content: Content, pick: AgentPicker = () => standardAgent): GameState {
  let current = state;
  for (const empireId of sortedKeys(current.empires)) {
    if (current.empires[empireId].controller !== 'ai') continue;
    const { commands, memory } = runAgent(pick(current, empireId), current, empireId, content);
    const result = submitCommands(current, commands, content);
    if (!result.ok) {
      const type = commands[result.error.index].type;
      throw new Error(`Turn ${current.turn}: ${empireId} issued an illegal ${type}: ${result.error.message}`);
    }
    current = result.value;
    current.agentMemory[empireId] = memory;
  }
  return current;
}
