import type { Content, EmpireId, FleetId, GameState, IdleItem, SystemId, TurnEvent } from '../../sim';
import { eventIsMine, eventText, idleText } from '../format';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  events: TurnEvent[];
  /** Colonies and ships of the player's that are doing nothing this turn. */
  idle: IdleItem[];
  /** How many turns the last End Turn or Skip Ahead played. */
  turnsPlayed: number;
  /** Opens the full report for a battle or an invasion. */
  onOpenReport: (event: Extract<TurnEvent, { type: 'battle' | 'invasion' }>) => void;
  onSelectSystem: (id: SystemId) => void;
  onSelectFleet: (id: FleetId) => void;
}

const BAD: TurnEvent['type'][] = [
  'starvation',
  'coloniseFailed',
  'outpostFailed',
  'outpostLost',
  'borderEncroached',
  'fleetBlocked',
  'warDeclared',
  'empireEliminated',
  'treatyBroken',
  'offerRefused',
  'covertAction',
  'spyCaught',
  'revolt',
];

/**
 * The turn report: what happened to the player's empire during the turn that
 * just resolved, and what of theirs is idle now. Idle items jump to the colony
 * or fleet when clicked.
 */
export function EventLog({ state, content, player, events, idle, turnsPlayed, onOpenReport, onSelectSystem, onSelectFleet }: Props) {
  const mine = events.filter((e) => eventIsMine(e, state, player));
  const firstTurn = state.turn === 1;
  if (firstTurn && idle.length === 0) return null;
  return (
    <div className="event-log" aria-label="Last turn" aria-live="polite">
      {!firstTurn && (
        <>
          <h3>{turnsPlayed > 1 ? `Turns ${state.turn - turnsPlayed} to ${state.turn - 1} report` : `Turn ${state.turn - 1} report`}</h3>
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
        </>
      )}
      {idle.length > 0 && (
        <>
          <h3 className={firstTurn ? undefined : 'spaced'}>Idle</h3>
          <ul aria-label="Idle">
            {idle.map((item, i) => (
              <li key={i} className={item.blocking ? 'warn' : 'muted'}>
                {item.kind === 'unsettled' ? (
                  idleText(item, state)
                ) : (
                  <button
                    type="button"
                    className="link"
                    onClick={() => ('fleet' in item ? onSelectFleet(item.fleet) : onSelectSystem(item.system))}
                  >
                    {idleText(item, state)}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
