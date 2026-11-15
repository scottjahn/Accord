import { idleReport, type Content, type EmpireId, type GameState, type IdleItem, type TurnEvent } from '../sim';

/** How many turns one press of Skip Ahead will play at most. */
export const SKIP_LIMIT = 10;

/** True for events the player's turn report should list. */
export function eventIsMine(event: TurnEvent, state: GameState, player: EmpireId): boolean {
  if (event.type === 'warDeclared' || event.type === 'empireEliminated' || event.type === 'gameWon') return true;
  if ('empires' in event) return event.empires.includes(player);
  if ('empire' in event) return event.empire === player;
  return state.systems[event.system]?.colony?.owner === player;
}

/**
 * Events that happen all the time and need no decision. A finished building
 * only matters if it leaves the queue empty, which the idle report covers.
 */
const ROUTINE: TurnEvent['type'][] = ['populationGrew', 'buildCompleted', 'refitCompleted', 'treatyExpired'];

const idleKey = (item: IdleItem): string => `${item.kind}:${'fleet' in item ? item.fleet : 'system' in item ? item.system : ''}`;

/** The blocking idle items an empire has right now, as comparable keys. */
export function idleKeys(state: GameState, player: EmpireId, content: Content): Set<string> {
  return new Set(
    idleReport(state, player, content)
      .filter((item) => item.blocking)
      .map(idleKey),
  );
}

/**
 * Should skipping ahead stop after this turn? Yes when the game is over, an
 * offer is waiting, something of the player's has newly gone idle, or the turn
 * report holds anything beyond routine growth. A war between two other powers
 * is news but not a reason to stop.
 */
export function turnNeedsPlayer(state: GameState, player: EmpireId, events: TurnEvent[], content: Content, acceptedIdle: Set<string>): boolean {
  if (state.winner !== null || state.empires[player].eliminated) return true;
  if (state.offers.some((offer) => offer.to === player)) return true;
  for (const key of idleKeys(state, player, content)) if (!acceptedIdle.has(key)) return true;
  return events.some((event) => {
    if (ROUTINE.includes(event.type) || !eventIsMine(event, state, player)) return false;
    if (event.type === 'warDeclared') return event.by === player || event.on === player;
    return true;
  });
}
