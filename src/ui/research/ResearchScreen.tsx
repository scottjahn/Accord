import { rebalance } from '../../game/researchAllocation';
import {
  FIELDS,
  MAX_RESEARCH_LEVEL,
  eraOf,
  evenAllocation,
  forecastResearch,
  researchIncome,
  sortedKeys,
  type Command,
  type Content,
  type EmpireId,
  type FieldId,
  type GameState,
} from '../../sim';
import { OUTPUT_LABELS, signed, turns } from '../format';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  dispatch: (command: Command) => boolean;
  onClose: () => void;
}

/** What a field still has to offer: its per-level bonus and what higher levels unlock. */
function unlocks(field: FieldId, level: number, content: Content): string[] {
  const items: { level: number; name: string }[] = [];
  for (const id of sortedKeys(content.buildings)) {
    const needs = content.buildings[id].requires[field];
    if (needs && needs > level) items.push({ level: needs, name: content.buildings[id].name });
  }
  for (const id of sortedKeys(content.hulls)) {
    const needs = content.hulls[id].requires[field];
    if (needs && needs > level) items.push({ level: needs, name: content.hulls[id].name });
  }
  return items.sort((a, b) => a.level - b.level).map((i) => `Level ${i.level}: ${i.name}`);
}

export function ResearchScreen({ state, content, player, dispatch, onClose }: Props) {
  const research = state.empires[player].research;
  const forecast = forecastResearch(state, player, content);
  const setAllocation = (allocation: Record<FieldId, number>) =>
    dispatch({ type: 'setResearchAllocation', empire: player, allocation });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Research" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Research</h2>
            <p className="muted">
              Era {eraOf(research, content)} · {researchIncome(state, player, content)} research per turn
            </p>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setAllocation(evenAllocation())}>
              Even split
            </button>
            <button type="button" className="btn primary" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <ul className="field-list">
          {FIELDS.map((field) => {
            const def = content.fields[field];
            const f = forecast[field];
            const bonus = def.effects
              .map((e) => `${signed(e.percentPerLevel)}% ${OUTPUT_LABELS[e.output].toLowerCase()} per level`)
              .join(', ');
            const next = unlocks(field, f.level, content);
            return (
              <li key={field} className="field-row">
                <div className="field-title">
                  <span className="field-name">{def.name}</span>
                  <span data-testid={`level-${field}`}>
                    Level {f.level} / {MAX_RESEARCH_LEVEL}
                  </span>
                </div>
                {f.cost !== null ? (
                  <>
                    <progress max={f.cost} value={f.progress} aria-label={`${def.name} progress`} />
                    <p className="muted">
                      {f.progress} / {f.cost} · {signed(f.perTurn)} per turn ·{' '}
                      {f.turnsLeft === null ? 'paused' : `next level in ${turns(f.turnsLeft)}`}
                    </p>
                  </>
                ) : (
                  <p className="muted">Complete</p>
                )}
                <label className="field-share">
                  <span>Share</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    aria-label={`${def.name} share`}
                    value={research.allocation[field]}
                    onChange={(e) => setAllocation(rebalance(research.allocation, field, Number(e.target.value)))}
                  />
                  <span data-testid={`share-${field}`}>{research.allocation[field]}%</span>
                </label>
                <p className="muted">{[bonus, ...next].filter(Boolean).join(' · ') || 'Nothing more to unlock'}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
