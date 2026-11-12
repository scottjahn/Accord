// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../../src/data';
import { AUTOSAVE_KEY } from '../../src/game/persistence';
import {
  coloniesOf,
  deserialize,
  fleetsOf,
  validateCommand,
  type EmpireId,
  type GameState,
  type Sector,
  type StarSystem,
} from '../../src/sim';
import { App } from '../../src/ui/App';

/**
 * Exit tests for milestones 2 and 3, played through the real UI on the shipped
 * content: one human turn is fully playable, and you can expand and build a navy.
 * The PixiJS canvas cannot run in jsdom, so the map is replaced by two buttons
 * per system (click, and right-click to send a fleet); everything else is real.
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

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const turn = () => screen.getByTestId('turn').textContent;
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const endTurn = () => fireEvent.click(button('End turn'));
const autosave = (): GameState => {
  const loaded = deserialize(localStorage.getItem(AUTOSAVE_KEY)!);
  if (!loaded.ok) throw new Error(loaded.error.message);
  return loaded.value;
};
/** Ends turns until the condition holds, failing if it takes more than `limit` turns. */
function endTurnsUntil(done: (state: GameState) => boolean, limit: number): void {
  for (let i = 0; i < limit && !done(autosave()); i++) endTurn();
  expect(done(autosave())).toBe(true);
}

function startGame() {
  render(<App />);
  fireEvent.click(screen.getByRole('radio', { name: /Vashran Dominate/ }));
  fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '7' } });
  fireEvent.click(button('Start game'));
}

describe('one human turn', () => {
  it('starts on the setup screen with no saved game', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Accord of Stars' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue game' })).toBeNull();
    expect(screen.getByRole('radio', { name: /The Concord/ })).toBeTruthy();
  });

  it('plays a full turn: inspect home, assign workers, queue a building, end turn', () => {
    startGame();

    // The game opens on turn 1 with the home system selected and the starting ships docked.
    expect(turn()).toBe('1');
    expect(screen.getAllByText('Vashran Dominate').length).toBeGreaterThan(0);
    expect(screen.getByText(/home system/)).toBeTruthy();
    expect(screen.getByTestId('population').textContent).toBe('10 / 58');
    expect(screen.getByTestId('support').textContent).toBe('3 / 8');
    expect(screen.getByTestId('idle-fleets').textContent).toBe('2');
    expect(screen.queryByText(/Turn \d+ report/)).toBeNull();

    // Queue a building and hand the colony to the industry governor.
    fireEvent.click(button('Build Farm'));
    fireEvent.click(screen.getByRole('radio', { name: 'Industry' }));
    const industry = Number(screen.getByTestId('total-industry').textContent);
    expect(industry).toBeGreaterThan(0);

    // Take workers off research by hand, then give the colony back to the governor.
    const research = screen.getByLabelText('Research workers') as HTMLInputElement;
    const before = Number(research.value);
    fireEvent.change(research, { target: { value: '0' } });
    expect(screen.getByTestId('idle').textContent).toBe(before > 0 ? `${before} idle` : 'Everyone is working');
    fireEvent.click(screen.getByRole('radio', { name: 'Industry' }));

    endTurn();

    // The turn resolved: counter, report, build progress and autosave all moved.
    expect(turn()).toBe('2');
    expect(screen.getByRole('heading', { name: 'Turn 1 report' })).toBeTruthy();
    const queue = screen.getByRole('list', { name: 'Build queue items' });
    expect(within(queue).getByText(new RegExp(`^${industry} / 40 · `))).toBeTruthy();

    const saved = autosave();
    expect(saved.turn).toBe(2);
    const [human, ai] = Object.values(saved.empires);
    expect(human).toMatchObject({ faction: 'vashran', controller: 'human' });
    // The AI opponent took its own turn.
    expect(ai.controller).toBe('ai');
    expect(saved.systems[ai.homeSystem].colony!.buildQueue.length).toBeGreaterThan(0);
  });

  it('keeps playing turn after turn until the building completes', () => {
    startGame();
    fireEvent.click(button('Build Farm'));
    const farms = (s: GameState) => (s.systems[s.empires[HUMAN].homeSystem].colony!.buildings as Record<string, number>).farm;
    endTurnsUntil((s) => farms(s) === 2, 20);
    expect(screen.getByText(/Nothing queued/)).toBeTruthy();
  });

  it('hides systems the player has not scanned', () => {
    startGame();
    const state = autosave();
    const enemyHome = state.systems[Object.values(state.empires)[1].homeSystem];
    fireEvent.click(button(enemyHome.name));
    expect(screen.getByRole('heading', { name: 'Unexplored system' })).toBeTruthy();
    expect(screen.queryByText(/The Concord/)).toBeNull();
    expect(screen.queryByLabelText('Food workers')).toBeNull();
  });

  it('returns to the menu and continues the autosaved game', () => {
    startGame();
    endTurn();
    endTurn();
    fireEvent.click(button('Main menu'));

    expect(screen.getByText(/Vashran Dominate, turn 3, normal, seed 7/)).toBeTruthy();
    fireEvent.click(button('Continue game'));
    expect(turn()).toBe('3');
  });

  it('starts a game at the chosen difficulty', () => {
    render(<App />);
    expect((screen.getByLabelText('Difficulty') as HTMLSelectElement).value).toBe('normal');
    fireEvent.change(screen.getByLabelText('Difficulty'), { target: { value: 'hard' } });
    fireEvent.click(button('Start game'));
    expect(autosave().difficulty).toBe('hard');
  });

  it('rejects an invalid seed', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '-4' } });
    fireEvent.click(button('Start game'));
    expect(screen.getByRole('alert').textContent).toMatch(/Seed must be/);
    expect(screen.queryByTestId('turn')).toBeNull();
  });
});

describe('expand and build a navy', () => {
  /** A free system the starting colony ship is allowed to settle. */
  function settleTarget(state: GameState): StarSystem {
    const settlers = fleetsOf(state, HUMAN).find((f) => f.ships.some((s) => s.hull === 'colony_ship'))!;
    const target = Object.values(state.systems).find(
      (s) => !validateCommand(state, { type: 'coloniseSystem', empire: HUMAN, fleet: settlers.id, system: s.id }, content),
    );
    if (!target) throw new Error('This seed has no free system in reach of the home system');
    return target;
  }

  it('sends the starting colony ship to found a second colony', () => {
    startGame();
    const target = settleTarget(autosave());

    fireEvent.click(button('Select fleet: Colony Ship'));
    expect(screen.getByRole('heading', { name: 'Your fleet' })).toBeTruthy();
    expect(screen.getByTestId('fleet-status').textContent).toBe('Holding position');

    fireEvent.click(button(`Send to ${target.name}`));
    expect(screen.getByTestId('fleet-status').textContent).toMatch(new RegExp(`^Heading to ${target.name} to colonise · \\d+ turns?$`));
    expect(screen.getByTestId('idle-fleets').textContent).toBe('1');

    endTurnsUntil((s) => coloniesOf(s, HUMAN).length === 2, 8);
    expect(screen.getByText(`Colony founded at ${target.name}`)).toBeTruthy();
    // The colony ship was used up, so the fleet panel has nothing left to show.
    expect(screen.getByText('Select a system or a fleet on the map.')).toBeTruthy();

    fireEvent.click(button(target.name));
    expect(screen.getByRole('heading', { name: target.name })).toBeTruthy();
    expect(screen.getByTestId('population').textContent).toMatch(/^2 \/ \d+$/);
    expect(screen.getByText('Build a Shipyard here to construct ships.')).toBeTruthy();
  });

  it('refuses to send a fleet outside supply range and says why', () => {
    startGame();
    const state = autosave();
    const enemyHome = state.systems[Object.values(state.empires)[1].homeSystem];
    fireEvent.click(button('Select fleet: Scout'));
    fireEvent.click(button(`Send to ${enemyHome.name}`));
    expect(screen.getByRole('alert').textContent).toBe('That sector is outside supply range');
    expect(screen.getByTestId('fleet-status').textContent).toBe('Holding position');
  });

  it('moves a fleet with the Move button and a normal click', () => {
    startGame();
    const target = settleTarget(autosave());
    fireEvent.click(button('Select fleet: Scout'));
    fireEvent.click(button('Move'));
    expect(button('Pick a sector…').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button(target.name));
    expect(screen.getByTestId('fleet-status').textContent).toMatch(new RegExp(`^Heading to ${target.name} · 1 turn$`));
    endTurn();
    expect(screen.getByText(`Fleet arrived at ${target.name}`)).toBeTruthy();
  });

  it('builds a warship at the home shipyard', () => {
    startGame();
    fireEvent.click(button('Build Frigate'));
    expect(screen.getByTestId('support').textContent).toBe('5 / 8');
    const frigates = (s: GameState) => fleetsOf(s, HUMAN).flatMap((f) => f.ships).filter((x) => x.hull === 'frigate').length;
    endTurnsUntil((s) => frigates(s) === 1, 30);
    expect(screen.getByText(/Frigate launched/)).toBeTruthy();
    expect(button('Select fleet: Frigate')).toBeTruthy();
  });

  it('researches a field to its next level', () => {
    startGame();
    fireEvent.click(button('Research'));
    const dialog = screen.getByRole('dialog', { name: 'Research' });
    fireEvent.change(within(dialog).getByLabelText('Weapons share'), { target: { value: '100' } });
    expect(autosave().empires[HUMAN].research.allocation.weapons).toBe(100);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    endTurnsUntil((s) => s.empires[HUMAN].research.levels.weapons >= 1, 40);
    expect(screen.getByText('Weapons reached level 1')).toBeTruthy();
    fireEvent.click(button('Research'));
    expect(screen.getByTestId('level-weapons').textContent).toBe('Level 1 / 10');
  });
});
