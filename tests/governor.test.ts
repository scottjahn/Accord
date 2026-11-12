import { describe, expect, it } from 'vitest';
import {
  OUTPUT_KINDS,
  checkInvariants,
  governorAllocation,
  processTurn,
  submitCommand,
  type BuildingId,
  type Command,
  type GameState,
  type Governor,
} from '../src/sim';
import { ALPHA, BETA, colonyOf, homeOf, newGame } from './fixture';

const B = (id: string) => id as BuildingId;
const assigned = (state: GameState) => OUTPUT_KINDS.reduce((sum, k) => sum + colonyOf(state, ALPHA).allocation[k], 0);

function setup() {
  const { state, content } = newGame();
  const home = homeOf(state, ALPHA).id;
  const apply = (s: GameState, cmd: Command): GameState => {
    const r = submitCommand(s, cmd, content);
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  const govern = (s: GameState, governor: Governor) => apply(s, { type: 'setGovernor', empire: ALPHA, system: home, governor });
  return { state, content, home, apply, govern };
}

describe('governor allocation', () => {
  it('feeds and powers the colony first, then splits the rest by weight', () => {
    const { state, content } = setup();
    // Reactor alone covers the farm, so no energy workers. Food target 22 needs 5 farmers.
    // Rest 5, nothing queued: industry weight moves to research -> intel 1, research 4.
    expect(governorAllocation(state, homeOf(state, ALPHA), content, 'balanced')).toEqual({
      food: 5,
      industry: 0,
      energy: 0,
      intel: 1,
      research: 4,
    });
  });

  it('uses industry when something is queued and gives rounding leftovers to the top weight', () => {
    const { state, content } = setup();
    colonyOf(state, ALPHA).buildQueue = [{ kind: 'building', building: B('factory'), progress: 0 }];
    // Rest 5 at 50/20/30: industry 2, intel 1, research 1, leftover 1 -> industry.
    expect(governorAllocation(state, homeOf(state, ALPHA), content, 'balanced')).toEqual({
      food: 5,
      industry: 3,
      energy: 0,
      intel: 1,
      research: 1,
    });
  });

  it('differs by governor', () => {
    const { state, content } = setup();
    colonyOf(state, ALPHA).buildQueue = [{ kind: 'building', building: B('factory'), progress: 0 }];
    const home = homeOf(state, ALPHA);
    expect(governorAllocation(state, home, content, 'growth')).toEqual({ food: 8, industry: 1, energy: 0, intel: 0, research: 1 });
    expect(governorAllocation(state, home, content, 'industry').industry).toBe(5);
    expect(governorAllocation(state, home, content, 'research').research).toBe(4);
  });

  it('assigns energy workers when buildings need more power than reactors give', () => {
    const { state, content } = setup();
    colonyOf(state, ALPHA).buildings = { [B('factory')]: 3, [B('farm')]: 1 } as Record<BuildingId, number>;
    // Upkeep 7 with no reactor: 4 workers x 2 x 105% = 8, but the cap is a third of 10 = 3.
    expect(governorAllocation(state, homeOf(state, ALPHA), content, 'balanced').energy).toBe(3);
  });

  it('stops growing food for growth at the population cap', () => {
    const { state, content } = setup();
    const colony = colonyOf(state, ALPHA);
    colony.population = 40;
    const allocation = governorAllocation(state, homeOf(state, ALPHA), content, 'growth');
    // (4w + 4) x 105% >= 80 needs 19 farmers and no more.
    expect(allocation.food).toBe(19);
    expect(OUTPUT_KINDS.reduce((sum, k) => sum + allocation[k], 0)).toBe(40);
  });

  it('never assigns more workers than the population', () => {
    const { state, content } = setup();
    const colony = colonyOf(state, ALPHA);
    for (const population of [1, 2, 3, 7, 13, 40]) {
      colony.population = population;
      for (const governor of ['balanced', 'growth', 'industry', 'research'] as const) {
        const a = governorAllocation(state, homeOf(state, ALPHA), content, governor);
        expect(OUTPUT_KINDS.reduce((sum, k) => sum + a[k], 0)).toBe(population);
        for (const k of OUTPUT_KINDS) expect(a[k]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('governor commands', () => {
  it('reassigns workers as soon as a governor is set', () => {
    const { state, govern } = setup();
    const next = govern(state, 'balanced');
    expect(colonyOf(next, ALPHA).governor).toBe('balanced');
    expect(colonyOf(next, ALPHA).allocation).toEqual({ food: 5, industry: 0, energy: 0, intel: 1, research: 4 });
    expect(colonyOf(state, ALPHA).governor).toBe('manual');
  });

  it('leaves the allocation alone when switching to manual', () => {
    const { state, govern } = setup();
    const governed = govern(state, 'research');
    const manual = govern(governed, 'manual');
    expect(colonyOf(manual, ALPHA).governor).toBe('manual');
    expect(colonyOf(manual, ALPHA).allocation).toEqual(colonyOf(governed, ALPHA).allocation);
  });

  it('lets the governor react to build queue changes', () => {
    const { state, home, apply, govern } = setup();
    const queued = apply(govern(state, 'balanced'), { type: 'enqueueBuild', empire: ALPHA, system: home, building: B('factory') });
    expect(colonyOf(queued, ALPHA).allocation.industry).toBe(3);
    const emptied = apply(queued, { type: 'dequeueBuild', empire: ALPHA, system: home, index: 0 });
    expect(colonyOf(emptied, ALPHA).allocation.industry).toBe(0);
  });

  it('switches to manual when the player sets an allocation', () => {
    const { state, home, apply, govern } = setup();
    const allocation = { food: 6, industry: 4, energy: 0, intel: 0, research: 0 };
    const next = apply(govern(state, 'balanced'), { type: 'setAllocation', empire: ALPHA, system: home, allocation });
    expect(colonyOf(next, ALPHA).governor).toBe('manual');
    expect(colonyOf(next, ALPHA).allocation).toEqual(allocation);
  });

  it('rejects unknown governors and other empires', () => {
    const { state, content, home } = setup();
    const bad = submitCommand(state, { type: 'setGovernor', empire: ALPHA, system: home, governor: 'tyrant' as Governor }, content);
    expect(!bad.ok && bad.error.code).toBe('unknownGovernor');
    const foreign = submitCommand(state, { type: 'setGovernor', empire: BETA, system: home, governor: 'balanced' }, content);
    expect(!foreign.ok && foreign.error.code).toBe('notOwner');
  });
});

describe('governors during the turn', () => {
  it('puts new population to work', () => {
    const { state, content, govern } = setup();
    const governed = govern(state, 'balanced');
    colonyOf(governed, ALPHA).growthProgress = 59;
    const { state: next } = processTurn(governed, content);
    expect(colonyOf(next, ALPHA).population).toBe(11);
    expect(assigned(next)).toBe(11);
    expect(checkInvariants(next, content)).toEqual([]);
  });

  it('leaves new population idle under the manual governor', () => {
    const { state, content } = setup();
    colonyOf(state, ALPHA).growthProgress = 59;
    const { state: next } = processTurn(state, content);
    expect(colonyOf(next, ALPHA).population).toBe(11);
    expect(assigned(next)).toBe(10);
  });

  it('moves workers off industry once the queue empties', () => {
    const { state, content, home, apply, govern } = setup();
    let s = apply(govern(state, 'industry'), { type: 'enqueueBuild', empire: ALPHA, system: home, building: B('farm') });
    colonyOf(s, ALPHA).buildQueue[0].progress = 39;
    expect(colonyOf(s, ALPHA).allocation.industry).toBeGreaterThan(0);
    s = processTurn(s, content).state;
    expect(colonyOf(s, ALPHA).buildQueue).toEqual([]);
    expect(colonyOf(s, ALPHA).allocation.industry).toBe(0);
  });
});
