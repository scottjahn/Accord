// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_KEY } from '../../src/game/persistence';
import { deserialize, type GameState, type SystemId } from '../../src/sim';
import { App } from '../../src/ui/App';

/**
 * Milestone 2 exit test: one human turn is fully playable through the UI, on
 * the shipped content. The PixiJS canvas cannot run in jsdom, so the map is
 * replaced by a list of system buttons; everything else is the real app.
 */
vi.mock('../../src/ui/map/GalaxyMap', () => ({
  GalaxyMap: ({ state, onSelect }: { state: GameState; onSelect: (id: SystemId) => void }) => (
    <ul aria-label="systems">
      {Object.values(state.systems).map((system) => (
        <li key={system.id}>
          <button type="button" onClick={() => onSelect(system.id)}>
            {system.name}
          </button>
        </li>
      ))}
    </ul>
  ),
}));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const turn = () => screen.getByTestId('turn').textContent;
const autosave = (): GameState => {
  const loaded = deserialize(localStorage.getItem(AUTOSAVE_KEY)!);
  if (!loaded.ok) throw new Error(loaded.error.message);
  return loaded.value;
};

function startGame() {
  render(<App />);
  fireEvent.click(screen.getByRole('radio', { name: /Vashran Dominate/ }));
  fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
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

    // The game opens on turn 1 with the home system selected.
    expect(turn()).toBe('1');
    expect(screen.getAllByText('Vashran Dominate').length).toBeGreaterThan(0);
    expect(screen.getByText(/home system/)).toBeTruthy();
    expect(screen.getByTestId('population').textContent).toBe('10 / 58');
    expect(screen.queryByText(/Turn \d+ report/)).toBeNull();

    // Queue a building and hand the colony to the industry governor.
    fireEvent.click(screen.getByRole('button', { name: 'Build Farm' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Industry' }));
    const industry = Number(screen.getByTestId('total-industry').textContent);
    expect(industry).toBeGreaterThan(0);

    // Take a worker off research by hand.
    const research = screen.getByLabelText('Research workers') as HTMLInputElement;
    const before = Number(research.value);
    fireEvent.change(research, { target: { value: '0' } });
    expect(screen.getByTestId('idle').textContent).toBe(before > 0 ? `${before} idle` : 'Everyone is working');
    fireEvent.click(screen.getByRole('radio', { name: 'Industry' }));

    fireEvent.click(screen.getByRole('button', { name: 'End turn' }));

    // The turn resolved: counter, report, build progress, pools and autosave all moved.
    expect(turn()).toBe('2');
    expect(screen.getByRole('heading', { name: 'Turn 1 report' })).toBeTruthy();
    const queue = screen.getByRole('list', { name: 'Queued buildings' });
    expect(within(queue).getByText(new RegExp(`^${industry} / 40 · `))).toBeTruthy();

    const saved = autosave();
    expect(saved.turn).toBe(2);
    const [human, ai] = Object.values(saved.empires);
    expect(human).toMatchObject({ faction: 'vashran', controller: 'human' });
    expect(Number(screen.getByTestId('research-pool').textContent)).toBe(human.researchPool);
    // The AI opponent took its own turn.
    expect(ai.controller).toBe('ai');
    expect(saved.systems[ai.homeSystem].colony!.buildQueue.length).toBeGreaterThan(0);
  });

  it('keeps playing turn after turn until the building completes', () => {
    startGame();
    fireEvent.click(screen.getByRole('button', { name: 'Build Farm' }));
    for (let i = 0; i < 12; i++) fireEvent.click(screen.getByRole('button', { name: 'End turn' }));
    expect(turn()).toBe('13');
    const home = autosave();
    const colony = home.systems[Object.values(home.empires)[0].homeSystem].colony!;
    expect((colony.buildings as Record<string, number>).farm).toBe(2);
    expect(screen.getByText(/Nothing queued/)).toBeTruthy();
  });

  it('inspects other systems from the map', () => {
    startGame();
    const state = autosave();
    const unclaimed = Object.values(state.systems).find((s) => !s.colony)!;
    fireEvent.click(screen.getByRole('button', { name: unclaimed.name }));
    expect(screen.getByRole('heading', { name: unclaimed.name })).toBeTruthy();
    expect(screen.getByText(/Unclaimed/)).toBeTruthy();
    expect(screen.queryByLabelText('Food workers')).toBeNull();

    const enemyHome = state.systems[Object.values(state.empires)[1].homeSystem];
    fireEvent.click(screen.getByRole('button', { name: enemyHome.name }));
    expect(screen.getByText(/The Concord home system/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Build Farm' })).toBeNull();
  });

  it('returns to the menu and continues the autosaved game', () => {
    startGame();
    fireEvent.click(screen.getByRole('button', { name: 'End turn' }));
    fireEvent.click(screen.getByRole('button', { name: 'End turn' }));
    fireEvent.click(screen.getByRole('button', { name: 'Main menu' }));

    expect(screen.getByText(/Vashran Dominate, turn 3, seed 7/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue game' }));
    expect(turn()).toBe('3');
  });

  it('rejects an invalid seed', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '-4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Seed must be/);
    expect(screen.queryByTestId('turn')).toBeNull();
  });
});
