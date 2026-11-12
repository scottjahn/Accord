import {
  sortedKeys,
  type Colony,
  type ColonyForecast,
  type Command,
  type Content,
  type EmpireId,
  type SystemId,
} from '../../sim';
import { effectsText, turns } from '../format';

interface Props {
  colony: Colony;
  content: Content;
  forecast: ColonyForecast;
  player: EmpireId;
  systemId: SystemId;
  dispatch: (command: Command) => boolean;
}

export function BuildQueue({ colony, content, forecast, player, systemId, dispatch }: Props) {
  const queue = colony.buildQueue;
  const queueFull = queue.length >= content.rules.maxQueueLength;
  const target = { empire: player, system: systemId };
  const offline = sortedKeys(forecast.offline);

  return (
    <section>
      <h3>
        Build queue{' '}
        <span className="muted count">
          {queue.length} / {content.rules.maxQueueLength}
        </span>
      </h3>

      {queue.length === 0 ? (
        <p className="warn">Nothing queued. Industry is going to waste.</p>
      ) : (
        <ol className="queue-list" aria-label="Queued buildings">
          {queue.map((item, i) => {
            const def = content.buildings[item.building];
            const name = def?.name ?? item.building;
            const left = forecast.queue[i]?.turnsLeft ?? null;
            return (
              <li key={i}>
                <div className="queue-info">
                  <span>{name}</span>
                  <span className="muted">
                    {item.progress} / {def?.cost ?? '?'} · {left === null ? 'stalled' : turns(left)}
                  </span>
                  <progress max={def?.cost ?? 1} value={item.progress} aria-label={`${name} progress`} />
                </div>
                <div className="queue-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Move ${name} up`}
                    disabled={i === 0}
                    onClick={() => dispatch({ type: 'moveBuild', ...target, from: i, to: i - 1 })}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Move ${name} down`}
                    disabled={i === queue.length - 1}
                    onClick={() => dispatch({ type: 'moveBuild', ...target, from: i, to: i + 1 })}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${name} from queue`}
                    onClick={() => dispatch({ type: 'dequeueBuild', ...target, index: i })}
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {offline.length > 0 && (
        <p className="warn" role="status">
          Not enough energy:{' '}
          {offline.map((id) => `${forecast.offline[id]} ${content.buildings[id]?.name ?? id} offline`).join(', ')}
        </p>
      )}

      <h3>Buildings</h3>
      <ul className="building-list">
        {sortedKeys(content.buildings).map((id) => {
          const def = content.buildings[id];
          const built = colony.buildings[id] ?? 0;
          const queued = queue.filter((item) => item.building === id).length;
          const atLimit = built + queued >= def.maxPerSystem;
          const reason = atLimit ? 'Limit reached' : queueFull ? 'Queue is full' : undefined;
          return (
            <li key={id}>
              <div className="building-info">
                <span>
                  {def.name}{' '}
                  <span className="muted count">
                    {built}
                    {queued > 0 && ` +${queued}`} / {def.maxPerSystem}
                  </span>
                </span>
                <span className="muted">
                  {effectsText(def)} · cost {def.cost}
                  {def.energyUpkeep > 0 && ` · ${def.energyUpkeep} energy`}
                </span>
              </div>
              <button
                type="button"
                className="btn small"
                aria-label={`Build ${def.name}`}
                disabled={reason !== undefined}
                title={reason}
                onClick={() => dispatch({ type: 'enqueueBuild', ...target, building: id })}
              >
                Build
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
