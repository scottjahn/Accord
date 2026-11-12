import { baselineAgent } from '../ai/baselineAgent';
import { processTurn, sortedKeys, submitCommand, type Content, type GameState, type TurnEvent } from '../sim';

/**
 * Ends the turn: every AI-controlled empire issues its commands, then the turn
 * resolves. Human empires are left exactly as the player set them.
 * Throws if an agent issues an illegal command, since that is an agent bug.
 */
export function playTurn(state: GameState, content: Content): { state: GameState; events: TurnEvent[] } {
  let current = state;
  for (const empireId of sortedKeys(current.empires)) {
    if (current.empires[empireId].controller !== 'ai') continue;
    for (const command of baselineAgent(current, empireId, content)) {
      const result = submitCommand(current, command, content);
      if (!result.ok) {
        throw new Error(`Turn ${current.turn}: ${empireId} issued an illegal ${command.type}: ${result.error.message}`);
      }
      current = result.value;
    }
  }
  return processTurn(current, content);
}
