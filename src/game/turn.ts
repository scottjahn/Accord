import { baselineAgent } from '../ai/baselineAgent';
import { processTurn, sortedKeys, submitCommands, type Content, type GameState, type TurnEvent } from '../sim';

/**
 * Ends the turn: every AI-controlled empire issues its commands, then the turn
 * resolves. Human empires are left exactly as the player set them.
 * Throws if an agent issues an illegal command, since that is an agent bug.
 */
export function playTurn(state: GameState, content: Content): { state: GameState; events: TurnEvent[] } {
  let current = state;
  for (const empireId of sortedKeys(current.empires)) {
    if (current.empires[empireId].controller !== 'ai') continue;
    const commands = baselineAgent(current, empireId, content);
    const result = submitCommands(current, commands, content);
    if (!result.ok) {
      const type = commands[result.error.index].type;
      throw new Error(`Turn ${current.turn}: ${empireId} issued an illegal ${type}: ${result.error.message}`);
    }
    current = result.value;
  }
  return processTurn(current, content);
}
