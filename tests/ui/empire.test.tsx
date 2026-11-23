// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startNewGame } from '../../src/game/session';
import {
  fleetPlan,
  forecastColony,
  getColonyEconomy,
  submitCommand,
  type BuildingId,
  type FleetId,
  type GameState,
  type SystemId,
} from '../../src/sim';
import { EmpireScreen } from '../../src/ui/screens/EmpireScreen';
import { hotkeyAction } from '../../src/ui/hotkeys';
import { ALPHA, BETA, addFleet, fixtureContent, homeOf } from '../fixture';

afterEach(cleanup);

function setup(prepare?: (state: GameState, content: ReturnType<typeof fixtureContent>) => GameState | void) {
  const content = fixtureContent();
  let state = startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' });
  homeOf(state, ALPHA).name = 'Home';
  state = prepare?.(state, content) ?? state;
  const onSelectSystem = vi.fn<(id: SystemId) => void>();
  const onSelectFleet = vi.fn<(id: FleetId) => void>();
  const onClose = vi.fn();
  render(<EmpireScreen state={state} content={content} player={ALPHA} onSelectSystem={onSelectSystem} onSelectFleet={onSelectFleet} onClose={onClose} />);
  return { state, content, onSelectSystem, onSelectFleet, onClose };
}

const rowOf = (name: string | RegExp) =>
  within(screen.getByRole('button', { name }).closest('tr')!)
    .getAllByRole('cell')
    .map((c) => c.textContent);

describe('the empire overview', () => {
  it('lists each colony with the sim’s own figures and what it is building', () => {
    const { state, content } = setup((s) => {
      homeOf(s, ALPHA).colony!.buildQueue = [
        { kind: 'building', building: 'factory' as BuildingId, progress: 0 },
        { kind: 'building', building: 'factory' as BuildingId, progress: 0 },
      ];
    });
    const home = homeOf(state, ALPHA);
    const economy = getColonyEconomy(state, home.id, content);
    const forecast = forecastColony(state, home, content);
    // People, morale, food, industry, research, governor, building, done in, queued.
    expect(rowOf('Home')).toEqual([
      `${home.colony!.population} / ${economy.maxPopulation}`,
      `${home.colony!.morale}`,
      forecast.foodSurplus > 0 ? `+${forecast.foodSurplus}` : `${forecast.foodSurplus}`,
      `${economy.outputs.industry.total}`,
      `${economy.outputs.research.total}`,
      'Balanced',
      forecast.queue[0].name,
      forecast.queue[0].turnsLeft === null ? 'stalled' : `${forecast.queue[0].turnsLeft} turns`,
      '2',
    ]);
    // Only the player's own colonies.
    expect(screen.queryByRole('button', { name: homeOf(state, BETA).name })).toBeNull();
  });

  it('gives turns to finish once the colony has industry', () => {
    const { state, content } = setup((s, c) => {
      const home = homeOf(s, ALPHA);
      home.colony!.buildQueue = [{ kind: 'building', building: 'factory' as BuildingId, progress: 0 }];
      const allocation = { ...home.colony!.allocation, industry: home.colony!.allocation.industry + 4, food: home.colony!.allocation.food - 4 };
      const set = submitCommand(s, { type: 'setAllocation', empire: ALPHA, system: home.id, allocation }, c);
      if (!set.ok) throw new Error(set.error.message);
      return set.value;
    });
    const turnsLeft = forecastColony(state, homeOf(state, ALPHA), content).queue[0].turnsLeft!;
    expect(turnsLeft).toBeGreaterThan(0);
    expect(rowOf('Home')[7]).toBe(turnsLeft === 1 ? '1 turn' : `${turnsLeft} turns`);
  });

  it('marks a colony with nothing to build as needing the player', () => {
    setup((s) => {
      homeOf(s, ALPHA).colony!.buildQueue = [];
    });
    expect(screen.getByLabelText(/^Needs you: Home: nothing in the build queue/)).toBeTruthy();
    expect(rowOf('Home').slice(6, 9)).toEqual(['Nothing', '', '0']);
  });

  it('lists each fleet with its ships, orders and arrival, and jumps to it', () => {
    const { state, content, onSelectFleet, onClose } = setup((s, c) => {
      const home = homeOf(s, ALPHA);
      const fleet = addFleet(s, c, ALPHA, home.sector, ['frigate', 'frigate', 'scout']);
      const to = { x: home.sector.x < 4 ? home.sector.x + 2 : home.sector.x - 2, y: home.sector.y };
      const moved = submitCommand(s, { type: 'moveFleet', empire: ALPHA, fleet: fleet.id, to }, c);
      if (!moved.ok) throw new Error(moved.error.message);
      return moved.value;
    });
    fireEvent.click(screen.getByRole('radio', { name: /^Fleets/ }));
    const fleet = Object.values(state.fleets).find((f) => f.owner === ALPHA && f.destination)!;
    const plan = fleetPlan(state, fleet, fleet.destination!, content)!;
    const table = screen.getByRole('table', { name: 'Fleets' });
    const row = within(table)
      .getAllByRole('row')
      .find((r) => r.textContent!.includes('Frigate'))!;
    const cells = within(row)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells[0]).toContain(`2 ${content.hulls['frigate' as never].name}, ${content.hulls['scout' as never].name}`);
    expect(cells[1]).toMatch(/^Heading to .* · \d+ turns?$/);
    expect(cells[2]).toBe(plan.turns === 1 ? '1 turn' : `${plan.turns} turns`);
    fireEvent.click(within(row).getAllByRole('button')[0]);
    expect(onSelectFleet).toHaveBeenCalledWith(fleet.id);
    expect(onClose).toHaveBeenCalled();
  });

  it('jumps to a colony when its name is clicked', () => {
    const { state, onSelectSystem, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(onSelectSystem).toHaveBeenCalledWith(homeOf(state, ALPHA).id);
    expect(onClose).toHaveBeenCalled();
  });

  it('opens with the O key', () => {
    expect(hotkeyAction({ key: 'o', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, targetTag: null })).toBe('empire');
  });
});
