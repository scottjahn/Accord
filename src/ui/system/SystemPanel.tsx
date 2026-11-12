import {
  garrisonStrength,
  inUnrest,
  moraleBreakdown,
  forecastColony,
  getColonyEconomy,
  sameSector,
  type Command,
  type CommandError,
  type Content,
  type EmpireId,
  type EmpireView,
  type FleetId,
  type GameState,
  type StarSystem,
} from '../../sim';
import { bonusText, lineValue, sectorLabel, ships, signed, turns } from '../format';
import { MinorPanel } from './MinorPanel';
import { AllocationSliders } from './AllocationSliders';
import { BuildQueue } from './BuildQueue';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  /** What the player can see; the panel shows nothing beyond it. */
  view: EmpireView;
  system: StarSystem;
  /** The most recent rejected command, shown to the player. */
  error: CommandError | null;
  dispatch: (command: Command) => boolean;
  onSelectFleet: (id: FleetId) => void;
}

export function SystemPanel(props: Props) {
  const { state, content, player, view, system, onSelectFleet } = props;
  const sight = view.systems[system.id];
  const fleets = view.fleets.filter((f) => sameSector(f.sector, system.sector));

  const fleetList = fleets.length > 0 && (
    <section>
      <h3>Fleets here</h3>
      <ul className="building-list">
        {fleets.map((fleet) => {
          const faction = content.factions[state.empires[fleet.owner].faction];
          const names = fleet.ships.map((s) => content.hulls[s.hull]?.name ?? s.hull).join(', ');
          return (
            <li key={fleet.id}>
              <div className="building-info">
                <span>
                  <span className="dot" style={{ background: faction.color }} /> {names}
                </span>
                <span className="muted">
                  {fleet.owner === player ? 'Yours' : faction.name} · {ships(fleet.ships.length)}
                  {fleet.destination && ' · under way'}
                </span>
              </div>
              <button type="button" className="btn small" aria-label={`Select fleet: ${names}`} onClick={() => onSelectFleet(fleet.id)}>
                Select
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );

  if (!sight?.known) {
    return (
      <div className="system-panel">
        <header className="system-head">
          <h2>Unexplored system</h2>
          <p className="muted">Sector {sectorLabel(system.sector)}</p>
        </header>
        <p className="muted">Bring a ship or a colony within scan range to find out what is here.</p>
        {fleetList}
      </div>
    );
  }

  const colony = sight.visible ? system.colony : null;
  const owner = sight.owner ? state.empires[sight.owner] : null;
  const ownerFaction = owner ? content.factions[owner.faction] : null;
  const mine = colony?.owner === player;

  return (
    <div className="system-panel">
      <header className="system-head">
        <h2>{system.name}</h2>
        <p className="muted">
          Sector {sectorLabel(system.sector)}
          {' · '}
          {ownerFaction ? (
            <>
              <span className="dot" style={{ background: ownerFaction.color }} /> {ownerFaction.name}
              {owner?.homeSystem === system.id ? ' home system' : ''}
            </>
          ) : system.minor ? (
            `Home of the ${content.minors[system.minor.race]?.name ?? 'an independent people'}`
          ) : (
            'Unclaimed'
          )}
          {!sight.visible && ' (last seen)'}
        </p>
      </header>

      <section>
        <h3>Planets</h3>
        <ul className="planet-list">
          {system.planets.map((planet, i) => (
            <li key={i}>
              <span>{content.planetTypes[planet.type]?.name ?? planet.type}</span>
              <span className="muted">
                pop {planet.maxPopulation}
                {planet.foodBonus !== 0 && ` · food ${signed(planet.foodBonus)}%`}
                {planet.energyBonus !== 0 && ` · energy ${signed(planet.energyBonus)}%`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {fleetList}

      {system.minor && <MinorPanel state={state} content={content} player={player} system={system} dispatch={props.dispatch} />}

      {colony && !mine && (
        <section>
          <h3>Colony</h3>
          <p>Population {colony.population}</p>
        </section>
      )}

      {colony && mine && <OwnColony {...props} />}
    </div>
  );
}

/** The colony's mood and every cause of it. */
function Morale({ state, system, content }: { state: GameState; system: StarSystem; content: Content }) {
  const colony = system.colony!;
  const morale = moraleBreakdown(state, system, content);
  const effect = Math.trunc(((morale.total - 100) * content.rules.morale.outputPercent) / 100);
  const member = colony.minorRace ? content.minors[colony.minorRace] : null;
  return (
    <section>
      <h3>Morale</h3>
      <table className="breakdown">
        <tbody>
          {morale.lines.map((line, i) => (
            <tr key={i}>
              <td>{line.source}</td>
              <td className="num">{line.kind === 'base' ? line.value : signed(line.value)}</td>
            </tr>
          ))}
          <tr className="breakdown-total">
            <td>Morale</td>
            <td className="num" data-testid="morale">
              {morale.total}
            </td>
          </tr>
        </tbody>
      </table>
      <p className={inUnrest(colony, content) ? 'bad hint' : 'muted hint'} data-testid="morale-effect">
        {effect === 0 ? 'No effect on output.' : `${signed(effect)}% to every output.`}
        {inUnrest(colony, content) && ' Unrest: the colony will not grow.'}
      </p>
      {member && (
        <p className="hint">
          Home of the {member.name}, who joined you: {bonusText(member, content)}.
        </p>
      )}
    </section>
  );
}

/** What stands between this colony and an invader, with its causes. */
function Defence({ state, system, content }: { state: GameState; system: StarSystem; content: Content }) {
  const garrison = garrisonStrength(system, content, state);
  const batteries = Object.entries(system.colony!.buildings)
    .filter(([id]) => (content.buildings[id as keyof typeof content.buildings]?.combat.attack ?? 0) > 0)
    .reduce((sum, [, count]) => sum + count, 0);
  return (
    <section>
      <h3>Defence</h3>
      <table className="breakdown">
        <tbody>
          {garrison.lines.map((line, i) => (
            <tr key={i}>
              <td>{line.source}</td>
              <td className="num">{lineValue(line)}</td>
            </tr>
          ))}
          <tr className="breakdown-total">
            <td>Garrison</td>
            <td className="num" data-testid="garrison">
              {garrison.total}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="muted hint">
        {batteries === 0 ? 'No orbital batteries.' : `${batteries} orbital ${batteries === 1 ? 'battery defends' : 'batteries defend'} this sector.`} An
        invader needs more troops than the garrison.
      </p>
    </section>
  );
}

function OwnColony({ state, content, player, system, error, dispatch }: Props) {
  const colony = system.colony!;
  const economy = getColonyEconomy(state, system.id, content);
  const forecast = forecastColony(state, system, content);

  let outlook: { text: string; tone: 'good' | 'bad' | 'flat' };
  if (forecast.turnsToStarve !== null) {
    outlook = { text: `Food runs out in ${turns(forecast.turnsToStarve)}`, tone: 'bad' };
  } else if (forecast.turnsToGrow !== null) {
    outlook = { text: `Grows in ${turns(forecast.turnsToGrow)}`, tone: 'good' };
  } else if (colony.population >= economy.maxPopulation) {
    outlook = { text: 'At capacity', tone: 'flat' };
  } else {
    outlook = { text: 'Not growing', tone: 'flat' };
  }

  return (
    <>
      <section>
        <h3>Population</h3>
        <dl className="stat-grid">
          <div>
            <dt>People</dt>
            <dd data-testid="population">
              {colony.population} / {economy.maxPopulation}
            </dd>
          </div>
          <div>
            <dt>Food</dt>
            <dd>
              {signed(forecast.foodSurplus)} per turn · {colony.foodStock} stored
            </dd>
          </div>
          <div>
            <dt>Energy</dt>
            <dd>
              {economy.energyUsed} of {economy.outputs.energy.total} used
            </dd>
          </div>
        </dl>
        <p className={`outlook ${outlook.tone}`} data-testid="outlook">
          {outlook.text}
        </p>
      </section>

      <Morale state={state} system={system} content={content} />
      <Defence state={state} system={system} content={content} />

      {error && (
        <p className="error" role="alert">
          {error.message}
        </p>
      )}

      <AllocationSliders colony={colony} economy={economy} idle={forecast.idleWorkers} player={player} systemId={system.id} dispatch={dispatch} />
      <BuildQueue state={state} colony={colony} content={content} forecast={forecast} player={player} systemId={system.id} dispatch={dispatch} />
    </>
  );
}
