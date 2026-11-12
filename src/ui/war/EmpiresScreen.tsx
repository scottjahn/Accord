import { useState } from 'react';
import { atWar, coloniesOf, minorStanding, sortedKeys, type Command, type Content, type EmpireId, type EmpireView, type GameState } from '../../sim';
import { bonusText } from '../format';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  view: EmpireView;
  dispatch: (command: Command) => boolean;
  onClose: () => void;
}

/** The other powers: whether you are at peace or at war, and the button that changes it. */
export function EmpiresScreen({ state, content, player, view, dispatch, onClose }: Props) {
  // Declaring war cannot be undone, so it takes a second click.
  const [confirming, setConfirming] = useState<EmpireId | null>(null);
  const rivals = sortedKeys(state.empires).filter((id) => id !== player);
  const mine = coloniesOf(state, player).length;
  const minors = sortedKeys(state.systems)
    .map((id) => state.systems[id])
    .filter((s) => s.minor && view.systems[s.id]?.known);
  const members = state.empires[player].members;
  const knownColonies = (id: EmpireId) => sortedKeys(view.systems).filter((s) => view.systems[s].owner === id).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Empires" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Empires</h2>
            <p className="muted">You hold {mine} {mine === 1 ? 'colony' : 'colonies'}. Peace lasts until someone declares war.</p>
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
                {!empire.eliminated && !war && (
                  <div className="fleet-actions">
                    {confirming === id ? (
                      <>
                        <button
                          type="button"
                          className="btn danger"
                          onClick={() => {
                            dispatch({ type: 'declareWar', empire: player, on: id });
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
                      <button type="button" className="btn" onClick={() => setConfirming(id)}>
                        Declare war
                      </button>
                    )}
                  </div>
                )}
                {confirming === id && <p className="warn">There is no way back to peace yet. Fleets will fight on sight.</p>}
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
