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

/**
 * Governor choice plus one slider per output. Under Manual the sliders set the
 * workers directly. Under a governor, raising a slider places extra workers
 * there by hand; the governor keeps them there and assigns everyone else.
 */
export function AllocationSliders({ colony, economy, idle, player, systemId, dispatch }: Props) {
  const manual = colony.governor === 'manual';
  const placed = OUTPUT_KINDS.reduce((sum, k) => sum + colony.pinned[k], 0);
  const target = { empire: player, system: systemId };

  const setWorkers = (kind: OutputKind, workers: number) => {
    if (manual) {
      if (workers === colony.allocation[kind]) return;
      dispatch({ type: 'setAllocation', ...target, allocation: { ...colony.allocation, [kind]: workers } });
      return;
    }
    // What the governor itself has put here; anything above that is the player's.
    const governed = colony.allocation[kind] - colony.pinned[kind];
    const room = colony.population - (placed - colony.pinned[kind]);
    const pin = Math.max(0, Math.min(room, workers - governed));
    if (pin === colony.pinned[kind]) return;
    dispatch({ type: 'adjustWorkers', ...target, pinned: { ...colony.pinned, [kind]: pin } });
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
            onClick={() => dispatch({ type: 'setGovernor', ...target, governor })}
          >
            {GOVERNOR_LABELS[governor]}
          </button>
        ))}
      </div>
      <p className="muted hint">
        {manual
          ? 'You assign workers. New population waits idle until placed.'
          : 'The governor assigns workers every turn. Raise a slider to keep extra workers there; the governor places everyone else, including new population.'}
      </p>
      {!manual && placed > 0 && (
        <div className="fleet-actions">
          <span data-testid="placed">{placed} placed by hand</span>
          <button
            type="button"
            className="btn small"
            onClick={() => dispatch({ type: 'adjustWorkers', ...target, pinned: { food: 0, industry: 0, energy: 0, intel: 0, research: 0 } })}
          >
            Clear adjustments
          </button>
        </div>
      )}

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
            maxWorkers={manual ? colony.allocation[kind] + idle : colony.population}
            population={colony.population}
            pinned={manual ? 0 : colony.pinned[kind]}
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
