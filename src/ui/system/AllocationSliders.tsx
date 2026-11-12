import {
  GOVERNORS,
  OUTPUT_KINDS,
  type Colony,
  type ColonyEconomy,
  type Command,
  type EmpireId,
  type OutputKind,
  type SystemId,
} from '../../sim';
import { GOVERNOR_LABELS } from '../format';
import { OutputRow } from './OutputRow';

interface Props {
  colony: Colony;
  economy: ColonyEconomy;
  idle: number;
  player: EmpireId;
  systemId: SystemId;
  dispatch: (command: Command) => boolean;
}

/** Governor choice plus one slider per output. Moving a slider switches to manual. */
export function AllocationSliders({ colony, economy, idle, player, systemId, dispatch }: Props) {
  const setWorkers = (kind: OutputKind, workers: number) => {
    if (workers === colony.allocation[kind]) return;
    dispatch({
      type: 'setAllocation',
      empire: player,
      system: systemId,
      allocation: { ...colony.allocation, [kind]: workers },
    });
  };

  return (
    <section>
      <h3>Workers</h3>
      <div className="governors" role="radiogroup" aria-label="Governor">
        {GOVERNORS.map((governor) => (
          <button
            key={governor}
            type="button"
            role="radio"
            aria-checked={colony.governor === governor}
            className={`chip${colony.governor === governor ? ' selected' : ''}`}
            onClick={() => dispatch({ type: 'setGovernor', empire: player, system: systemId, governor })}
          >
            {GOVERNOR_LABELS[governor]}
          </button>
        ))}
      </div>
      <p className="muted hint">
        {colony.governor === 'manual'
          ? 'You assign workers. New population waits idle until placed.'
          : 'The governor reassigns workers every turn. Move a slider to take over.'}
      </p>

      <div className="output-head" aria-hidden="true">
        <span>Output</span>
        <span>Workers</span>
        <span />
        <span>Per turn</span>
      </div>
      <ul className="output-list">
        {OUTPUT_KINDS.map((kind) => (
          <OutputRow
            key={kind}
            kind={kind}
            workers={colony.allocation[kind]}
            maxWorkers={colony.allocation[kind] + idle}
            population={colony.population}
            output={economy.outputs[kind]}
            onChange={(workers) => setWorkers(kind, workers)}
          />
        ))}
      </ul>
      <p className={idle > 0 ? 'idle warn' : 'idle muted'} data-testid="idle">
        {idle > 0 ? `${idle} idle` : 'Everyone is working'}
      </p>
    </section>
  );
}
