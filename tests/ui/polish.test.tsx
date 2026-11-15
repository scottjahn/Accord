// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../../src/data';
import { AUTOSAVE_KEY, slotKey } from '../../src/game/persistence';
import { deserialize, victoryPaths, type EmpireId, type GameState, type Sector } from '../../src/sim';
import { App } from '../../src/ui/App';
import { HullIcon } from '../../src/ui/fleet/HullIcon';

/**
 * Milestone 8 part C: the conveniences around the game, played through the
 * real UI on the shipped content. The map is stubbed as in the other UI tests.
 */
vi.mock('../../src/ui/map/GalaxyMap', () => ({
  GalaxyMap: ({ state, onSectorClick }: { state: GameState; onSectorClick: (s: Sector, b: 'primary' | 'secondary') => void }) => (
    <ul aria-label="systems">
      {Object.values(state.systems).map((system) => (
        <li key={system.id}>
          <button type="button" onClick={() => onSectorClick(system.sector, 'primary')}>
            {system.name}
          </button>
        </li>
      ))}
    </ul>
  ),
}));

const content = loadContent();
const HUMAN = 'emp-1' as EmpireId;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('accord.skipIdleWarning', '1');
});
afterEach(cleanup);

const turn = () => Number(screen.getByTestId('turn').textContent);
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const key = (k: string, more: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key: k, ...more });
const autosave = (): GameState => {
  const loaded = deserialize(localStorage.getItem(AUTOSAVE_KEY)!);
  if (!loaded.ok) throw new Error(loaded.error.message);
  return loaded.value;
};

function startGame() {
  render(<App />);
  fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '7' } });
  fireEvent.click(button('Start game'));
}

describe('keyboard', () => {
  it('ends the turn with Enter, but not while typing or with a window open', () => {
    startGame();
    key('Enter');
    expect(turn()).toBe(2);

    key('r');
    expect(screen.getByRole('dialog', { name: 'Research' })).toBeTruthy();
    key('Enter');
    expect(turn()).toBe(2);
    key('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    key('Enter');
    expect(turn()).toBe(3);
  });

  it('opens each page by its letter and closes it with Escape', () => {
    startGame();
    for (const [letter, name] of [
      ['e', 'Empires'],
      ['i', 'Intelligence'],
      ['s', 'Systems'],
      ['g', 'Save game'],
      ['h', 'Help'],
      ['?', 'Help'],
    ]) {
      key(letter);
      expect(screen.getByRole('dialog', { name })).toBeTruthy();
      key('Escape');
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  });

  it('steps through idle colonies and ships with N', () => {
    startGame();
    expect(screen.queryByRole('heading', { name: 'Your fleet' })).toBeNull();
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      key('n');
      seen.add(screen.getByRole('complementary', { name: 'Details' }).querySelector('h2')!.textContent!);
    }
    // The first turn has the home colony's empty queue and ships with no orders.
    expect(seen.has('Your fleet')).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('asks about idle things before a key ends the turn, and Escape goes back', () => {
    localStorage.removeItem('accord.skipIdleWarning');
    startGame();
    key('Enter');
    expect(screen.getByRole('dialog', { name: 'End turn?' })).toBeTruthy();
    expect(turn()).toBe(1);
    key('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    key('Enter', { shiftKey: true });
    fireEvent.click(button('Skip ahead anyway'));
    expect(turn()).toBeGreaterThan(1);
  });
});

describe('skip ahead', () => {
  it('plays turns until something needs the player and reports the whole stretch', () => {
    startGame();
    // Give the home colony plenty to build so its queue does not run dry at once.
    const farm = within(screen.getByRole('complementary', { name: 'Details' })).getAllByRole('button', { name: /^Build / });
    for (const b of farm.slice(0, 3)) if (!(b as HTMLButtonElement).disabled) fireEvent.click(b);
    fireEvent.click(button('Skip ahead'));
    const played = turn() - 1;
    expect(played).toBeGreaterThanOrEqual(1);
    expect(played).toBeLessThanOrEqual(10);
    const heading = within(screen.getByLabelText('Last turn')).getAllByRole('heading')[0].textContent;
    expect(heading).toBe(played > 1 ? `Turns 1 to ${played} report` : 'Turn 1 report');
    expect(autosave().turn).toBe(turn());
  });
});

describe('save slots', () => {
  it('saves into a slot, lists it on the main menu, loads it and deletes it', () => {
    startGame();
    key('Enter');
    fireEvent.click(button('Save'));
    const dialog = within(screen.getByRole('dialog', { name: 'Save game' }));
    expect(within(dialog.getByRole('list', { name: 'Save slots' })).getAllByText('Empty')).toHaveLength(3);
    fireEvent.click(dialog.getByRole('button', { name: 'Save to slot 2' }));
    expect(dialog.getByRole('status').textContent).toBe('Saved to slot 2.');
    expect(dialog.getByText(/^The Concord, turn 2, normal, seed 7$/)).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Save to slot 2' }).textContent).toBe('Overwrite');
    expect(localStorage.getItem(slotKey(2))).not.toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));

    // Play on, then go back to the menu: the slot still holds turn 2.
    key('Enter');
    key('Enter');
    expect(turn()).toBe(4);
    fireEvent.click(button('Main menu'));
    const saved = within(screen.getByRole('list', { name: 'Saved games' }));
    expect(saved.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(saved.getByRole('button', { name: 'Load slot 2' }));
    expect(turn()).toBe(2);

    // Deleting asks twice.
    fireEvent.click(button('Main menu'));
    fireEvent.click(button('Delete slot 2'));
    expect(localStorage.getItem(slotKey(2))).not.toBeNull();
    fireEvent.click(button('Delete slot 2 for good'));
    expect(localStorage.getItem(slotKey(2))).toBeNull();
    expect(screen.queryByRole('list', { name: 'Saved games' })).toBeNull();
  });

  it('says so when the browser will not store the save', () => {
    startGame();
    fireEvent.click(button('Save'));
    const real = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith('accord.slot.')) throw new Error('quota');
      real.call(this, k, v);
    });
    fireEvent.click(button('Save to slot 1'));
    setItem.mockRestore();
    expect(screen.getByRole('status').textContent).toMatch(/^Could not save/);
    expect(button('Download save file')).toBeTruthy();
  });
});

describe('help', () => {
  it('explains the ways to win in this game and lists the keys', () => {
    startGame();
    fireEvent.click(button('Help'));
    const help = within(screen.getByRole('dialog', { name: 'Help' }));
    const ways = within(help.getByRole('list', { name: 'Ways to win explained' }));
    for (const path of victoryPaths(autosave(), HUMAN, content)) expect(ways.getByText(path.note)).toBeTruthy();
    expect(help.getByText('Shift + Enter')).toBeTruthy();
    expect(help.getByText('End the turn')).toBeTruthy();
    fireEvent.click(help.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ship silhouettes', () => {
  it('draws more on each hull generation and a different body for each role', () => {
    const paths = (role: 'warship' | 'scout' | 'colony' | 'transport', tier: number) => {
      const { container } = render(<HullIcon role={role} tier={tier} color="#fff" />);
      const found = [...container.querySelectorAll('path')].map((p) => p.getAttribute('d'));
      cleanup();
      return found;
    };
    expect(paths('warship', 2).length).toBe(paths('warship', 1).length + 1);
    expect(paths('warship', 3).length).toBe(paths('warship', 2).length + 1);
    const bodies = (['warship', 'scout', 'colony', 'transport'] as const).map((role) => paths(role, 1)[1]);
    expect(new Set(bodies).size).toBe(4);
  });

  it('shows one beside every ship in a fleet', () => {
    startGame();
    key('n');
    key('n');
    const panel = screen.getByRole('complementary', { name: 'Details' });
    if (panel.querySelector('h2')!.textContent !== 'Your fleet') key('n');
    const ships = within(panel).getByRole('list', { name: 'Ships in fleet' });
    expect(ships.querySelectorAll('svg.hull-icon').length).toBe(within(ships).getAllByRole('listitem').length);
  });
});
