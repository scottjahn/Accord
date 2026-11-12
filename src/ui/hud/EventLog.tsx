import type { Content, EmpireId, GameState, TurnEvent } from '../../sim';
import { eventIsMine, eventText } from '../format';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  events: TurnEvent[];
  /** Opens the full report for a battle or an invasion. */
  onOpenReport: (event: Extract<TurnEvent, { type: 'battle' | 'invasion' }>) => void;
}

const BAD: TurnEvent['type'][] = [
  'starvation',
  'coloniseFailed',
  'fleetBlocked',
  'warDeclared',
  'empireEliminated',
  'treatyBroken',
  'offerRefused',
  'covertAction',
  'spyCaught',
  'revolt',
];

/** What happened to the player's own empire during the turn that just resolved. */
export function EventLog({ state, content, player, events, onOpenReport }: Props) {
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
              {event.type === 'battle' || event.type === 'invasion' ? (
                <button type="button" className="link" onClick={() => onOpenReport(event)}>
                  {eventText(event, state, content)}
                </button>
              ) : (
                eventText(event, state, content)
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
