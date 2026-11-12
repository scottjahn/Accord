import type { Content, EmpireId, GameState, TurnEvent } from '../../sim';
import { eventIsMine, eventText } from '../format';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  events: TurnEvent[];
}

const BAD: TurnEvent['type'][] = ['starvation', 'coloniseFailed', 'fleetBlocked'];

/** What happened to the player's own empire during the turn that just resolved. */
export function EventLog({ state, content, player, events }: Props) {
  const mine = events.filter((e) => eventIsMine(e, state, player));
  if (state.turn === 1) return null;
  return (
    <div className="event-log" aria-label="Last turn" aria-live="polite">
      <h3>Turn {state.turn - 1} report</h3>
      {mine.length === 0 ? (
        <p className="muted">Nothing to report.</p>
      ) : (
        <ul>
          {mine.map((event, i) => (
            <li key={i} className={BAD.includes(event.type) ? 'bad' : undefined}>
              {eventText(event, state, content)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
