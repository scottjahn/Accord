import { describe, expect, it } from 'vitest';
import { createSession, startNewGame } from '../src/game/session';
import { SKIP_LIMIT, idleKeys, turnNeedsPlayer } from '../src/game/skip';
import type { BuildingId, FleetId, GameState, HullId, SystemId, TurnEvent } from '../src/sim';
import { ALPHA, BETA, colonyOf, fixtureContent, homeOf, newGame } from './fixture';

const B = (id: string) => id as BuildingId;
const H = (id: string) => id as HullId;

/** A game where nothing of the player's is newly idle, so only the events decide. */
function quiet() {
  const { state, content } = newGame(3);
  const accepted = idleKeys(state, ALPHA, content);
  const needs = (events: TurnEvent[], s: GameState = state) => turnNeedsPlayer(s, ALPHA, events, content, accepted);
  return { state, content, accepted, needs, home: homeOf(state, ALPHA).id };
}

describe('when skipping ahead stops', () => {
  it('carries on through routine events', () => {
    const { needs, home } = quiet();
    expect(needs([])).toBe(false);
    expect(
      needs([
        { type: 'populationGrew', system: home, population: 11 },
        { type: 'buildCompleted', system: home, building: B('farm') },
      ]),
    ).toBe(false);
  });

  it('stops for anything of the player’s that may need an order', () => {
    const { needs, home, state } = quiet();
    const fleet = Object.keys(state.fleets)[0] as FleetId;
    expect(needs([{ type: 'shipBuilt', system: home, hull: H('scout'), fleet }])).toBe(true);
    expect(needs([{ type: 'fleetArrived', empire: ALPHA, fleet, sector: { x: 0, y: 0 } }])).toBe(true);
    expect(needs([{ type: 'researchCompleted', empire: ALPHA, field: 'weapons', level: 1 }])).toBe(true);
    expect(needs([{ type: 'starvation', system: home, lost: 1, population: 9 }])).toBe(true);
  });

  it('ignores what happens to other empires, except a war on the player', () => {
    const { needs, state } = quiet();
    const theirs = homeOf(state, BETA).id;
    const third = 'emp-3' as typeof ALPHA;
    expect(needs([{ type: 'shipBuilt', system: theirs, hull: H('scout'), fleet: 'f-x' as FleetId }])).toBe(false);
    expect(needs([{ type: 'researchCompleted', empire: BETA, field: 'weapons', level: 1 }])).toBe(false);
    expect(needs([{ type: 'warDeclared', by: BETA, on: third }])).toBe(false);
    expect(needs([{ type: 'warDeclared', by: BETA, on: ALPHA }])).toBe(true);
    expect(needs([{ type: 'warDeclared', by: ALPHA, on: BETA }])).toBe(true);
  });

  it('stops when something goes idle that was not idle when the skip began', () => {
    const { state, content } = newGame(3);
    const colony = colonyOf(state, ALPHA);
    colony.buildQueue = [{ kind: 'building', building: B('lab'), progress: 0 }];
    const accepted = idleKeys(state, ALPHA, content);
    expect(turnNeedsPlayer(state, ALPHA, [], content, accepted)).toBe(false);

    // The queue runs dry: new, so stop. Had it been empty all along, the player chose to leave it.
    const dry = structuredClone(state);
    colonyOf(dry, ALPHA).buildQueue = [];
    expect(turnNeedsPlayer(dry, ALPHA, [], content, accepted)).toBe(true);
    expect(turnNeedsPlayer(dry, ALPHA, [], content, idleKeys(dry, ALPHA, content))).toBe(false);
  });

  it('stops when the game is over or an offer is waiting', () => {
    const { state, needs } = quiet();
    const won = structuredClone(state);
    won.winner = BETA;
    expect(needs([], won)).toBe(true);

    const offered = structuredClone(state);
    offered.offers.push({ id: 'o-1', from: BETA, to: ALPHA, type: 'peace', turn: 1, terms: null });
    expect(needs([], offered)).toBe(true);
  });
});

describe('session.skipAhead', () => {
  function session() {
    const content = fixtureContent();
    return createSession(content, startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' }));
  }

  it('plays several turns in one go and says how many', () => {
    const s = session();
    const home = homeOf(s.getSnapshot().state, ALPHA).id as SystemId;
    // Send every fleet nowhere and queue plenty, so nothing needs the player for a while.
    for (let i = 0; i < 6; i++) s.dispatch({ type: 'enqueueBuild', empire: ALPHA, system: home, building: B('farm') });
    let published = 0;
    s.subscribe(() => published++);
    const played = s.skipAhead(SKIP_LIMIT);
    const { state, turnsPlayed } = s.getSnapshot();
    expect(played).toBeGreaterThan(1);
    expect(played).toBeLessThanOrEqual(SKIP_LIMIT);
    expect(turnsPlayed).toBe(played);
    expect(state.turn).toBe(1 + played);
    // One snapshot for the whole skip, so the autosave and the screen update once.
    expect(published).toBe(1);
  });

  it('stops on the turn a ship is launched, not after it', () => {
    const content = fixtureContent();
    const start = startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' });
    colonyOf(start, ALPHA).buildings[B('shipyard')] = 1;
    const s = createSession(content, start);
    const home = homeOf(start, ALPHA).id as SystemId;
    expect(s.dispatch({ type: 'enqueueShip', empire: ALPHA, system: home, hull: H('scout') })).toBe(true);
    for (let i = 0; i < 6; i++) s.dispatch({ type: 'enqueueBuild', empire: ALPHA, system: home, building: B('farm') });

    const launched = (events: TurnEvent[]) => events.some((e) => e.type === 'shipBuilt' && e.system === home);
    let guard = 0;
    while (!launched(s.getSnapshot().lastEvents) && guard++ < 30) s.skipAhead(SKIP_LIMIT);
    const { state, lastEvents } = s.getSnapshot();
    expect(launched(lastEvents)).toBe(true);

    // Replaying one turn at a time, the launch happens on the very turn the skip stopped at.
    const replay = createSession(content, start);
    replay.dispatch({ type: 'enqueueShip', empire: ALPHA, system: home, hull: H('scout') });
    for (let i = 0; i < 6; i++) replay.dispatch({ type: 'enqueueBuild', empire: ALPHA, system: home, building: B('farm') });
    while (!launched(replay.getSnapshot().lastEvents)) replay.endTurn();
    expect(state.turn).toBe(replay.getSnapshot().state.turn);
  });

  it('is the same game as ending the turns one by one', () => {
    const a = session();
    const b = session();
    const played = a.skipAhead(4);
    for (let i = 0; i < played; i++) b.endTurn();
    expect(a.getSnapshot().state).toEqual(b.getSnapshot().state);
    expect(b.getSnapshot().turnsPlayed).toBe(1);
  });

  it('does nothing once the game is over', () => {
    const content = fixtureContent();
    const state = startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' });
    state.winner = BETA;
    const s = createSession(content, state);
    expect(s.skipAhead(SKIP_LIMIT)).toBe(0);
    expect(s.getSnapshot().state.turn).toBe(1);
  });
});
