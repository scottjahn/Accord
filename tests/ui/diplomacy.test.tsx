// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../../src/data';
import { AUTOSAVE_KEY } from '../../src/game/persistence';
import { createSession, startNewGame, type GameSession } from '../../src/game/session';
import {
  deserialize,
  getEmpireView,
  hasTreaty,
  serialize,
  signTreaty,
  type EmpireId,
  type GameState,
  type Sector,
} from '../../src/sim';
import { App } from '../../src/ui/App';
import { useSession } from '../../src/ui/useSession';
import { EmpiresScreen } from '../../src/ui/war/EmpiresScreen';
import { IntelScreen } from '../../src/ui/war/IntelScreen';
import { ALPHA, BETA, fixtureContent, homeOf, introduce } from '../fixture';

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

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function Diplomacy({ session }: { session: GameSession }) {
  const { state, player } = useSession(session);
  return (
    <EmpiresScreen state={state} content={session.content} player={player} view={getEmpireView(state, player, session.content)} dispatch={session.dispatch} onClose={() => {}} />
  );
}
function Intel({ session }: { session: GameSession }) {
  const { state, player } = useSession(session);
  return <IntelScreen state={state} content={session.content} player={player} dispatch={session.dispatch} onClose={() => {}} />;
}

/** The player is Alpha; Beta is the AI. They have met unless `strangers` is set. */
function setup(screenToShow: 'diplomacy' | 'intel', prepare?: (state: GameState, content: ReturnType<typeof fixtureContent>) => void, strangers = false) {
  const content = fixtureContent();
  const state = startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' });
  if (!strangers) introduce(state, ALPHA, BETA);
  prepare?.(state, content);
  const session = createSession(content, state);
  render(screenToShow === 'diplomacy' ? <Diplomacy session={session} /> : <Intel session={session} />);
  return { session, content, now: () => session.getSnapshot().state };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const text = (testId: string) => screen.getByTestId(testId).textContent;

describe('the diplomacy screen', () => {
  it('shows what a rival thinks of you and which treaties can be proposed', () => {
    setup('diplomacy');
    expect(text(`relation-${BETA}`)).toBe('At peace');
    expect(text(`opinion-${BETA}`)).toBe('0');
    expect(button('Propose non-aggression pact').disabled).toBe(false);
    expect(button('Propose peace treaty').disabled).toBe(true);
    expect(button('Propose peace treaty').title).toBe('You are not at war');
  });

  it('cannot negotiate with an empire you have not met', () => {
    setup('diplomacy', undefined, true);
    expect(button('Propose non-aggression pact').title).toBe('You have not made contact with them yet');
  });

  it('proposes a treaty, which the rival answers on its turn', () => {
    const { session, now } = setup('diplomacy');
    fireEvent.click(button('Propose non-aggression pact'));
    expect(screen.getByText('You proposed a non-aggression pact; they will answer on their turn.')).toBeTruthy();
    expect(button('Propose non-aggression pact').title).toBe('That treaty has already been proposed');

    act(() => session.endTurn());
    expect(hasTreaty(now(), ALPHA, BETA, 'nonAggression')).toBe(true);
    const treaties = screen.getByRole('list', { name: 'Treaties with Beta' });
    expect(within(treaties).getByText('Non-aggression pact')).toBeTruthy();
    expect(within(treaties).getByText('39 turns left')).toBeTruthy();
    expect(within(screen.getByRole('table', { name: "Beta's opinion of you" })).getByText('Non-aggression pact in force')).toBeTruthy();
    expect(session.getSnapshot().lastEvents.some((e) => e.type === 'treatySigned')).toBe(true);
  });

  it('shows the reason when the rival refuses', () => {
    const { session } = setup('diplomacy');
    fireEvent.click(button('Propose alliance'));
    act(() => session.endTurn());
    const refusal = session.getSnapshot().lastEvents.find((e) => e.type === 'offerRefused');
    expect(refusal).toMatchObject({ note: expect.stringMatching(/opinion 0, needs 35/) });
  });

  it('accepts or declines an offer from a rival', () => {
    const offerFrom = (s: GameState) => s.offers.push({ id: 'off-00099', from: BETA, to: ALPHA, type: 'researchPact', turn: 1 });
    const accepting = setup('diplomacy', offerFrom);
    const offer = screen.getByRole('group', { name: 'Offer: Research pact' });
    expect(within(offer).getByText('Beta proposes a research pact.')).toBeTruthy();
    fireEvent.click(within(offer).getByRole('button', { name: 'Accept' }));
    expect(hasTreaty(accepting.now(), ALPHA, BETA, 'researchPact')).toBe(true);
    expect(screen.queryByRole('group', { name: 'Offer: Research pact' })).toBeNull();
    cleanup();

    const declining = setup('diplomacy', offerFrom);
    fireEvent.click(button('Decline'));
    expect(declining.now().offers).toEqual([]);
    expect(declining.now().treaties).toEqual([]);
  });

  it('a treaty forbids war until it is broken, and breaking takes a second click and has a price', () => {
    const { now } = setup('diplomacy', (s, c) => void signTreaty(s, ALPHA, BETA, 'nonAggression', c));
    expect(button('Declare war').disabled).toBe(true);
    expect(button('Declare war').title).toBe('A treaty forbids it; break the treaty first');

    fireEvent.click(button('Break Non-aggression pact'));
    expect(hasTreaty(now(), ALPHA, BETA, 'nonAggression')).toBe(true); // not until confirmed
    expect(screen.getByText(/Breaking your word costs morale/)).toBeTruthy();
    fireEvent.click(button('Confirm: break the non-aggression pact'));

    expect(hasTreaty(now(), ALPHA, BETA, 'nonAggression')).toBe(false);
    expect(text(`opinion-${BETA}`)).toBe('-50');
    expect(screen.getByText('They broke a treaty with us')).toBeTruthy();
    expect(button('Declare war').disabled).toBe(false);
  });

  it('at war, offers peace and nothing else', () => {
    setup('diplomacy', (s) => (s.wars[`${ALPHA}|${BETA}`] = 1));
    expect(text(`relation-${BETA}`)).toBe('At war');
    expect(button('Propose peace treaty').disabled).toBe(false);
    expect(button('Propose alliance').title).toBe('Make peace first');
    expect(screen.queryByRole('button', { name: 'Declare war' })).toBeNull();
  });

  it('shows progress toward the Accord', () => {
    setup('diplomacy', (s) => (s.minorsPlaced = 4));
    expect(text('accord-progress')).toMatch(/hold 2 of the 4 minor races; you hold 0/);
  });
});

describe('the intelligence screen', () => {
  it('sets how much intel goes to counter-intel', () => {
    const { now } = setup('intel', (s) => (s.empires[ALPHA].intelPool = 100));
    expect(text('intel-pool')).toBe('100');
    expect(text('intel-split')).toBe('0%');
    fireEvent.change(screen.getByLabelText('Counter-intel share'), { target: { value: '40' } });
    expect(now().empires[ALPHA].intelSplit).toBe(40);
    expect(text('intel-split')).toBe('40%');
  });

  it('orders an operation, pays for it, and will not order the same one twice', () => {
    const { now } = setup('intel', (s) => (s.empires[ALPHA].intelPool = 100));
    expect(screen.getByText('Defences unknown: up to 70% to succeed')).toBeTruthy();
    fireEvent.click(button('Gather intel against Beta'));
    expect(now().operations).toEqual([{ by: ALPHA, target: BETA, kind: 'gatherIntel', system: null }]);
    expect(text('intel-pool')).toBe('80');
    expect(text('ordered')).toMatch(/^Under way this turn: Gather intel\./);
    expect(button('Gather intel against Beta').title).toBe('That operation is already under way this turn');
  });

  it('aims sabotage at a colony you know of', () => {
    const { now } = setup('intel', (s) => (s.empires[ALPHA].intelPool = 100));
    const target = homeOf(now(), BETA);
    expect((screen.getByLabelText('Target colony of Beta') as HTMLSelectElement).value).toBe(target.id);
    fireEvent.click(button('Sabotage against Beta'));
    expect(now().operations).toEqual([{ by: ALPHA, target: BETA, kind: 'sabotage', system: target.id }]);
    expect(text('ordered')).toContain(`Sabotage at ${target.name}`);
  });

  it('says why an operation cannot be afforded', () => {
    setup('intel', (s) => (s.empires[ALPHA].intelPool = 25));
    expect(button('Steal research against Beta').disabled).toBe(true);
    expect(button('Steal research against Beta').title).toBe('Steal research costs 40 intel; you have 25');
    expect(button('Gather intel against Beta').disabled).toBe(false);
  });

  it('shows exact odds while the rival is under surveillance', () => {
    setup('intel', (s) => {
      s.empires[ALPHA].revealedUntil[BETA] = 10;
      s.empires[BETA].counterIntel = 40;
    });
    expect(screen.getByText('Counter-intel 40: 60% to succeed, 25% caught on failure')).toBeTruthy();
  });

  it('has nobody to spy on before first contact', () => {
    setup('intel', undefined, true);
    expect(screen.getByText('You have not made contact with any rival yet.')).toBeTruthy();
  });
});

/**
 * Milestone 7 exit test: a game can be won without a major war. On the shipped
 * content, a player with long-standing treaties proposes an alliance while three
 * minor races are about to join, and wins by the Accord through the real UI.
 */
describe('winning without a war', () => {
  const content = loadContent();
  const HUMAN = 'emp-1' as EmpireId;
  const RIVAL = 'emp-2' as EmpireId;

  it('allies with the rival, gathers half the minor races, and wins by the Accord', () => {
    const state = startNewGame(content, { seed: 7, preset: 'small', faction: 'concord' });
    state.empires[HUMAN].knownSystems[state.empires[RIVAL].homeSystem] = RIVAL;
    state.empires[RIVAL].knownSystems[state.empires[HUMAN].homeSystem] = HUMAN;
    // Fifty turns of kept treaties behind them.
    for (const type of ['nonAggression', 'researchPact', 'openBorders'] as const) {
      state.treaties.push({ type, parties: [HUMAN, RIVAL], startTurn: 1, since: -49, endTurn: 100 });
    }
    // Three of the six minor races have been won over and join at the end of this turn.
    const minors = Object.values(state.systems).filter((s) => s.minor);
    expect(state.minorsPlaced).toBe(6);
    for (const system of minors.slice(0, 3)) system.minor = { ...system.minor!, attitude: { [HUMAN]: 100 } as Record<EmpireId, number>, leader: HUMAN, leadTurns: 2 };
    localStorage.setItem(AUTOSAVE_KEY, serialize(state));

    render(<App />);
    fireEvent.click(button('Continue game'));
    fireEvent.click(button('Empires'));
    const dialog = screen.getByRole('dialog', { name: 'Empires' });
    expect(text(`opinion-${RIVAL}`)).toBe('+40');
    expect(within(dialog).getByText('Long friendship')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Propose alliance' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    fireEvent.click(button('End turn'));

    const loaded = deserialize(localStorage.getItem(AUTOSAVE_KEY)!);
    if (!loaded.ok) throw new Error(loaded.error.message);
    const final = loaded.value;
    expect(hasTreaty(final, HUMAN, RIVAL, 'alliance')).toBe(true);
    expect(final.empires[HUMAN].members).toHaveLength(3);
    expect(final.winner).toBe(HUMAN);
    expect(final.victory).toBe('accord');
    // Nobody fought: no war was ever declared.
    expect(final.wars).toEqual({});
    expect(final.empires[HUMAN].lastWarTurn).toBe(0);
    expect(final.empires[RIVAL].eliminated).toBe(false);

    const result = screen.getByRole('dialog', { name: 'Game over' });
    expect(within(result).getByRole('heading', { name: 'Victory' })).toBeTruthy();
    expect(within(result).getByText('The powers have joined the Accord under your leadership, without conquest.')).toBeTruthy();
  });
});
