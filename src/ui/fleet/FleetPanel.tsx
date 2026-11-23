import { useState } from 'react';
import {
  fleetIsArmed,
  fleetPlan,
  invasionOdds,
  fleetRange,
  fleetSpeed,
  sameSector,
  sortedKeys,
  stancesFor,
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
  type Stance,
} from '../../sim';
import { HullIcon } from './HullIcon';
import { ROLE_LABELS, fleetOrderText, lineValue, sectorLabel, sectors, ships as shipCount } from '../format';

const STANCE_HELP: Record<Stance, string> = {
  engage: 'Engage: fire on armed enemies first.',
  raid: 'Raid: fire on transports, colony ships and scouts first.',
  escort: 'Escort: draw raiders away from the unarmed ships in this sector.',
  evade: 'Evade: hold fire, take one round at half damage, then fall back toward home.',
};

/** An unarmed fleet cannot fire, so its two stances say what it does when shot at. */
const UNARMED_LABEL: Partial<Record<Stance, string>> = { engage: 'Hold', evade: 'Evade' };
const UNARMED_HELP: Partial<Record<Stance, string>> = {
  engage: 'Hold: stay put if enemies arrive. This fleet is unarmed, so it cannot fire back.',
  evade: 'Evade: if shot at, take one round at half damage, then fall back toward home.',
};

const stanceLabel = (stance: Stance) => stance[0].toUpperCase() + stance.slice(1);

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
  const invade: Command | null =
    mine && here && view.systems[here.id]?.known && fleet.ships.some((s) => (content.hulls[s.hull]?.troops ?? 0) > 0) && ((here.colony && here.colony.owner !== player) || here.minor)
      ? { type: 'invadeSystem', empire: player, fleet: fleet.id, system: here.id }
      : null;
  const invadeError = invade ? validateCommand(state, invade, content) : null;
  // The landing joins every fleet of ours here that is already set to invade.
  const odds =
    invade && !invadeError
      ? invasionOdds(
          state,
          [fleet, ...view.fleets.filter((f) => f.owner === player && f.id !== fleet.id && f.order === 'invade' && sameSector(f.sector, fleet.sector))],
          here!,
          content,
        )
      : null;
  const hasColonyShip = fleet.ships.some((s) => content.hulls[s.hull]?.role === 'colony');
  const companions = mine ? view.fleets.filter((f) => f.owner === player && f.id !== fleet.id && sameSector(f.sector, fleet.sector)) : [];

  const status = fleetOrderText(state, fleet, plan ? plan.turns : null);
  const armed = fleetIsArmed(fleet, content);
  const stances = stancesFor(fleet, content);
  const label = (stance: Stance) => (armed ? stanceLabel(stance) : (UNARMED_LABEL[stance] ?? stanceLabel(stance)));
  const help = (stance: Stance) => (armed ? STANCE_HELP[stance] : (UNARMED_HELP[stance] ?? STANCE_HELP[stance]));

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
          {!armed && (
            <p className="hint" data-testid="unarmed">
              Unarmed: none of these ships can fire. Armed enemies in the same sector will shoot at them.
            </p>
          )}
          <div className="governors" role="radiogroup" aria-label="Stance">
            {stances.map((stance) => (
              <button
                key={stance}
                type="button"
                role="radio"
                aria-checked={fleet.stance === stance}
                className={`chip${fleet.stance === stance ? ' selected' : ''}`}
                title={help(stance)}
                onClick={() => dispatch({ type: 'setStance', empire: player, fleet: fleet.id, stance })}
              >
                {label(stance)}
              </button>
            ))}
          </div>
          <p className="muted hint">{help(fleet.stance)}</p>
          <div className="fleet-actions">
            <button type="button" className={`btn${moveMode ? ' primary' : ''}`} aria-pressed={moveMode} onClick={onToggleMove}>
              {moveMode ? 'Pick a sector…' : 'Move'}
            </button>
            {(fleet.destination || fleet.order !== 'none') && (
              <button type="button" className="btn" onClick={() => dispatch({ type: 'stopFleet', empire: player, fleet: fleet.id })}>
                Stop
              </button>
            )}
            {invade && fleet.order !== 'invade' && (
              <button type="button" className="btn danger" disabled={invadeError !== null} title={invadeError?.message} onClick={() => dispatch(invade)}>
                Invade {here!.name}
                {odds && ` (${odds.chance}%)`}
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
                Found colony at {here!.name}
              </button>
            )}
          </div>
          {odds && (
            <div className="invasion-odds" data-testid="invasion-odds">
              <p>
                <strong>{odds.chance}%</strong> chance to take {here!.name}: your troops {odds.attack.total} against a garrison of{' '}
                {odds.defence.total}. The troops land whatever happens, and the transports are used up.
              </p>
              <table className="breakdown">
                <tbody>
                  {odds.attack.lines.map((line) => (
                    <tr key={`a-${line.source}`}>
                      <td>Troops: {line.source}</td>
                      <td className="num">{lineValue(line)}</td>
                    </tr>
                  ))}
                  {odds.defence.lines.map((line) => (
                    <tr key={`d-${line.source}`}>
                      <td>Garrison: {line.source}</td>
                      <td className="num">{lineValue(line)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {odds.waitingFor && <p className="muted hint">{odds.waitingFor}. Until then the troops wait in orbit.</p>}
            </div>
          )}
          <p className="muted hint">
            Right-click the map, or press Move and click, to send this fleet. The highlighted sectors are in supply
            range.{hasColonyShip && ' Move it to an unclaimed system, then choose Found colony there.'}
            {invade === null &&
              fleet.ships.some((s) => (content.hulls[s.hull]?.troops ?? 0) > 0) &&
              ' Move transports to an enemy colony or a minor race, then choose Invade there.'}
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
                    {hull && <HullIcon role={hull.role} tier={hull.tier} color={faction.color} />} {hull?.name ?? ship.hull}
                  </span>
                  <span className="muted">
                    {hull ? ROLE_LABELS[hull.role] : 'Unknown'} · {hull && hull.attack > 0 ? `attack ${hull.attack}` : 'unarmed'} · hull {ship.hp} /{' '}
                    {hull?.hp ?? '?'}
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
