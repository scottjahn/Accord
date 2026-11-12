import type { Content, EmpireId, GameState, TurnEvent } from '../../sim';
import { eventText } from '../format';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  events: TurnEvent[];
}

/** What happened in the player's own systems during the turn that just resolved. */
export function EventLog({ state, content, player, events }: Props) {
  const mine = events.filter((e) => state.systems[e.system]?.colony?.owner === player);
  if (state.turn === 1) return null;
  return (
    <div className="event-log" aria-label="Last turn" aria-live="polite">
      <h3>Turn {state.turn - 1} report</h3>
      {mine.length === 0 ? (
        <p className="muted">Nothing to report.</p>
      ) : (
        <ul>
          {mine.map((event, i) => (
            <li key={i} className={event.type === 'starvation' ? 'bad' : undefined}>
              {eventText(event, state, content)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
