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
    unrestTurns: 0,
      pinned: { food: 0, industry: 0, energy: 0, intel: 0, research: 0 },
      capped: { food: null, industry: null, energy: null, intel: null, research: null },
    minorRace: null,
  };
  for (let i = 0; i < 6; i++) spawnShip(state, HUMAN, outpost.sector, 'frigate' as HullId, content);
  for (let i = 0; i < 6; i++) spawnShip(state, HUMAN, outpost.sector, 'transport' as HullId, content);
  spawnShip(state, RIVAL, enemyHome.sector, 'frigate' as HullId, content);
  updateKnownSystems(state, HUMAN, content);
  localStorage.setItem(AUTOSAVE_KEY, serialize(state));
  return { outpost, enemyHome };
}

beforeEach(() => {
  localStorage.clear();
  // The End Turn idle warning has its own tests; everything else here plays straight through.
  localStorage.setItem('accord.skipIdleWarning', '1');
});
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
  fireEvent.click(button('Diplomacy'));
  const dialog = screen.getByRole('dialog', { name: 'Diplomacy' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Declare war' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm war on The Concord' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
}

describe('war through the UI', () => {
  it('starts at peace and needs a confirmation to declare war', () => {
    resume();
    fireEvent.click(button('Diplomacy'));
    const dialog = screen.getByRole('dialog', { name: 'Diplomacy' });
    expect(screen.getByTestId(`relation-${RIVAL}`).textContent).toBe('At peace');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Declare war' }));
    expect(atWar(autosave(), HUMAN, RIVAL)).toBe(false); // not until confirmed
    expect(within(dialog).getByText(/Fleets will fight on sight/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(atWar(autosave(), HUMAN, RIVAL)).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Declare war' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm war on The Concord' }));
    expect(atWar(autosave(), HUMAN, RIVAL)).toBe(true);
    expect(screen.getByTestId(`relation-${RIVAL}`).textContent).toBe('At war');
    expect(within(dialog).queryByRole('button', { name: 'Declare war' })).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(button('Diplomacy (at war)')).toBeTruthy();
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
    expect(screen.getByTestId('garrison').textContent).toBe('14');
    expect(screen.getByText(/No orbital batteries/)).toBeTruthy();
  });

  it('fights a battle in real time instead of auto-resolving it', () => {
    const { outpost, enemyHome } = resume();
    declareWar();
    fireEvent.click(button(outpost.name));
    fireEvent.click(button(/^Select fleet: Frigate/));
    fireEvent.click(button(`Send to ${enemyHome.name}`));
    const turn = autosave().turn;
    fireEvent.click(button('End turn'));

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Battle ahead' })).getByRole('button', { name: 'Fight' }));
    const field = screen.getByRole('dialog', { name: `Battle at ${enemyHome.name}` });
    expect(within(field).getByLabelText('Battlefield')).toBeTruthy();
    // Keys belong to the battle while it is open: Enter does not end the turn underneath it.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(autosave().turn).toBe(turn);

    fireEvent.click(within(field).getByRole('button', { name: 'Select all' }));
    expect(within(field).getByRole('heading', { name: 'Selected (6)' })).toBeTruthy();
    fireEvent.click(within(field).getByRole('button', { name: 'Finish automatically' }));
    expect(within(field).getByRole('heading', { name: 'Victory' })).toBeTruthy();
    fireEvent.click(within(field).getByRole('button', { name: 'Continue' }));

    expect(autosave().turn).toBe(turn + 1);
    fireEvent.click(button(new RegExp(`^Battle at ${enemyHome.name}`)));
    const report = screen.getByRole('dialog', { name: `Battle at ${enemyHome.name}` });
    expect(within(report).getByText(/fought under your command/)).toBeTruthy();
    expect(within(report).queryByRole('heading', { name: 'Round 1' })).toBeNull();
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
    // Sending transports to an enemy colony only moves them; landing is ordered on arrival.
    expect(screen.getByTestId('fleet-status').textContent).toMatch(new RegExp(`^Heading to ${enemyHome.name} · 1 turn$`));
    fireEvent.click(button('End turn'));

    // The turn waits on the battle: fight it, or let it be auto-resolved.
    const ahead = screen.getByRole('dialog', { name: 'Battle ahead' });
    expect(within(ahead).getByRole('heading', { name: `Battle at ${enemyHome.name}` })).toBeTruthy();
    expect(within(ahead).getByText(/^6 Frigate, 6 Troop Transport$/)).toBeTruthy();
    fireEvent.click(within(ahead).getByRole('button', { name: 'Auto-resolve' }));
    expect(screen.queryByRole('dialog', { name: 'Battle ahead' })).toBeNull();
    expect(autosave().systems[enemyHome.id].colony!.owner).toBe(RIVAL);

    // The battle on arrival, shot by shot.
    fireEvent.click(button(new RegExp(`^Battle at ${enemyHome.name}`)));
    const battle = screen.getByRole('dialog', { name: `Battle at ${enemyHome.name}` });
    expect(within(battle).getByRole('heading', { name: 'Round 1' })).toBeTruthy();
    expect(within(battle).getAllByText(/Frigate \(You\) hit Frigate \(The Concord\) for \d+/).length).toBeGreaterThan(0);
    expect(within(battle).getByText(/1 in the fight, 1 lost/)).toBeTruthy();
    fireEvent.click(within(battle).getByRole('button', { name: 'Close' }));

    fireEvent.click(button(enemyHome.name));
    fireEvent.click(button(/^Select fleet: Troop Transport/));
    expect(screen.getByTestId('invasion-odds').textContent).toMatch(/^\d+% chance to take /);
    fireEvent.click(button(new RegExp(`^Invade ${enemyHome.name} \\(\\d+%\\)$`)));
    expect(screen.getByTestId('fleet-status').textContent).toBe('Landing troops once the defenders are cleared');

    for (let i = 0; i < 6 && autosave().winner === null; i++) {
      fireEvent.click(button('End turn'));
      for (const auto of screen.queryAllByRole('button', { name: 'Auto-resolve' })) fireEvent.click(auto);
    }
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

    // The invasion, with both strengths explained.
    fireEvent.click(button(`Vashran Dominate captured ${enemyHome.name}`));
    const invasion = screen.getByRole('dialog', { name: `Invasion of ${enemyHome.name}` });
    expect(within(invasion).getByText('6 transports')).toBeTruthy();
    expect(within(invasion).getByText(/^Population \d+$/)).toBeTruthy();
    expect(within(invasion).getByText(/Roll \d+%: \d+ of \d+ troops counted/)).toBeTruthy();
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
