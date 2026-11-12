import {
  sortedKeys,
  validateCommand,
  type Colony,
  type ColonyForecast,
  type Command,
  type Content,
  type EmpireId,
  type GameState,
  type SystemId,
} from '../../sim';
import { ROLE_LABELS, effectsText, turns } from '../format';

interface Props {
  state: GameState;
  colony: Colony;
  content: Content;
  forecast: ColonyForecast;
  player: EmpireId;
  systemId: SystemId;
  dispatch: (command: Command) => boolean;
}

export function BuildQueue({ state, colony, content, forecast, player, systemId, dispatch }: Props) {
  const queue = colony.buildQueue;
  const target = { empire: player, system: systemId };
  const offline = sortedKeys(forecast.offline);
  const yard = content.rules.fleets.shipyardBuilding;
  const hasYard = (colony.buildings[yard] ?? 0) > 0;
  /** Why the sim would reject this command, so the button can say so. */
  const blocker = (command: Command) => validateCommand(state, command, content)?.message;

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
        <ol className="queue-list" aria-label="Build queue items">
          {queue.map((item, i) => {
            const { name, cost, turnsLeft } = forecast.queue[i];
            return (
              <li key={i}>
                <div className="queue-info">
                  <span>{name}</span>
                  <span className="muted">
                    {item.progress} / {cost} · {turnsLeft === null ? 'stalled' : turns(turnsLeft)}
                  </span>
                  <progress max={cost || 1} value={item.progress} aria-label={`${name} progress`} />
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
          const queued = queue.filter((item) => item.kind === 'building' && item.building === id).length;
          const command: Command = { type: 'enqueueBuild', ...target, building: id };
          const reason = blocker(command);
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
                  {[effectsText(def), `cost ${def.cost}`, def.energyUpkeep > 0 && `${def.energyUpkeep} energy`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {reason && <span className="muted reason">{reason}</span>}
              </div>
              <button
                type="button"
                className="btn small"
                aria-label={`Build ${def.name}`}
                disabled={reason !== undefined}
                title={reason}
                onClick={() => dispatch(command)}
              >
                Build
              </button>
            </li>
          );
        })}
      </ul>

      <h3 className="spaced">Ships</h3>
      {!hasYard ? (
        <p className="muted">Build a {content.buildings[yard].name} here to construct ships.</p>
      ) : (
        <ul className="building-list">
          {sortedKeys(content.hulls).map((id) => {
            const hull = content.hulls[id];
            const command: Command = { type: 'enqueueShip', ...target, hull: id };
            const reason = blocker(command);
            return (
              <li key={id}>
                <div className="building-info">
                  <span>{hull.name}</span>
                  <span className="muted">
                    {ROLE_LABELS[hull.role]} · cost {hull.cost} · speed {hull.speed} · support {hull.support}
                  </span>
                  {reason && <span className="muted reason">{reason}</span>}
                </div>
                <button
                  type="button"
                  className="btn small"
                  aria-label={`Build ${hull.name}`}
                  disabled={reason !== undefined}
                  title={reason}
                  onClick={() => dispatch(command)}
                >
                  Build
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
