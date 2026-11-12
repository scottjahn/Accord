// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession, startNewGame, type GameSession } from '../../src/game/session';
import { getEmpireView, type BuildingId, type FleetId, type GameState, type SystemId } from '../../src/sim';
import { SystemPanel } from '../../src/ui/system/SystemPanel';
import { useSession } from '../../src/ui/useSession';
import { ALPHA, BETA, addFleet, colonyOf, fixtureContent } from '../fixture';

afterEach(cleanup);

const onSelectFleet = vi.fn<(id: FleetId) => void>();

function Harness({ session, systemId }: { session: GameSession; systemId: SystemId }) {
  const { state, player, lastError } = useSession(session);
  return (
    <SystemPanel
      state={state}
      content={session.content}
      player={player}
      view={getEmpireView(state, player, session.content)}
      system={state.systems[systemId]}
      error={lastError}
      dispatch={session.dispatch}
      onSelectFleet={onSelectFleet}
    />
  );
}

/**
 * The player is Alpha (emp-1) under the balanced governor: food 5, intel 1, research 4.
 * `prepare` can change the starting state before the panel renders.
 */
function setup(pick: (state: GameState) => SystemId = (s) => s.empires[ALPHA].homeSystem, prepare?: (state: GameState) => void) {
  const content = fixtureContent();
  const state = startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' });
  prepare?.(state);
  const session = createSession(content, state);
  onSelectFleet.mockClear();
  render(<Harness session={session} systemId={pick(state)} />);
  const colony = () => colonyOf(session.getSnapshot().state, ALPHA);
  return { session, content, colony };
}

const enemyHome = (s: GameState) => s.empires[BETA].homeSystem;
const slider = (name: string) => screen.getByLabelText(`${name} workers`) as HTMLInputElement;
const setSlider = (name: string, value: number) => fireEvent.change(slider(name), { target: { value: String(value) } });
const text = (testId: string) => screen.getByTestId(testId).textContent;
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const queueNames = (session: GameSession) =>
  colonyOf(session.getSnapshot().state, ALPHA).buildQueue.map((i) => (i.kind === 'building' ? i.building : i.hull));

describe('SystemPanel: own colony', () => {
  it('shows the colony summary and forecast', () => {
    setup();
    expect(text('population')).toBe('10 / 40');
    expect(text('outlook')).toMatch(/^Grows in \d+ turns?$/);
    expect(screen.getByText('Alpha home system', { exact: false })).toBeTruthy();
    expect(screen.getByText('Terran')).toBeTruthy();
    expect(text('idle')).toBe('Everyone is working');
  });

  it('shows worker counts and totals for every output', () => {
    setup();
    expect(slider('Food').value).toBe('5');
    expect(text('workers-research')).toBe('4');
    // food: (5 x 4 + farm 4) x 105% = 25
    expect(text('total-food')).toBe('25');
    expect(text('total-energy')).toBe('6');
  });

  it('expands an output into the causes behind its total', () => {
    setup();
    expect(screen.queryByText('Farm x1')).toBeNull();
    fireEvent.click(button(/^Food 25, show breakdown/));
    const table = document.getElementById('breakdown-food')!;
    expect(within(table).getByText('5 workers')).toBeTruthy();
    expect(within(table).getByText('Farm x1')).toBeTruthy();
    expect(within(table).getByText('Planet 1 (Terran)')).toBeTruthy();
    expect(within(table).getByText('+10%')).toBeTruthy();
    expect(within(table).getByText('-5%')).toBeTruthy();
    expect(within(table).getByText('Total').nextElementSibling?.textContent).toBe('25');
  });

  it('lists research bonuses in the breakdown', () => {
    setup(undefined, (s) => (s.empires[ALPHA].research.levels.biology = 2));
    fireEvent.click(button(/^Food \d+, show breakdown/));
    expect(within(document.getElementById('breakdown-food')!).getByText('Biology level 2')).toBeTruthy();
  });

  it('moving a slider reassigns workers and switches to the manual governor', () => {
    const { colony } = setup();
    expect(screen.getByRole('radio', { name: 'Balanced' }).getAttribute('aria-checked')).toBe('true');
    setSlider('Research', 1);
    expect(colony().allocation.research).toBe(1);
    expect(colony().governor).toBe('manual');
    expect(screen.getByRole('radio', { name: 'Manual' }).getAttribute('aria-checked')).toBe('true');
    expect(text('idle')).toBe('3 idle');
  });

  it('cannot assign more workers than are idle', () => {
    const { colony } = setup();
    setSlider('Industry', 9);
    expect(colony().allocation.industry).toBe(0); // nobody idle under the governor

    setSlider('Research', 0);
    setSlider('Industry', 9);
    expect(colony().allocation.industry).toBe(4);
    expect(slider('Industry').value).toBe('4');
    expect(text('idle')).toBe('Everyone is working');
  });

  it('choosing a governor reassigns workers', () => {
    const { colony } = setup();
    setSlider('Research', 0);
    fireEvent.click(screen.getByRole('radio', { name: 'Research' }));
    expect(colony().governor).toBe('research');
    expect(colony().allocation.research).toBe(5);
    expect(text('workers-research')).toBe('5');
  });

  it('queues buildings up to the per-system limit and says why it stops', () => {
    const { session } = setup();
    expect(screen.getByText(/Nothing queued/)).toBeTruthy();
    fireEvent.click(button('Build Lab'));
    fireEvent.click(button('Build Lab'));
    expect(queueNames(session)).toEqual(['lab', 'lab']);
    expect(button('Build Lab').disabled).toBe(true);
    expect(button('Build Lab').title).toMatch(/can hold at most 2 Lab/);
    expect(within(screen.getByRole('list', { name: 'Build queue items' })).getAllByText('Lab')).toHaveLength(2);
  });

  it('disables every build button when the queue is full', () => {
    setup();
    for (const name of ['Lab', 'Lab', 'Factory', 'Factory']) fireEvent.click(button(`Build ${name}`));
    expect(button('Build Reactor').disabled).toBe(true);
    expect(button('Build Reactor').title).toBe('Build queue holds at most 4 items');
  });

  it('locks buildings that need research and names the requirement', () => {
    setup();
    expect(button('Build Vault').disabled).toBe(true);
    expect(screen.getByText('Vault needs Computing 1')).toBeTruthy();
  });

  it('shows turns left and reorders and removes queued items', () => {
    const { session } = setup();
    fireEvent.click(button('Build Farm'));
    fireEvent.click(button('Build Lab'));
    const queue = screen.getByRole('list', { name: 'Build queue items' });
    expect(within(queue).getAllByText(/0 \/ \d+ · \d+ turns/)).toHaveLength(2);
    expect(button('Move Farm up').disabled).toBe(true);

    fireEvent.click(button('Move Lab up'));
    expect(queueNames(session)).toEqual(['lab', 'farm']);

    fireEvent.click(button('Remove Lab from queue'));
    expect(queueNames(session)).toEqual(['farm']);
  });

  it('needs a shipyard before it offers ships', () => {
    setup();
    expect(screen.getByText('Build a Shipyard here to construct ships.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Build Scout' })).toBeNull();
  });

  it('queues ships at a shipyard, locking hulls that need research or support', () => {
    const { session } = setup(undefined, (s) => (colonyOf(s, ALPHA).buildings['shipyard' as BuildingId] = 1));
    expect(button('Build Destroyer').disabled).toBe(true);
    expect(screen.getByText('Destroyer needs Weapons 1')).toBeTruthy();

    // Support cap is 6: three frigates (2 each) fill it.
    for (let i = 0; i < 3; i++) fireEvent.click(button('Build Frigate'));
    expect(queueNames(session)).toEqual(['frigate', 'frigate', 'frigate']);
    expect(button('Build Frigate').disabled).toBe(true);
    expect(button('Build Scout').title).toMatch(/Fleet support is 6 of 6/);
    expect(within(screen.getByRole('list', { name: 'Build queue items' })).getAllByText('Frigate')).toHaveLength(3);
  });

  it('warns when buildings have no power', () => {
    const { session } = setup();
    setSlider('Research', 0);
    const state = structuredClone(session.getSnapshot().state);
    colonyOf(state, ALPHA).buildings = { factory: 3, farm: 1 } as never;
    act(() => void session.importSave(JSON.stringify(state)));
    expect(screen.getByRole('status').textContent).toMatch(/Not enough energy: 3 Factory offline, 1 Farm offline/);
  });

  it('shows a rejected command to the player', () => {
    const { session } = setup();
    const home = session.getSnapshot().state.empires[ALPHA].homeSystem;
    act(() => void session.dispatch({ type: 'dequeueBuild', empire: ALPHA, system: home, index: 5 }));
    expect(screen.getByRole('alert').textContent).toMatch(/No build queue item/);
  });

  it('lists fleets at the system and lets the player select one', () => {
    const content = fixtureContent();
    setup(undefined, (s) => {
      addFleet(s, content, ALPHA, s.systems[s.empires[ALPHA].homeSystem].sector, ['scout', 'frigate']);
    });
    expect(screen.getByText('Scout, Frigate')).toBeTruthy();
    expect(screen.getByText(/Yours · 2 ships/)).toBeTruthy();
    fireEvent.click(button('Select fleet: Scout, Frigate'));
    expect(onSelectFleet).toHaveBeenCalledTimes(1);
  });
});

describe('SystemPanel: fog of war', () => {
  it('shows nothing about a system the player has not scanned', () => {
    setup(enemyHome);
    expect(screen.getByRole('heading', { name: 'Unexplored system' })).toBeTruthy();
    expect(screen.queryByText('Planets')).toBeNull();
    expect(screen.queryByText(/Beta/)).toBeNull();
  });

  it('shows public details of a rival colony the player can see, but no controls', () => {
    const content = fixtureContent();
    setup(enemyHome, (s) => {
      addFleet(s, content, ALPHA, s.systems[s.empires[BETA].homeSystem].sector, ['scout']);
    });
    expect(screen.getByText(/Beta home system/)).toBeTruthy();
    expect(screen.getByText('Population 10')).toBeTruthy();
    expect(screen.queryByLabelText('Food workers')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Build Farm' })).toBeNull();
  });

  it('shows the last known owner of a system that is out of sight', () => {
    setup(enemyHome, (s) => (s.empires[ALPHA].knownSystems[s.empires[BETA].homeSystem] = BETA));
    expect(screen.getByText(/Beta home system \(last seen\)/)).toBeTruthy();
    expect(screen.getByText('Planets')).toBeTruthy();
    expect(screen.queryByText(/^Population/)).toBeNull();
  });

  it('shows planets for a scanned, unclaimed system', () => {
    const free = (s: GameState) => Object.values(s.systems).find((x) => !x.colony)!.id;
    setup(free, (s) => (s.empires[ALPHA].knownSystems[free(s)] = null));
    expect(screen.getByText(/Unclaimed/)).toBeTruthy();
    expect(screen.getByText('Planets')).toBeTruthy();
    expect(screen.queryByText('Workers')).toBeNull();
  });
});
