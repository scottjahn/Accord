// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../../src/data';
import { AUTOSAVE_KEY } from '../../src/game/persistence';
import { startNewGame } from '../../src/game/session';
import {
  atWar,
  deserialize,
  maxPopulationOf,
  sectorDistance,
  serialize,
  spawnShip,
  updateKnownSystems,
  type BuildingId,
  type EmpireId,
  type GameState,
  type HullId,
  type Sector,
  type StarSystem,
} from '../../src/sim';
import { App } from '../../src/ui/App';

/**
 * Milestone 5 exit test for the player: declare war, win a battle, invade, and
 * see the victory screen, through the real UI on the shipped content. The map
 * canvas is replaced by buttons, as in the other full-app tests.
 */
vi.mock('../../src/ui/map/GalaxyMap', () => ({
  GalaxyMap: ({ state, onSectorClick }: { state: GameState; onSectorClick: (s: Sector, b: 'primary' | 'secondary') => void }) => (
    <ul aria-label="systems">
      {Object.values(state.systems).map((system) => (
        <li key={system.id}>
          <button type="button" onClick={() => onSectorClick(system.sector, 'primary')}>
            {system.name}
          </button>
          <button type="button" onClick={() => onSectorClick(system.sector, 'secondary')}>
            Send to {system.name}
          </button>
        </li>
      ))}
    </ul>
  ),
}));

const content = loadContent();
const HUMAN = 'emp-1' as EmpireId;
const RIVAL = 'emp-2' as EmpireId;

/**
 * A saved game on the brink of war: the player (Vashran) has an outpost two
 * sectors from the Concord home system, with six frigates and six transports
 * docked there. The Concord home is guarded by one frigate.
 */
function saveOnTheBrink(): { outpost: StarSystem; enemyHome: StarSystem } {
  const state = startNewGame(content, { seed: 7, preset: 'small', faction: 'vashran' });
  const enemyHome = state.systems[state.empires[RIVAL].homeSystem];
  const outpost = Object.values(state.systems).find(
    (s) => !s.colony && maxPopulationOf(s) >= 6 && sectorDistance(s.sector, enemyHome.sector) <= 2,
  );
  if (!outpost) throw new Error('This seed has no free system next to the rival home');
  outpost.colony = {
    owner: HUMAN,
    population: 5,
    growthProgress: 0,
    foodStock: 20,
    allocation: { food: 3, industry: 1, energy: 1, intel: 0, research: 0 },
    governor: 'balanced',
    buildings: { ['shipyard' as BuildingId]: 1 },
    buildQueue: [],
    morale: 100,
    moraleEffects: [],
    minorRace: null,
  };
  for (let i = 0; i < 6; i++) spawnShip(state, HUMAN, outpost.sector, 'frigate' as HullId, content);
  for (let i = 0; i < 6; i++) spawnShip(state, HUMAN, outpost.sector, 'transport' as HullId, content);
  spawnShip(state, RIVAL, enemyHome.sector, 'frigate' as HullId, content);
  updateKnownSystems(state, HUMAN, content);
  localStorage.setItem(AUTOSAVE_KEY, serialize(state));
  return { outpost, enemyHome };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const autosave = (): GameState => {
  const loaded = deserialize(localStorage.getItem(AUTOSAVE_KEY)!);
  if (!loaded.ok) throw new Error(loaded.error.message);
  return loaded.value;
};

function resume() {
  const places = saveOnTheBrink();
  render(<App />);
  fireEvent.click(button('Continue game'));
  return places;
}

function declareWar() {
  fireEvent.click(button('Empires'));
  const dialog = screen.getByRole('dialog', { name: 'Empires' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Declare war' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm war on The Concord' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
}

describe('war through the UI', () => {
  it('starts at peace and needs a confirmation to declare war', () => {
    resume();
    fireEvent.click(button('Empires'));
    const dialog = screen.getByRole('dialog', { name: 'Empires' });
    expect(screen.getByTestId(`relation-${RIVAL}`).textContent).toBe('At peace');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Declare war' }));
    expect(atWar(autosave(), HUMAN, RIVAL)).toBe(false); // not until confirmed
    expect(within(dialog).getByText(/no way back to peace/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(atWar(autosave(), HUMAN, RIVAL)).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Declare war' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm war on The Concord' }));
    expect(atWar(autosave(), HUMAN, RIVAL)).toBe(true);
    expect(screen.getByTestId(`relation-${RIVAL}`).textContent).toBe('At war');
    expect(within(dialog).queryByRole('button', { name: 'Declare war' })).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(button('Empires (at war)')).toBeTruthy();
  });

  it('will not invade at peace', () => {
    const { outpost, enemyHome } = resume();
    fireEvent.click(button(outpost.name));
    fireEvent.click(button(/^Select fleet: Troop Transport/));
    fireEvent.click(button(`Send to ${enemyHome.name}`));
    // At peace the click is an ordinary move, not an invasion.
    expect(screen.getByTestId('fleet-status').textContent).toMatch(new RegExp(`^Heading to ${enemyHome.name} · `));
  });

  it('sets a fleet stance', () => {
    const { outpost } = resume();
    fireEvent.click(button(outpost.name));
    fireEvent.click(button(/^Select fleet: Frigate/));
    expect(screen.getByRole('radio', { name: 'Engage' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Raid' }));
    expect(screen.getByRole('radio', { name: 'Raid' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/^Raid: fire on transports/)).toBeTruthy();
    expect(Object.values(autosave().fleets).some((f) => f.owner === HUMAN && f.stance === 'raid')).toBe(true);
  });

  it('shows what defends a colony', () => {
    resume();
    expect(screen.getByTestId('garrison').textContent).toBe('10');
    expect(screen.getByText(/No orbital batteries/)).toBeTruthy();
  });

  it('declares war, wins the battle, invades and wins the game', () => {
    const { outpost, enemyHome } = resume();
    declareWar();

    fireEvent.click(button(outpost.name));
    fireEvent.click(button(/^Select fleet: Frigate/));
    fireEvent.click(button(`Send to ${enemyHome.name}`));
    expect(screen.getByTestId('fleet-status').textContent).toMatch(new RegExp(`^Heading to ${enemyHome.name} · 1 turn$`));

    fireEvent.click(button(outpost.name));
    fireEvent.click(button(/^Select fleet: Troop Transport/));
    fireEvent.click(button(`Send to ${enemyHome.name}`));
    expect(screen.getByTestId('fleet-status').textContent).toMatch(new RegExp(`^Heading to ${enemyHome.name} to invade · 1 turn$`));

    for (let i = 0; i < 6 && autosave().winner === null; i++) fireEvent.click(button('End turn'));
    const final = autosave();
    expect(final.winner).toBe(HUMAN);
    expect(final.systems[enemyHome.id].colony!.owner).toBe(HUMAN);

    // The victory screen.
    const result = screen.getByRole('dialog', { name: 'Game over' });
    expect(within(result).getByRole('heading', { name: 'Victory' })).toBeTruthy();
    fireEvent.click(within(result).getByRole('button', { name: 'Look at the map' }));
    expect(screen.queryByRole('dialog', { name: 'Game over' })).toBeNull();
    expect(button('End turn').disabled).toBe(true);
    expect(screen.getByText('Vashran Dominate has won the game')).toBeTruthy();

    // The battle, shot by shot.
    fireEvent.click(button(new RegExp(`^Battle at ${enemyHome.name}`)));
    const battle = screen.getByRole('dialog', { name: `Battle at ${enemyHome.name}` });
    expect(within(battle).getByRole('heading', { name: 'Round 1' })).toBeTruthy();
    expect(within(battle).getAllByText(/Frigate \(You\) hit Frigate \(The Concord\) for \d+/).length).toBeGreaterThan(0);
    expect(within(battle).getByText(/1 in the fight, 1 lost/)).toBeTruthy();
    fireEvent.click(within(battle).getByRole('button', { name: 'Close' }));

    // The invasion, with both strengths explained.
    fireEvent.click(button(`Vashran Dominate captured ${enemyHome.name}`));
    const invasion = screen.getByRole('dialog', { name: `Invasion of ${enemyHome.name}` });
    expect(within(invasion).getByText('6 transports')).toBeTruthy();
    expect(within(invasion).getByText(/^Population \d+$/)).toBeTruthy();
    expect(within(invasion).getByText(/Roll \d+%: \d+ of 90 troops counted/)).toBeTruthy();
  });

  it('shows defeat when a rival wins', () => {
    saveOnTheBrink();
    const state = autosave();
    state.winner = RIVAL;
    localStorage.setItem(AUTOSAVE_KEY, serialize(state));
    render(<App />);
    fireEvent.click(button('Continue game'));
    const result = screen.getByRole('dialog', { name: 'Game over' });
    expect(within(result).getByRole('heading', { name: 'Defeat' })).toBeTruthy();
    expect(within(result).getByText('The Concord has won the game.')).toBeTruthy();
    fireEvent.click(within(result).getByRole('button', { name: 'Main menu' }));
    expect(screen.getByRole('heading', { name: 'Accord of Stars' })).toBeTruthy();
  });
});
