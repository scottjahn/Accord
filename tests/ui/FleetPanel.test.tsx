// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rebalance } from '../../src/game/researchAllocation';
import { createSession, startNewGame, type GameSession } from '../../src/game/session';
import {
  FIELDS,
  evenAllocation,
  fleetsOf,
  getEmpireView,
  sectorKey,
  type BuildingId,
  type Fleet,
  type FleetId,
  type GameState,
  type Sector,
} from '../../src/sim';
import { FleetPanel } from '../../src/ui/fleet/FleetPanel';
import { ResearchScreen } from '../../src/ui/research/ResearchScreen';
import { useSession } from '../../src/ui/useSession';
import { ALPHA, BETA, addFleet, colonyOf, fixtureContent, homeOf } from '../fixture';

afterEach(cleanup);

const onToggleMove = vi.fn();
const onClose = vi.fn();

function FleetHarness({ session, fleetId }: { session: GameSession; fleetId: FleetId }) {
  const { state, player } = useSession(session);
  const fleet = state.fleets[fleetId];
  if (!fleet) return <p>Fleet gone</p>;
  return (
    <FleetPanel
      state={state}
      content={session.content}
      player={player}
      view={getEmpireView(state, player, session.content)}
      fleet={fleet}
      moveMode={false}
      onToggleMove={onToggleMove}
      dispatch={session.dispatch}
    />
  );
}

function ResearchHarness({ session }: { session: GameSession }) {
  const { state, player } = useSession(session);
  return <ResearchScreen state={state} content={session.content} player={player} dispatch={session.dispatch} onClose={onClose} />;
}

/** A sector next to Alpha's home with no system in it. */
function emptyNeighbour(state: GameState): Sector {
  const home = homeOf(state, ALPHA).sector;
  const taken = new Set(Object.values(state.systems).map((s) => sectorKey(s.sector)));
  return [-1, 0, 1]
    .flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: home.x + dx, y: home.y + dy })))
    .find((s) => s.x >= 0 && s.y >= 0 && s.x < 8 && s.y < 6 && !taken.has(sectorKey(s)))!;
}

/** Alpha is the player. `make` adds the fleet under test to the starting state. */
function setup(make: (state: GameState, content: ReturnType<typeof fixtureContent>) => Fleet) {
  const content = fixtureContent();
  const state = startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' });
  const fleet = make(state, content);
  const session = createSession(content, state);
  render(<FleetHarness session={session} fleetId={fleet.id} />);
  return { session, fleet, now: () => session.getSnapshot().state };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const status = () => screen.getByTestId('fleet-status').textContent;

describe('FleetPanel', () => {
  it('shows an idle fleet with its ships, speed and range', () => {
    setup((s, c) => addFleet(s, c, ALPHA, homeOf(s, ALPHA).sector, ['scout', 'frigate']));
    expect(screen.getByRole('heading', { name: 'Your fleet' })).toBeTruthy();
    expect(status()).toBe('Holding position');
    expect(screen.getByText('2 sectors per turn')).toBeTruthy();
    expect(screen.getByText('2 sectors from a colony')).toBeTruthy();
    expect(screen.getByText(/Scout · hull 10 \/ 10/)).toBeTruthy();
    expect(screen.getByText(/Warship · hull 30 \/ 30/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('shows where a moving fleet is going and how long it takes, and can stop it', () => {
    const { session, fleet, now } = setup((s, c) => {
      const f = addFleet(s, c, ALPHA, homeOf(s, ALPHA).sector, ['colony_ship']);
      f.destination = emptyNeighbour(s);
      return f;
    });
    const dest = now().fleets[fleet.id].destination!;
    expect(status()).toBe(`Heading to sector ${dest.x + 1}, ${dest.y + 1} · 1 turn`);
    fireEvent.click(button('Stop'));
    expect(now().fleets[fleet.id].destination).toBeNull();
    expect(status()).toBe('Holding position');
    expect(session.getSnapshot().lastError).toBeNull();
  });

  it('asks the screen to enter move mode', () => {
    setup((s, c) => addFleet(s, c, ALPHA, homeOf(s, ALPHA).sector, ['frigate']));
    onToggleMove.mockClear();
    fireEvent.click(button('Move'));
    expect(onToggleMove).toHaveBeenCalledTimes(1);
  });

  it('splits selected ships into a new fleet', () => {
    const { fleet, now } = setup((s, c) => addFleet(s, c, ALPHA, homeOf(s, ALPHA).sector, ['scout', 'frigate', 'frigate']));
    expect(button('Split off selected').disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Select Scout'));
    fireEvent.click(button('Split off selected'));
    expect(fleetsOf(now(), ALPHA)).toHaveLength(2);
    expect(now().fleets[fleet.id].ships.map((x) => x.hull)).toEqual(['frigate', 'frigate']);
    // The split-off fleet is now offered for merging back.
    expect(screen.getByText('Also here')).toBeTruthy();
  });

  it('merges another fleet in the same sector', () => {
    const { fleet, now } = setup((s, c) => {
      addFleet(s, c, ALPHA, homeOf(s, ALPHA).sector, ['scout']);
      return addFleet(s, c, ALPHA, homeOf(s, ALPHA).sector, ['frigate']);
    });
    fireEvent.click(button('Merge in'));
    expect(fleetsOf(now(), ALPHA)).toHaveLength(1);
    expect(now().fleets[fleet.id].ships.map((x) => x.hull)).toEqual(['frigate', 'scout']);
    expect(screen.queryByText('Also here')).toBeNull();
  });

  it('offers to colonise a free system the fleet is sitting at', () => {
    const { fleet, now } = setup((s, c) => {
      const target = Object.values(s.systems).find((x) => !x.colony)!;
      target.sector = emptyNeighbour(s);
      target.planets = [{ type: 'terran', maxPopulation: 12, foodBonus: 10, energyBonus: 0 }];
      s.empires[ALPHA].knownSystems[target.id] = null;
      return addFleet(s, c, ALPHA, target.sector, ['colony_ship']);
    });
    fireEvent.click(button(/^Colonise /));
    expect(now().fleets[fleet.id].order).toBe('colonise');
    expect(status()).toBe('Founding a colony this turn');
    expect(screen.queryByRole('button', { name: /^Colonise / })).toBeNull();
  });

  it('does not offer to colonise an owned system', () => {
    setup((s, c) => addFleet(s, c, ALPHA, homeOf(s, ALPHA).sector, ['colony_ship']));
    expect(button(/^Colonise /).disabled).toBe(true);
    expect(button(/^Colonise /).title).toMatch(/already colonised/);
  });

  it('queues a refit for a docked ship when a newer hull is researched', () => {
    const { now } = setup((s, c) => {
      colonyOf(s, ALPHA).buildings['shipyard' as BuildingId] = 1;
      s.empires[ALPHA].research.levels.weapons = 1;
      return addFleet(s, c, ALPHA, homeOf(s, ALPHA).sector, ['frigate']);
    });
    fireEvent.click(button('Refit to Destroyer'));
    expect(colonyOf(now(), ALPHA).buildQueue).toMatchObject([{ kind: 'refit', hull: 'destroyer' }]);
    expect(screen.queryByRole('button', { name: 'Refit to Destroyer' })).toBeNull(); // already queued
  });

  it('offers no refit without the research', () => {
    setup((s, c) => {
      colonyOf(s, ALPHA).buildings['shipyard' as BuildingId] = 1;
      return addFleet(s, c, ALPHA, homeOf(s, ALPHA).sector, ['frigate']);
    });
    expect(screen.queryByRole('button', { name: /^Refit/ })).toBeNull();
  });

  it("shows a rival fleet's ships but no orders", () => {
    setup((s, c) => addFleet(s, c, BETA, homeOf(s, ALPHA).sector, ['frigate']));
    expect(screen.getByRole('heading', { name: 'Beta fleet' })).toBeTruthy();
    expect(screen.getByText('Frigate')).toBeTruthy();
    expect(screen.queryByText('Orders')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull();
  });
});

describe('ResearchScreen', () => {
  function setupResearch(prepare?: (state: GameState) => void) {
    const content = fixtureContent();
    const state = startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' });
    prepare?.(state);
    const session = createSession(content, state);
    render(<ResearchHarness session={session} />);
    return { allocation: () => session.getSnapshot().state.empires[ALPHA].research.allocation };
  }

  it('shows every field with its level, progress and forecast', () => {
    setupResearch((s) => {
      s.empires[ALPHA].research.levels.biology = 2;
      s.empires[ALPHA].research.progress.biology = 7;
    });
    expect(screen.getByRole('dialog', { name: 'Research' })).toBeTruthy();
    expect(screen.getByTestId('level-biology').textContent).toBe('Level 2 / 10');
    expect(screen.getByTestId('level-weapons').textContent).toBe('Level 0 / 10');
    expect(screen.getByText(/^7 \/ 30 · /)).toBeTruthy();
    expect(screen.getByText(/Era 2 · \d+ research per turn/)).toBeTruthy();
    expect(screen.getByText(/Level 1: Destroyer/)).toBeTruthy();
    expect(screen.getByText(/\+5% food per level/)).toBeTruthy();
  });

  it('moving one share rebalances the others so the total stays 100', () => {
    const { allocation } = setupResearch();
    fireEvent.change(screen.getByLabelText('Weapons share'), { target: { value: '100' } });
    expect(allocation()).toEqual({ biology: 0, construction: 0, energy: 0, propulsion: 0, computing: 0, weapons: 100 });
    expect(screen.getByTestId('share-weapons').textContent).toBe('100%');

    fireEvent.change(screen.getByLabelText('Biology share'), { target: { value: '40' } });
    expect(allocation()).toMatchObject({ biology: 40, weapons: 60 });

    fireEvent.click(screen.getByRole('button', { name: 'Even split' }));
    expect(allocation()).toEqual(evenAllocation());
  });

  it('closes on request', () => {
    setupResearch();
    onClose.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('rebalance', () => {
  const total = (a: Record<string, number>) => Object.values(a).reduce((x, y) => x + y, 0);

  it('always sums to 100 with whole, non-negative shares', () => {
    for (const field of FIELDS) {
      for (const value of [0, 1, 17, 33, 50, 99, 100, 140, -5, 12.6]) {
        const next = rebalance(evenAllocation(), field, value);
        expect(total(next)).toBe(100);
        for (const f of FIELDS) {
          expect(Number.isInteger(next[f])).toBe(true);
          expect(next[f]).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('keeps the other fields in proportion', () => {
    const start = { biology: 60, construction: 30, energy: 10, propulsion: 0, computing: 0, weapons: 0 };
    expect(rebalance(start, 'weapons', 50)).toEqual({ biology: 30, construction: 15, energy: 5, propulsion: 0, computing: 0, weapons: 50 });
  });

  it('shares evenly when every other field was at zero', () => {
    const start = { biology: 100, construction: 0, energy: 0, propulsion: 0, computing: 0, weapons: 0 };
    expect(rebalance(start, 'biology', 50)).toEqual({ biology: 50, construction: 10, energy: 10, propulsion: 10, computing: 10, weapons: 10 });
  });
});
