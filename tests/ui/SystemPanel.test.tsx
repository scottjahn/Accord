// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createSession, startNewGame, type GameSession } from '../../src/game/session';
import type { SystemId } from '../../src/sim';
import { SystemPanel } from '../../src/ui/system/SystemPanel';
import { useSession } from '../../src/ui/useSession';
import { ALPHA, BETA, colonyOf, fixtureContent } from '../fixture';

afterEach(cleanup);

function Harness({ session, systemId }: { session: GameSession; systemId: SystemId }) {
  const { state, player, lastError } = useSession(session);
  return (
    <SystemPanel
      state={state}
      content={session.content}
      player={player}
      system={state.systems[systemId]}
      error={lastError}
      dispatch={session.dispatch}
    />
  );
}

/** The player is Alpha (emp-1) under the balanced governor: food 5, intel 1, research 4. */
function setup(system: 'home' | 'enemy' | 'empty' = 'home') {
  const content = fixtureContent();
  const session = createSession(content, startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' }));
  const state = session.getSnapshot().state;
  const systemId =
    system === 'home'
      ? state.empires[ALPHA].homeSystem
      : system === 'enemy'
        ? state.empires[BETA].homeSystem
        : Object.values(state.systems).find((s) => !s.colony)!.id;
  render(<Harness session={session} systemId={systemId} />);
  const colony = () => colonyOf(session.getSnapshot().state, ALPHA);
  return { session, colony };
}

const slider = (name: string) => screen.getByLabelText(`${name} workers`) as HTMLInputElement;
const setSlider = (name: string, value: number) => fireEvent.change(slider(name), { target: { value: String(value) } });
const text = (testId: string) => screen.getByTestId(testId).textContent;

describe('SystemPanel', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /^Food 25, show breakdown/ }));
    const table = document.getElementById('breakdown-food')!;
    expect(within(table).getByText('5 workers')).toBeTruthy();
    expect(within(table).getByText('Farm x1')).toBeTruthy();
    expect(within(table).getByText('Planet 1 (Terran)')).toBeTruthy();
    expect(within(table).getByText('+10%')).toBeTruthy();
    expect(within(table).getByText('-5%')).toBeTruthy();
    expect(within(table).getByText('Total').nextElementSibling?.textContent).toBe('25');
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

  it('queues buildings up to the per-system limit', () => {
    const { colony } = setup();
    expect(screen.getByText(/Nothing queued/)).toBeTruthy();
    const buildLab = screen.getByRole('button', { name: 'Build Lab' }) as HTMLButtonElement;
    fireEvent.click(buildLab);
    fireEvent.click(buildLab);
    expect(colony().buildQueue.map((i) => i.building)).toEqual(['lab', 'lab']);
    expect(buildLab.disabled).toBe(true);
    expect(buildLab.title).toBe('Limit reached');
    expect(within(screen.getByRole('list', { name: 'Queued buildings' })).getAllByText('Lab')).toHaveLength(2);
  });

  it('disables every build button when the queue is full', () => {
    setup();
    for (const name of ['Lab', 'Lab', 'Factory', 'Factory']) {
      fireEvent.click(screen.getByRole('button', { name: `Build ${name}` }));
    }
    const reactor = screen.getByRole('button', { name: 'Build Reactor' }) as HTMLButtonElement;
    expect(reactor.disabled).toBe(true);
    expect(reactor.title).toBe('Queue is full');
  });

  it('shows turns left and reorders and removes queued buildings', () => {
    const { colony } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Build Farm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Build Lab' }));
    const queue = screen.getByRole('list', { name: 'Queued buildings' });
    expect(within(queue).getAllByText(/0 \/ \d+ · \d+ turns/)).toHaveLength(2);
    expect((screen.getByRole('button', { name: 'Move Farm up' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Move Lab up' }));
    expect(colony().buildQueue.map((i) => i.building)).toEqual(['lab', 'farm']);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Lab from queue' }));
    expect(colony().buildQueue.map((i) => i.building)).toEqual(['farm']);
  });

  it('warns when buildings have no power', () => {
    const { session } = setup();
    // Take over manually with no energy and add factories the reactor cannot run.
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

  it("shows only public details for another empire's colony", () => {
    setup('enemy');
    expect(screen.getByText('Population 10')).toBeTruthy();
    expect(screen.queryByLabelText('Food workers')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Build Farm' })).toBeNull();
  });

  it('shows planets for an unclaimed system', () => {
    setup('empty');
    expect(screen.getByText(/Unclaimed/)).toBeTruthy();
    expect(screen.queryByText('Workers')).toBeNull();
  });
});
