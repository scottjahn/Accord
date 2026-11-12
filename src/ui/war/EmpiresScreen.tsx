import { useState } from 'react';
import {
  TREATY_TYPES,
  atWar,
  coloniesOf,
  minorStanding,
  opinionBreakdown,
  sortedKeys,
  treatiesBetween,
  validateCommand,
  type Command,
  type Content,
  type EmpireId,
  type EmpireView,
  type GameState,
  type TreatyType,
} from '../../sim';
import { bonusText, lineValue, signed } from '../format';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  view: EmpireView;
  dispatch: (command: Command) => boolean;
  onClose: () => void;
}

/**
 * Diplomacy: what each rival thinks of you and why, the treaties between you,
 * offers waiting for an answer, and the buttons to propose, break or go to war.
 */
export function EmpiresScreen({ state, content, player, view, dispatch, onClose }: Props) {
  // Declaring war and breaking a treaty cannot be undone, so each takes a second click.
  const [confirming, setConfirming] = useState<string | null>(null);
  const rules = content.rules.diplomacy;
  const rivals = sortedKeys(state.empires).filter((id) => id !== player);
  const mine = coloniesOf(state, player).length;
  const minors = sortedKeys(state.systems)
    .map((id) => state.systems[id])
    .filter((s) => s.minor && view.systems[s.id]?.known);
  const members = state.empires[player].members;
  const originals = members.filter((m) => m !== content.rules.morale.rebelRace).length;
  const needed = Math.ceil((state.minorsPlaced * rules.accordMemberPercent) / 100);
  const knownColonies = (id: EmpireId) => sortedKeys(view.systems).filter((s) => view.systems[s].owner === id).length;
  const label = (type: TreatyType) => rules.treaties[type].label;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Empires" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Empires</h2>
            <p className="muted">
              You hold {mine} {mine === 1 ? 'colony' : 'colonies'}.
              {state.minorsPlaced > 0 && rules.accordMemberPercent > 0 && (
                <span data-testid="accord-progress">
                  {' '}
                  The Accord: ally with every rival and hold {needed} of the {state.minorsPlaced} minor races; you hold {originals}.
                </span>
              )}
            </p>
          </div>
          <button type="button" className="btn primary" onClick={onClose}>
            Close
          </button>
        </header>
        <ul className="field-list">
          {rivals.map((id) => {
            const empire = state.empires[id];
            const faction = content.factions[empire.faction];
            const war = atWar(state, player, id);
            const status = empire.eliminated ? 'Eliminated' : war ? 'At war' : 'At peace';
            const opinion = opinionBreakdown(state, id, player, content);
            const treaties = treatiesBetween(state, player, id);
            const incoming = state.offers.filter((o) => o.from === id && o.to === player);
            const outgoing = state.offers.filter((o) => o.from === player && o.to === id);
            const declare: Command = { type: 'declareWar', empire: player, on: id };
            const declareBlocked = validateCommand(state, declare, content)?.message;
            return (
              <li key={id} className="field-row">
                <div className="field-title">
                  <span className="field-name">
                    <span className="dot" style={{ background: faction.color }} /> {faction.name}
                  </span>
                  <span className={war ? 'bad' : undefined} data-testid={`relation-${id}`}>
                    {status}
                  </span>
                </div>
                <p className="muted">
                  {knownColonies(id) === 0 ? 'You have not found any of their colonies.' : `You know of ${knownColonies(id)} of their colonies.`}
                </p>

                {!empire.eliminated && (
                  <>
                    <table className="breakdown" aria-label={`${faction.name}'s opinion of you`}>
                      <tbody>
                        {opinion.lines.map((line, i) => (
                          <tr key={i}>
                            <td>{line.source}</td>
                            <td className="num">{lineValue(line)}</td>
                          </tr>
                        ))}
                        <tr className="breakdown-total">
                          <td>Their opinion of you</td>
                          <td className="num" data-testid={`opinion-${id}`}>
                            {signed(opinion.total)}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {treaties.length > 0 && (
                      <ul className="planet-list" aria-label={`Treaties with ${faction.name}`}>
                        {treaties.map((treaty) => {
                          const key = `break:${id}:${treaty.type}`;
                          return (
                            <li key={treaty.type}>
                              <span>
                                {label(treaty.type)}{' '}
                                <span className="muted">
                                  {treaty.endTurn === null ? 'until broken' : `${treaty.endTurn - state.turn} turns left`}
                                </span>
                              </span>
                              {confirming === key ? (
                                <span className="fleet-actions">
                                  <button
                                    type="button"
                                    className="btn small danger"
                                    onClick={() => {
                                      dispatch({ type: 'breakTreaty', empire: player, with: id, treaty: treaty.type });
                                      setConfirming(null);
                                    }}
                                  >
                                    Confirm: break the {label(treaty.type).toLowerCase()}
                                  </button>
                                  <button type="button" className="btn small" onClick={() => setConfirming(null)}>
                                    Keep it
                                  </button>
                                </span>
                              ) : (
                                <button type="button" className="btn small" aria-label={`Break ${label(treaty.type)}`} onClick={() => setConfirming(key)}>
                                  Break
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {confirming?.startsWith(`break:${id}:`) && (
                      <p className="warn">Breaking your word costs morale at home, their trust for a long time, and the regard of every other power and minor race.</p>
                    )}

                    {incoming.map((offer) => (
                      <div key={offer.id} className="offer" role="group" aria-label={`Offer: ${label(offer.type)}`}>
                        <span>
                          {faction.name} proposes a {label(offer.type).toLowerCase()}.
                        </span>
                        <span className="fleet-actions">
                          <button type="button" className="btn small primary" onClick={() => dispatch({ type: 'answerOffer', empire: player, offer: offer.id, accept: true })}>
                            Accept
                          </button>
                          <button type="button" className="btn small" onClick={() => dispatch({ type: 'answerOffer', empire: player, offer: offer.id, accept: false })}>
                            Decline
                          </button>
                        </span>
                      </div>
                    ))}
                    {outgoing.map((offer) => (
                      <p key={offer.id} className="muted">
                        You proposed a {label(offer.type).toLowerCase()}; they will answer on their turn.
                      </p>
                    ))}

                    <div className="fleet-actions">
                      {TREATY_TYPES.filter((type) => !treaties.some((t) => t.type === type)).map((type) => {
                        const command: Command = { type: 'proposeTreaty', empire: player, to: id, treaty: type };
                        const reason = validateCommand(state, command, content)?.message;
                        return (
                          <button key={type} type="button" className="btn small" disabled={reason !== undefined} title={reason} onClick={() => dispatch(command)}>
                            Propose {label(type).toLowerCase()}
                          </button>
                        );
                      })}
                    </div>

                    {!war && (
                      <div className="fleet-actions">
                        {confirming === `war:${id}` ? (
                          <>
                            <button
                              type="button"
                              className="btn danger"
                              onClick={() => {
                                dispatch(declare);
                                setConfirming(null);
                              }}
                            >
                              Confirm war on {faction.name}
                            </button>
                            <button type="button" className="btn" onClick={() => setConfirming(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button type="button" className="btn" disabled={declareBlocked !== undefined} title={declareBlocked} onClick={() => setConfirming(`war:${id}`)}>
                            Declare war
                          </button>
                        )}
                      </div>
                    )}
                    {confirming === `war:${id}` && <p className="warn">Fleets will fight on sight, and they will remember who started it.</p>}
                  </>
                )}
              </li>
            );
          })}
        </ul>

        <h3 className="spaced">Minor races</h3>
        {members.length > 0 && (
          <p>
            Members of your empire: {members.map((m) => `${content.minors[m].name} (${bonusText(content.minors[m], content)})`).join('; ')}.
          </p>
        )}
        {minors.length === 0 ? (
          <p className="muted">You have not found any independent peoples{members.length > 0 ? ' still on their own' : ''}.</p>
        ) : (
          <ul className="planet-list" aria-label="Minor races">
            {minors.map((s) => {
              const def = content.minors[s.minor!.race];
              const attitude = s.minor!.attitude[player];
              return (
                <li key={s.id}>
                  <span>
                    {def.name} of {s.name}
                  </span>
                  <span className="muted">
                    {attitude === undefined ? 'not yet met' : `attitude ${attitude} · ${minorStanding(s, player)}`} · {bonusText(def, content)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
