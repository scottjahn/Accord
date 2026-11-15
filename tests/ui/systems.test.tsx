// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startNewGame } from '../../src/game/session';
import { systemRows, type GameState, type MinorId, type SystemId } from '../../src/sim';
import { SystemsScreen } from '../../src/ui/system/SystemsScreen';
import { ALPHA, BETA, addFleet, fixtureContent, homeOf } from '../fixture';

afterEach(cleanup);

/**
 * Alpha is the player. Besides its home (room 40, food +5%, energy +5%) it has
 * scanned three more systems, renamed so the expected order is easy to read:
 *   Ample  free, room 30, food +20%, energy 0%
 *   Bleak  free, room 8,  food -10%, energy +15%
 *   Sages  a minor race's home, room 12, population 8
 */
function setup(prepare?: (state: GameState, content: ReturnType<typeof fixtureContent>) => void) {
  const content = fixtureContent();
  const state = startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' });
  const home = homeOf(state, ALPHA);
  home.name = 'Home';
  for (const id of Object.keys(state.empires[ALPHA].knownSystems) as SystemId[]) {
    if (id !== home.id) delete state.empires[ALPHA].knownSystems[id];
  }
  // Keep everything else out of the home's scan range so only these four are known.
  const others = Object.values(state.systems).filter((s) => !s.colony);
  others.forEach((s, i) => (s.sector = { x: home.sector.x < 4 ? 7 : 0, y: i % 6 }));
  const [ample, bleak, sages] = others;
  Object.assign(ample, { name: 'Ample', planets: [{ type: 'terran', maxPopulation: 30, foodBonus: 20, energyBonus: 0 }] });
  Object.assign(bleak, {
    name: 'Bleak',
    planets: [
      { type: 'barren', maxPopulation: 5, foodBonus: -5, energyBonus: 5 },
      { type: 'barren', maxPopulation: 3, foodBonus: -5, energyBonus: 10 },
    ],
  });
  Object.assign(sages, { name: 'Sageholm', planets: [{ type: 'terran', maxPopulation: 12, foodBonus: 0, energyBonus: 0 }] });
  sages.minor = { race: 'sages' as MinorId, population: 8, attitude: {}, leader: null, leadTurns: 0 };
  for (const s of [ample, bleak, sages]) state.empires[ALPHA].knownSystems[s.id] = null;
  prepare?.(state, content);

  const onSelect = vi.fn<(id: SystemId) => void>();
  const onClose = vi.fn();
  render(<SystemsScreen state={state} content={content} player={ALPHA} onSelect={onSelect} onClose={onClose} />);
  return { state, content, onSelect, onClose, ample, bleak, sages, home };
}

const names = () =>
  within(screen.getByRole('table'))
    .getAllByRole('rowheader')
    .map((cell) => within(cell).getByRole('button').textContent);
const header = (label: string) => screen.getByRole('columnheader', { name: new RegExp(`^${label}`) });
const sortBy = (label: string) => fireEvent.click(within(header(label)).getByRole('button'));
const cells = (name: string) =>
  within(screen.getByRole('button', { name }).closest('tr')!)
    .getAllByRole('cell')
    .map((c) => c.textContent);

describe('the systems list', () => {
  it('lists every scanned system, roomiest first, and nothing fog hides', () => {
    const { state } = setup();
    expect(names()).toEqual(['Home', 'Ample', 'Sageholm', 'Bleak']);
    expect(header('Room').getAttribute('aria-sort')).toBe('descending');
    expect(screen.getByText('4 of 4 systems you have scanned. Click a column to sort, or a system to go to it.')).toBeTruthy();
    expect(screen.queryByText(homeOf(state, BETA).name)).toBeNull();
  });

  it('shows each system’s figures', () => {
    setup();
    // Status, planets, room, people, food, energy, distance.
    expect(cells('Home')).toEqual(['Yours', '2', '40', '10', '+5%', '+5%', '0']);
    expect(cells('Ample').slice(0, 6)).toEqual(['Free', '1', '30', '?', '+20%', '0%']);
    expect(cells('Bleak').slice(1, 6)).toEqual(['2', '8', '?', '-10%', '+15%']);
    expect(cells('Sageholm').slice(0, 4)).toEqual(['Sages', '1', '12', '8']);
  });

  it('sorts by any column, and a second click reverses it', () => {
    setup();
    sortBy('Food');
    expect(names()).toEqual(['Ample', 'Home', 'Sageholm', 'Bleak']);
    expect(header('Food').getAttribute('aria-sort')).toBe('descending');
    expect(header('Room').getAttribute('aria-sort')).toBe('none');
    sortBy('Food');
    expect(names()).toEqual(['Bleak', 'Sageholm', 'Home', 'Ample']);
    expect(header('Food').getAttribute('aria-sort')).toBe('ascending');

    sortBy('Energy');
    expect(names()[0]).toBe('Bleak');
    sortBy('System');
    expect(names()).toEqual(['Ample', 'Bleak', 'Home', 'Sageholm']); // text columns start A to Z
    sortBy('Planets');
    expect(names().slice(0, 2).sort()).toEqual(['Bleak', 'Home']);
  });

  it('filters to free systems, your own, or everyone else’s', () => {
    setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Free to settle' }));
    expect(names()).toEqual(['Ample', 'Bleak']);
    fireEvent.click(screen.getByRole('radio', { name: 'Yours' }));
    expect(names()).toEqual(['Home']);
    fireEvent.click(screen.getByRole('radio', { name: 'Others' }));
    expect(names()).toEqual(['Sageholm']);
    fireEvent.click(screen.getByRole('radio', { name: 'All known' }));
    expect(names()).toHaveLength(4);
  });

  it('marks free systems that are in supply range, and gives the distance', () => {
    const { home } = setup((s) => {
      const ample = Object.values(s.systems).find((x) => x.name === 'Ample')!;
      const start = homeOf(s, ALPHA).sector;
      ample.sector = { x: start.x + (start.x < 6 ? 2 : -2), y: start.y };
    });
    expect(cells('Ample')[0]).toBe('Free, in range');
    expect(cells('Ample')[6]).toBe('2');
    expect(cells('Bleak')[0]).toBe('Free');
    expect(home.name).toBe('Home');
  });

  it('shows a rival colony’s people only while it is in sight', () => {
    const hidden = setup((s) => {
      s.empires[ALPHA].knownSystems[homeOf(s, BETA).id] = BETA;
      homeOf(s, BETA).name = 'Rivalhome';
    });
    expect(cells('Rivalhome').slice(0, 4)).toEqual(['Beta', '2', '40', '?']);
    expect(hidden.state.empires[ALPHA].knownSystems[homeOf(hidden.state, BETA).id]).toBe(BETA);
    cleanup();

    setup((s, c) => {
      homeOf(s, BETA).name = 'Rivalhome';
      addFleet(s, c, ALPHA, homeOf(s, BETA).sector, ['scout']);
    });
    expect(cells('Rivalhome')[3]).toBe('10');
  });

  it('lists the planets one by one, with each planet’s own figures', () => {
    const { onSelect, bleak } = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Planets' }));
    const table = screen.getAllByRole('table').find((t) => !t.closest('[hidden]'))!;
    const planetNames = () =>
      within(table)
        .getAllByRole('rowheader')
        .map((cell) => within(cell).getByRole('button').textContent);
    const row = (name: string) =>
      within(within(table).getByRole('button', { name }).closest('tr')!)
        .getAllByRole('cell')
        .map((c) => c.textContent);
    // Home has two planets, Bleak two, Ample and Sageholm one each.
    expect(planetNames()).toHaveLength(6);
    expect(screen.getByText('6 of 6 planets in systems you have scanned. Click a column to sort, or a planet to go to its system.')).toBeTruthy();
    // Type, status, room, food, energy.
    expect(row('Ample 1').slice(0, 5)).toEqual(['Terran', 'Free', '30', '+20%', '0%']);
    expect(row('Bleak 1').slice(0, 5)).toEqual(['Barren', 'Free', '5', '-5%', '+5%']);
    expect(row('Bleak 2').slice(0, 5)).toEqual(['Barren', 'Free', '3', '-5%', '+10%']);
    expect(row('Sageholm 1').slice(0, 3)).toEqual(['Terran', 'Sages', '12']);
    // Roomiest first to begin with; sorting and filtering work as for systems.
    expect(planetNames()[0]).toBe('Ample 1');
    fireEvent.click(within(within(table).getByRole('columnheader', { name: /^Energy/ })).getByRole('button'));
    expect(planetNames()[0]).toBe('Bleak 2');
    fireEvent.click(screen.getByRole('radio', { name: 'Free to settle' }));
    expect(planetNames().sort()).toEqual(['Ample 1', 'Bleak 1', 'Bleak 2']);
    fireEvent.click(within(table).getByRole('button', { name: 'Bleak 2' }));
    expect(onSelect).toHaveBeenCalledWith(bleak.id);
  });

  it('jumps to a system when its name is clicked', () => {
    const { onSelect, onClose, ample } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Ample' }));
    expect(onSelect).toHaveBeenCalledWith(ample.id);
    expect(onClose).toHaveBeenCalled();
  });

  it('is built from what the empire knows', () => {
    const { state, content } = setup();
    const rows = systemRows(state, ALPHA, content);
    expect(rows.map((r) => r.name).sort()).toEqual(['Ample', 'Bleak', 'Home', 'Sageholm']);
    expect(rows.find((r) => r.name === 'Home')).toMatchObject({ status: 'yours', owner: ALPHA, room: 40, population: 10, distance: 0, inRange: true });
    expect(systemRows(state, BETA, content).some((r) => r.name === 'Ample')).toBe(false);
  });
});
