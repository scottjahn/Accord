import { useState } from 'react';
import {
  fleetPlan,
  fleetRange,
  fleetSpeed,
  sameSector,
  sortedKeys,
  systemAt,
  validateCommand,
  type Command,
  type Content,
  type EmpireId,
  type EmpireView,
  type Fleet,
  type GameState,
  type HullId,
  type ShipId,
} from '../../sim';
import { ROLE_LABELS, placeName, sectorLabel, sectors, ships as shipCount, turns } from '../format';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  view: EmpireView;
  fleet: Fleet;
  /** True while the next map click sets this fleet's destination. */
  moveMode: boolean;
  onToggleMove: () => void;
  dispatch: (command: Command) => boolean;
}

export function FleetPanel({ state, content, player, view, fleet, moveMode, onToggleMove, dispatch }: Props) {
  const [picked, setPicked] = useState<ShipId[]>([]);
  const mine = fleet.owner === player;
  const faction = content.factions[state.empires[fleet.owner].faction];
  const here = systemAt(state, fleet.sector);
  const plan = fleet.destination ? fleetPlan(state, fleet, fleet.destination, content) : null;
  const chosen = picked.filter((id) => fleet.ships.some((s) => s.id === id));

  /** The best hull this ship could be refitted to here, with the command that queues it. */
  const refitFor = (ship: Fleet['ships'][number]) => {
    if (!mine || !here?.colony || here.colony.owner !== player) return null;
    const current = content.hulls[ship.hull];
    const options = sortedKeys(content.hulls)
      .filter((id) => content.hulls[id].role === current?.role && content.hulls[id].tier > (current?.tier ?? 0))
      .sort((a, b) => content.hulls[b].tier - content.hulls[a].tier);
    for (const hull of options) {
      const command: Command = { type: 'enqueueRefit', empire: player, system: here.id, ship: ship.id, hull: hull as HullId };
      if (!validateCommand(state, command, content)) return { hull: content.hulls[hull], command };
    }
    return null;
  };

  const colonise: Command | null =
    mine && here && view.systems[here.id]?.known
      ? { type: 'coloniseSystem', empire: player, fleet: fleet.id, system: here.id }
      : null;
  const coloniseError = colonise ? validateCommand(state, colonise, content) : null;
  const hasColonyShip = fleet.ships.some((s) => content.hulls[s.hull]?.role === 'colony');
  const companions = mine ? view.fleets.filter((f) => f.owner === player && f.id !== fleet.id && sameSector(f.sector, fleet.sector)) : [];

  let status = 'Holding position';
  if (fleet.destination) {
    const where = placeName(state, fleet.destination);
    const eta = plan ? ` · ${turns(plan.turns)}` : '';
    status = fleet.order === 'colonise' ? `Heading to ${where} to colonise${eta}` : `Heading to ${where}${eta}`;
  } else if (fleet.order === 'colonise') {
    status = 'Founding a colony this turn';
  }

  return (
    <div className="system-panel">
      <header className="system-head">
        <h2>{mine ? 'Your fleet' : `${faction.name} fleet`}</h2>
        <p className="muted">
          <span className="dot" style={{ background: faction.color }} /> {shipCount(fleet.ships.length)} at{' '}
          {here && view.systems[here.id]?.known ? here.name : `sector ${sectorLabel(fleet.sector)}`}
        </p>
      </header>

      {mine && (
        <section>
          <h3>Orders</h3>
          <p data-testid="fleet-status">{status}</p>
          <dl className="stat-grid">
            <div>
              <dt>Speed</dt>
              <dd>{sectors(fleetSpeed(fleet, content))} per turn</dd>
            </div>
            <div>
              <dt>Range</dt>
              <dd>{sectors(fleetRange(state, fleet, content))} from a colony</dd>
            </div>
          </dl>
          <div className="fleet-actions">
            <button type="button" className={`btn${moveMode ? ' primary' : ''}`} aria-pressed={moveMode} onClick={onToggleMove}>
              {moveMode ? 'Pick a sector…' : 'Move'}
            </button>
            {(fleet.destination || fleet.order !== 'none') && (
              <button type="button" className="btn" onClick={() => dispatch({ type: 'stopFleet', empire: player, fleet: fleet.id })}>
                Stop
              </button>
            )}
            {colonise && hasColonyShip && fleet.order !== 'colonise' && (
              <button
                type="button"
                className="btn"
                disabled={coloniseError !== null}
                title={coloniseError?.message}
                onClick={() => dispatch(colonise)}
              >
                Colonise {here!.name}
              </button>
            )}
          </div>
          <p className="muted hint">
            Right-click the map, or press Move and click, to send this fleet. The highlighted sectors are in supply
            range.{hasColonyShip && ' Send it to an unclaimed system to found a colony there.'}
          </p>
        </section>
      )}

      <section>
        <h3>Ships</h3>
        <ul className="building-list" aria-label="Ships in fleet">
          {fleet.ships.map((ship) => {
            const hull = content.hulls[ship.hull];
            const refit = refitFor(ship);
            return (
              <li key={ship.id}>
                <label className="building-info">
                  <span>
                    {mine && fleet.ships.length > 1 && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${hull?.name ?? ship.hull}`}
                        checked={chosen.includes(ship.id)}
                        onChange={(e) =>
                          setPicked(e.target.checked ? [...chosen, ship.id] : chosen.filter((id) => id !== ship.id))
                        }
                      />
                    )}{' '}
                    {hull?.name ?? ship.hull}
                  </span>
                  <span className="muted">
                    {hull ? ROLE_LABELS[hull.role] : 'Unknown'} · hull {ship.hp} / {hull?.hp ?? '?'}
                  </span>
                </label>
                {refit && (
                  <button type="button" className="btn small" onClick={() => dispatch(refit.command)}>
                    Refit to {refit.hull.name}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {mine && fleet.ships.length > 1 && (
          <div className="fleet-actions">
            <button
              type="button"
              className="btn"
              disabled={chosen.length === 0 || chosen.length === fleet.ships.length}
              onClick={() => {
                if (dispatch({ type: 'splitFleet', empire: player, fleet: fleet.id, ships: chosen })) setPicked([]);
              }}
            >
              Split off selected
            </button>
          </div>
        )}
      </section>

      {companions.length > 0 && (
        <section>
          <h3>Also here</h3>
          <ul className="building-list">
            {companions.map((other) => (
              <li key={other.id}>
                <span>{other.ships.map((s) => content.hulls[s.hull]?.name ?? s.hull).join(', ')}</span>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => dispatch({ type: 'mergeFleets', empire: player, from: other.id, into: fleet.id })}
                >
                  Merge in
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
