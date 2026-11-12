import {
  forecastColony,
  getColonyEconomy,
  type Command,
  type CommandError,
  type Content,
  type EmpireId,
  type GameState,
  type StarSystem,
} from '../../sim';
import { signed, turns } from '../format';
import { AllocationSliders } from './AllocationSliders';
import { BuildQueue } from './BuildQueue';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  system: StarSystem;
  /** The most recent rejected command, shown to the player. */
  error: CommandError | null;
  dispatch: (command: Command) => boolean;
}

export function SystemPanel({ state, content, player, system, error, dispatch }: Props) {
  const colony = system.colony;
  const owner = colony ? state.empires[colony.owner] : null;
  const ownerFaction = owner ? content.factions[owner.faction] : null;
  const mine = colony?.owner === player;

  return (
    <div className="system-panel">
      <header className="system-head">
        <h2>{system.name}</h2>
        <p className="muted">
          Sector {system.sector.x + 1}, {system.sector.y + 1}
          {' · '}
          {ownerFaction ? (
            <>
              <span className="dot" style={{ background: ownerFaction.color }} /> {ownerFaction.name}
              {owner?.homeSystem === system.id ? ' home system' : ''}
            </>
          ) : (
            'Unclaimed'
          )}
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

      {colony && !mine && (
        <section>
          <h3>Colony</h3>
          <p>Population {colony.population}</p>
        </section>
      )}

      {colony && mine && <OwnColony state={state} content={content} player={player} system={system} error={error} dispatch={dispatch} />}
    </div>
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

      {error && (
        <p className="error" role="alert">
          {error.message}
        </p>
      )}

      <AllocationSliders colony={colony} economy={economy} idle={forecast.idleWorkers} player={player} systemId={system.id} dispatch={dispatch} />
      <BuildQueue colony={colony} content={content} forecast={forecast} player={player} systemId={system.id} dispatch={dispatch} />
    </>
  );
}
