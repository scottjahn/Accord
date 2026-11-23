// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../../src/data';
import { createSession, startNewGame, type GameSession } from '../../src/game/session';
import { forecastColony, sortedKeys, type BuildingId, type Content, type FactionId, type GameState, type HullId } from '../../src/sim';
import { TopBar } from '../../src/ui/hud/TopBar';
import { NewGameScreen } from '../../src/ui/screens/NewGameScreen';
import { BuildQueue } from '../../src/ui/system/BuildQueue';
import { ALPHA, fixtureContent, homeOf } from '../fixture';

afterEach(cleanup);

/** The home colony's build queue, wired to a live session. */
function Queue({ session }: { session: GameSession }) {
  const { state, player } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const home = state.systems[state.empires[player].homeSystem];
  return (
    <BuildQueue
      state={state}
      colony={home.colony!}
      content={session.content}
      forecast={forecastColony(state, home, session.content)}
      player={player}
      systemId={home.id}
      dispatch={session.dispatch}
    />
  );
}

function queue(prepare?: (state: GameState, content: Content) => void) {
  const content = fixtureContent();
  const state = startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' });
  homeOf(state, ALPHA).colony!.buildings['shipyard' as BuildingId] = 1;
  prepare?.(state, content);
  const session = createSession(content, state);
  render(<Queue session={session} />);
  return { session, content, home: () => homeOf(session.getSnapshot().state, ALPHA).colony! };
}

describe('buying out a build', () => {
  it('offers the price on the front item only, and says why when it cannot be paid', () => {
    const { session } = queue();
    fireEvent.click(screen.getByRole('button', { name: 'Build Factory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Build Farm' }));
    const buy = screen.getByRole('button', { name: 'Buy Factory now' }) as HTMLButtonElement;
    expect(buy.textContent).toBe('Buy (120)');
    expect(buy.disabled).toBe(true);
    expect(buy.title).toBe('That costs 120 credits; you have 0');
    expect(screen.queryByRole('button', { name: 'Buy Farm now' })).toBeNull();
    expect(session.getSnapshot().state.empires[ALPHA].credits).toBe(0);
  });

  it('pays and marks the item as paid for', () => {
    const { session, home } = queue((state) => (state.empires[ALPHA].credits = 200));
    fireEvent.click(screen.getByRole('button', { name: 'Build Factory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Factory now' }));
    expect(session.getSnapshot().state.empires[ALPHA].credits).toBe(80);
    expect(home().buildQueue[0].progress).toBe(60);
    expect(screen.getByText('Paid for')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Buy Factory now' })).toBeNull();
  });
});

describe('content that belongs to one power', () => {
  it('is not offered to anyone else, and is labelled for its owner', () => {
    queue((_, content) => {
      content.buildings['forum' as BuildingId].faction = 'beta' as FactionId;
      content.buildings['farm' as BuildingId].faction = 'alpha' as FactionId;
      content.hulls['frigate' as HullId].faction = 'beta' as FactionId;
    });
    expect(screen.queryByRole('button', { name: 'Build Forum' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Build Frigate' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Build Farm' })).toBeTruthy();
    expect(screen.getByText('Alpha only')).toBeTruthy();
  });
});

describe('hiring mercenaries', () => {
  it('is offered only to a power with the trait, for warships, at their price', () => {
    queue((state) => (state.empires[ALPHA].credits = 100));
    expect(screen.queryByRole('button', { name: 'Hire Frigate' })).toBeNull();
    cleanup();

    const { session } = queue((state, content) => {
      state.empires[ALPHA].credits = 100;
      content.factions['alpha' as FactionId].traits.hiresMercenaries = true;
    });
    expect(screen.queryByRole('button', { name: 'Hire Transport' })).toBeNull();
    const locked = screen.getByRole('button', { name: 'Hire Destroyer' }) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    const shipCount = (s: GameState) => Object.values(s.fleets).reduce((n, f) => n + f.ships.length, 0);
    const before = shipCount(session.getSnapshot().state);
    const hire = screen.getByRole('button', { name: 'Hire Frigate' });
    expect(hire.textContent).toBe('Hire (90)');
    fireEvent.click(hire);
    const after = session.getSnapshot().state;
    expect(after.empires[ALPHA].credits).toBe(10);
    expect(shipCount(after)).toBe(before + 1);
    expect((screen.getByRole('button', { name: 'Hire Frigate' }) as HTMLButtonElement).title).toBe('That costs 90 credits; you have 10');
  });
});

describe('the top bar', () => {
  it('shows the treasury and what it earns a turn, with the causes on hover', () => {
    const content = fixtureContent();
    const state = startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' });
    state.empires[ALPHA].credits = 42;
    homeOf(state, ALPHA).colony!.buildQueue = [{ kind: 'building', building: 'factory' as BuildingId, progress: 0 }];
    const noop = vi.fn();
    render(
      <TopBar state={state} content={content} player={ALPHA} onEndTurn={noop} onSkipAhead={noop} onHelp={noop} onResearch={noop} onEmpires={noop} onIntel={noop} onSystems={noop} onEmpire={noop} offers={0} wars={0} over={false} onSave={noop} onQuit={noop} />,
    );
    expect(screen.getByTestId('credits').textContent).toBe('42');
    expect(screen.getByTestId('credit-income').textContent).toBe('(+3)');
    expect(screen.getByTestId('credits').closest('div')!.title).toBe('Tax on 10 people: +3');
  });
});

describe('choosing opponents', () => {
  const content = loadContent();
  const factionsOf = (state: GameState) => sortedKeys(state.empires).map((id) => state.empires[id].faction as string);
  const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

  it('starts with the chosen power’s rival ticked, and follows a change of power', () => {
    const onStart = vi.fn<(state: GameState) => void>();
    render(<NewGameScreen content={content} saved={null} onStart={onStart} />);
    expect(box('Vashran Dominate').checked).toBe(true);
    expect(box('Orrin Exchange').checked).toBe(false);
    expect(screen.queryByRole('checkbox', { name: 'The Concord' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /Kessic Union/ }));
    expect(box('Vashran Dominate').checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Vashran Dominate/ }));
    expect(box('The Concord').checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(factionsOf(onStart.mock.calls[0][0])).toEqual(['vashran', 'concord']);
  });

  it('starts a game against everyone ticked, and refuses to start against no one', () => {
    const onStart = vi.fn<(state: GameState) => void>();
    render(<NewGameScreen content={content} saved={null} onStart={onStart} />);
    fireEvent.click(box('Vashran Dominate'));
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(screen.getByRole('alert').textContent).toBe('Choose at least one opponent.');
    expect(onStart).not.toHaveBeenCalled();

    for (const name of ['Kessic Union', 'Orrin Exchange', 'The Veiled Throne', 'Vashran Dominate']) fireEvent.click(box(name));
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(factionsOf(onStart.mock.calls[0][0]).sort()).toEqual(['concord', 'kessic', 'orrin', 'vashran', 'veiled']);
  });

  it('describes what sets each power apart', () => {
    render(<NewGameScreen content={content} saved={null} onStart={vi.fn()} />);
    expect(screen.getByText('-20% research, +50% credits, can buy the loyalty of minor races, can hire warships for credits')).toBeTruthy();
    expect(screen.getByText('+100% intel, +10% research, cloaked ships from era 3')).toBeTruthy();
    expect(screen.getByText('+14% industry, -3% research, +12% attack, +50% garrison, morale never above 110')).toBeTruthy();
  });
});
