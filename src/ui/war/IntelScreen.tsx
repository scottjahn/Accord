import { useState } from 'react';
import {
  OPERATION_KINDS,
  hasMet,
  needsSystem,
  operationOdds,
  sortedKeys,
  validateCommand,
  type Command,
  type Content,
  type EmpireId,
  type GameState,
  type SystemId,
} from '../../sim';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  dispatch: (command: Command) => boolean;
  onClose: () => void;
}

/** Intelligence: how intel is split, and covert operations against the rivals you have met. */
export function IntelScreen({ state, content, player, dispatch, onClose }: Props) {
  const rules = content.rules.intel;
  const me = state.empires[player];
  const rivals = sortedKeys(state.empires).filter((id) => id !== player && !state.empires[id].eliminated && hasMet(state, player, id));
  const [chosen, setChosen] = useState<Record<string, SystemId>>({});
  const ordered = state.operations.filter((o) => o.by === player);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Intelligence" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Intelligence</h2>
            <p className="muted">
              <span data-testid="intel-pool">{me.intelPool}</span> intel to spend · counter-intel{' '}
              <span data-testid="counter-intel">{me.counterIntel}</span> (loses {rules.decayPercent}% a turn)
            </p>
          </div>
          <button type="button" className="btn primary" onClick={onClose}>
            Close
          </button>
        </header>

        <label className="field-share">
          <span>Defence</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            aria-label="Counter-intel share"
            value={me.intelSplit}
            onChange={(e) => dispatch({ type: 'setIntelSplit', empire: player, percent: Number(e.target.value) })}
          />
          <span data-testid="intel-split">{me.intelSplit}%</span>
        </label>
        <p className="muted hint">
          That share of each turn's intel goes to counter-intel, which makes rival operations fail and their agents easier to catch. The
          rest goes to the pool, which pays for operations here and for courting minor races.
        </p>

        {ordered.length > 0 && (
          <p data-testid="ordered">
            Under way this turn:{' '}
            {ordered
              .map((o) => `${rules.operations[o.kind].label}${o.system ? ` at ${state.systems[o.system].name}` : ''}`)
              .join(', ')}
            . Results arrive with the turn report.
          </p>
        )}

        {rivals.length === 0 && <p className="muted">You have not made contact with any rival yet.</p>}
        <ul className="field-list">
          {rivals.map((id) => {
            const faction = content.factions[state.empires[id].faction];
            const watched = (me.revealedUntil[id] ?? -1) >= state.turn;
            // Their counter-intel is known only while they are under surveillance.
            const odds = operationOdds(watched ? state.empires[id].counterIntel : 0, content);
            const colonies = sortedKeys(me.knownSystems).filter((s) => me.knownSystems[s] === id);
            const system = chosen[id] && colonies.includes(chosen[id]) ? chosen[id] : colonies[0];
            return (
              <li key={id} className="field-row">
                <div className="field-title">
                  <span className="field-name">
                    <span className="dot" style={{ background: faction.color }} /> {faction.name}
                  </span>
                  <span className="muted">
                    {watched
                      ? `Counter-intel ${state.empires[id].counterIntel}: ${odds.chance}% to succeed, ${odds.caught}% caught on failure`
                      : `Defences unknown: up to ${odds.chance}% to succeed`}
                  </span>
                </div>
                {colonies.length > 0 && (
                  <label className="field">
                    <span>Colony to target</span>
                    <select aria-label={`Target colony of ${faction.name}`} value={system} onChange={(e) => setChosen({ ...chosen, [id]: e.target.value as SystemId })}>
                      {colonies.map((s) => (
                        <option key={s} value={s}>
                          {state.systems[s].name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="fleet-actions">
                  {OPERATION_KINDS.map((kind) => {
                    const command: Command = { type: 'runOperation', empire: player, target: id, kind, system: needsSystem(kind) ? (system ?? null) : null };
                    const reason = validateCommand(state, command, content)?.message;
                    return (
                      <button
                        key={kind}
                        type="button"
                        className="btn small"
                        disabled={reason !== undefined}
                        title={reason}
                        aria-label={`${rules.operations[kind].label} against ${faction.name}`}
                        onClick={() => dispatch(command)}
                      >
                        {rules.operations[kind].label} ({rules.operations[kind].cost})
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
