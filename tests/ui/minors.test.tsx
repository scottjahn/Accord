// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession, startNewGame, type GameSession } from '../../src/game/session';
import { addColonyMorale, getEmpireView, sectorKey, type FleetId, type GameState, type MinorId, type SystemId } from '../../src/sim';
import { SystemPanel } from '../../src/ui/system/SystemPanel';
import { useSession } from '../../src/ui/useSession';
import { EmpiresScreen } from '../../src/ui/war/EmpiresScreen';
import { ALPHA, BETA, addFleet, fixtureContent, homeOf } from '../fixture';

afterEach(cleanup);

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
      onSelectFleet={vi.fn<(id: FleetId) => void>()}
    />
  );
}

/**
 * The player is Alpha. The Sages (technology + influence; +20% research) live
 * next to Alpha's home, already met at attitude 30, and Alpha has 200 intel.
 */
function setup(options: { race?: string; show?: 'minor' | 'home'; prepare?: (state: GameState, minorId: SystemId) => void } = {}) {
  const content = fixtureContent();
  const state = startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' });
  const home = homeOf(state, ALPHA);
  const taken = new Set(Object.values(state.systems).map((s) => sectorKey(s.sector)));
  const sector = [-1, 0, 1]
    .flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: home.sector.x + dx, y: home.sector.y + dy })))
    .find((s) => s.x >= 0 && s.y >= 0 && s.x < 8 && s.y < 6 && !taken.has(sectorKey(s)))!;
  const system = Object.values(state.systems).find((s) => !s.colony && !(s.id in state.empires[ALPHA].knownSystems))!;
  system.sector = sector;
  system.planets = [{ type: 'terran', maxPopulation: 12, foodBonus: 10, energyBonus: 0 }];
  system.minor = { race: (options.race ?? 'sages') as MinorId, population: 8, attitude: { [ALPHA]: 30 }, leader: null, leadTurns: 0 };
  state.empires[ALPHA].knownSystems[system.id] = null;
  state.empires[ALPHA].intelPool = 200;
  options.prepare?.(state, system.id);
  const session = createSession(content, state);
  render(<Harness session={session} systemId={options.show === 'home' ? home.id : system.id} />);
  return { session, content, minorId: system.id, name: system.name, now: () => session.getSnapshot().state };
}

const text = (testId: string) => screen.getByTestId(testId).textContent;
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('a minor race in the system panel', () => {
  it('shows who they are, what they want and what they would bring', () => {
    setup();
    expect(screen.getByText(/Home of the Sages/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'The Sages' })).toBeTruthy();
    expect(text('minor-garrison')).toBe('12'); // population 8 + militia 4
    expect(text('minor-bonus')).toBe('+20% research in every colony');
    const wants = screen.getByRole('list', { name: 'Wants' });
    expect(within(wants).getByText('Technology: reach Computing level 1')).toBeTruthy();
    expect(within(wants).getByText('Not met')).toBeTruthy();
    expect(within(wants).getByText(/responds twice as well to courting/)).toBeTruthy();
    expect(screen.queryByLabelText('Food workers')).toBeNull();
  });

  it('shows the attitude, why it is changing, and where the player stands', () => {
    setup({ prepare: (s) => (s.empires[ALPHA].research.levels.computing = 1) });
    expect(text('attitude')).toBe('30 / 100');
    expect(text('attitude-change')).toBe('(+3 per turn)');
    expect(screen.getByText('Technology: Computing level 1 or better')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Wants' })).getByText('Met')).toBeTruthy();
    expect(text('standing')).toBe('No rival has found them yet.');
    expect(screen.getByText(/They join at 80 once you have been ahead for 3 turns/)).toBeTruthy();
  });

  it('says when a rival is ahead without giving their number', () => {
    setup({ prepare: (s, id) => (s.systems[id].minor!.attitude[BETA] = 77) });
    expect(text('standing')).toBe('A rival is ahead of you.');
    expect(screen.queryByText(/77/)).toBeNull();
  });

  it('spends intel to court them', () => {
    const { now, minorId } = setup();
    fireEvent.click(button('Spend 25 intel'));
    expect(now().systems[minorId].minor!.attitude[ALPHA]).toBe(40); // doubled for the Sages
    expect(now().empires[ALPHA].intelPool).toBe(175);
    expect(text('attitude')).toBe('40 / 100');
    expect(screen.getByText(/You have 175 intel/)).toBeTruthy();
  });

  it('disables spending more intel than the player has, and says why', () => {
    setup({ prepare: (s) => (s.empires[ALPHA].intelPool = 12) });
    expect(button('Spend 10 intel').disabled).toBe(false);
    expect(button('Spend 25 intel').disabled).toBe(true);
    expect(button('Spend 25 intel').title).toBe('You have 12 intel, not 25');
  });

  it('waits for first contact before offering to court', () => {
    setup({ prepare: (s, id) => (s.systems[id].minor!.attitude = {}) });
    expect(screen.getByText(/First contact will be made/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Spend/ })).toBeNull();
  });

  it('courts a people until they join, and the panel becomes a member colony', () => {
    const { session, now, minorId, name } = setup({ prepare: (s) => (s.empires[ALPHA].research.levels.computing = 1) });
    // 125 intel is 25 steps, doubled: +50, to 80.
    fireEvent.click(button('Spend 50 intel'));
    fireEvent.click(button('Spend 50 intel'));
    fireEvent.click(button('Spend 25 intel'));
    expect(text('attitude')).toBe('80 / 100');

    act(() => session.endTurn());
    expect(screen.getByText(/They are leaning your way: 1 of 3 turns/)).toBeTruthy();
    act(() => session.endTurn());
    act(() => session.endTurn());

    expect(now().systems[minorId].colony).toMatchObject({ owner: ALPHA, minorRace: 'sages' });
    expect(session.getSnapshot().lastEvents).toContainEqual({ type: 'minorJoined', empire: ALPHA, system: minorId, race: 'sages' });
    expect(screen.getByRole('heading', { name })).toBeTruthy();
    expect(screen.getByText(/Alpha/)).toBeTruthy();
    expect(screen.getByText('Home of the Sages, who joined you: +20% research in every colony.')).toBeTruthy();
    expect(screen.getByLabelText('Food workers')).toBeTruthy(); // it is now an ordinary colony to run
    expect(screen.queryByRole('button', { name: /^Spend/ })).toBeNull();

    fireEvent.click(button(/^Research \d+, show breakdown/));
    expect(within(document.getElementById('breakdown-research')!).getByText('Sages membership')).toBeTruthy();
  });
});

describe('morale in the system panel', () => {
  it('shows a calm colony at 100 with no effect', () => {
    setup({ show: 'home' });
    expect(text('morale')).toBe('100');
    expect(text('morale-effect')).toBe('No effect on output.');
  });

  it('lists each cause and the effect on output', () => {
    const content = fixtureContent();
    setup({ show: 'home', prepare: (s) => addColonyMorale(s, homeOf(s, ALPHA), 'starvation', content) });
    expect(text('morale')).toBe('90');
    expect(screen.getByText('Starvation (5 turns left)')).toBeTruthy();
    expect(text('morale-effect')).toBe('-10% to every output.');
  });

  it('warns when the colony is in unrest', () => {
    const content = fixtureContent();
    setup({
      show: 'home',
      prepare: (s) => {
        for (const kind of ['conquered', 'colonyLost', 'starvation'] as const) addColonyMorale(s, homeOf(s, ALPHA), kind, content);
      },
    });
    expect(text('morale')).toBe('52');
    expect(text('morale-effect')).toMatch(/Unrest: the colony will not grow/);
  });
});

describe('minor races in the Empires dialog', () => {
  it('lists the peoples the player has found with attitude, standing and bonus', () => {
    const content = fixtureContent();
    const state = startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' });
    const system = Object.values(state.systems).find((s) => !s.colony)!;
    system.minor = { race: 'bards' as MinorId, population: 6, attitude: { [ALPHA]: 44 }, leader: null, leadTurns: 0 };
    state.empires[ALPHA].knownSystems[system.id] = null;
    const hidden = Object.values(state.systems).find((s) => !s.colony && !s.minor && !(s.id in state.empires[ALPHA].knownSystems))!;
    hidden.minor = { race: 'blades' as MinorId, population: 6, attitude: {}, leader: null, leadTurns: 0 };
    addFleet(state, content, ALPHA, homeOf(state, ALPHA).sector, ['scout']);

    render(
      <EmpiresScreen state={state} content={content} player={ALPHA} view={getEmpireView(state, ALPHA, content)} dispatch={() => true} onClose={() => {}} />,
    );
    const list = screen.getByRole('list', { name: 'Minor races' });
    expect(within(list).getByText(`Bards of ${system.name}`)).toBeTruthy();
    expect(within(list).getByText(/attitude 44 · alone · \+6 morale in every colony/)).toBeTruthy();
    expect(screen.queryByText(/Blades/)).toBeNull(); // not found yet
  });
});
