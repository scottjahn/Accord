import { describe, expect, it } from 'vitest';
import { growthCost, processTurn, type BuildingId } from '../src/sim';
import { ALPHA, BETA, colonyOf, homeOf, newGame } from './fixture';

const B = (id: string) => id as BuildingId;

describe('processTurn', () => {
  it('advances the turn and does not modify the input state', () => {
    const { state, content } = newGame();
    const before = structuredClone(state);
    const { state: next } = processTurn(state, content);
    expect(state).toEqual(before);
    expect(next.turn).toBe(2);
    expect(next).not.toBe(state);
  });

  it('banks research and intel for the owning empire', () => {
    const banked = (s: typeof state, e: typeof ALPHA) => Object.values(s.empires[e].research.progress).reduce((a, b) => a + b, 0);
    const { state, content } = newGame();
    colonyOf(state, ALPHA).allocation = { food: 6, industry: 0, energy: 1, intel: 2, research: 1 };
    const { state: next } = processTurn(state, content);
    expect(banked(next, ALPHA)).toBe(1);
    expect(next.empires[ALPHA].intelPool).toBe(2);
    expect(banked(next, BETA)).toBe(1);
    expect(next.empires[BETA].intelPool).toBe(0);
  });
});

describe('food and growth', () => {
  it('banks a surplus and counts it toward growth', () => {
    const { state, content } = newGame();
    // food 29, eaten 20 -> surplus 9
    const { state: next, events } = processTurn(state, content);
    const colony = colonyOf(next, ALPHA);
    expect(colony.foodStock).toBe(9);
    expect(colony.growthProgress).toBe(9);
    expect(colony.population).toBe(10);
    expect(events).toEqual([]);
  });

  it('grows by one when progress reaches the growth cost', () => {
    const { state, content } = newGame();
    expect(growthCost(10, content.rules)).toBe(60);
    colonyOf(state, ALPHA).growthProgress = 55;
    const { state: next, events } = processTurn(state, content);
    const colony = colonyOf(next, ALPHA);
    expect(colony.population).toBe(11);
    expect(colony.growthProgress).toBe(4); // 55 + 9 - 60
    expect(events).toContainEqual({ type: 'populationGrew', system: homeOf(next, ALPHA).id, population: 11 });
  });

  it('stops growing at the population cap and caps the stockpile', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, ALPHA);
    colony.population = 40;
    colony.allocation = { food: 20, industry: 0, energy: 1, intel: 0, research: 0 };
    colony.foodStock = 398;
    colony.growthProgress = 30;
    const { state: next, events } = processTurn(state, content);
    const after = colonyOf(next, ALPHA);
    expect(after.population).toBe(40);
    expect(after.growthProgress).toBe(0);
    expect(after.foodStock).toBe(400); // 398 + 8 surplus, capped at 10 per pop
    expect(events.filter((e) => 'system' in e && e.system === homeOf(next, ALPHA).id)).toEqual([]);
  });

  it('draws down the stockpile before anyone starves', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, ALPHA);
    colony.allocation = { food: 0, industry: 9, energy: 1, intel: 0, research: 0 };
    colony.foodStock = 20;
    colony.growthProgress = 7;
    // food: farm 4 x 105% = 4; eaten 20 -> stock 20 + 4 - 20 = 4
    const { state: next, events } = processTurn(state, content);
    const after = colonyOf(next, ALPHA);
    expect(after.foodStock).toBe(4);
    expect(after.population).toBe(10);
    expect(after.growthProgress).toBe(7);
    expect(events.some((e) => e.type === 'starvation')).toBe(false);
  });

  it('starves when the stockpile cannot cover the deficit, and lays off workers', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, ALPHA);
    colony.allocation = { food: 0, industry: 8, energy: 1, intel: 0, research: 1 };
    colony.foodStock = 10;
    colony.growthProgress = 7;
    const { state: next, events } = processTurn(state, content);
    const after = colonyOf(next, ALPHA);
    expect(after.population).toBe(9);
    expect(after.foodStock).toBe(0);
    expect(after.growthProgress).toBe(0);
    // research is laid off first
    expect(after.allocation).toEqual({ food: 0, industry: 8, energy: 1, intel: 0, research: 0 });
    expect(events).toContainEqual({ type: 'starvation', system: homeOf(next, ALPHA).id, lost: 1, population: 9 });
  });

  it('never starves a colony below one population', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, ALPHA);
    colony.population = 1;
    colony.buildings = {};
    colony.allocation = { food: 0, industry: 1, energy: 0, intel: 0, research: 0 };
    const { state: next } = processTurn(state, content);
    expect(colonyOf(next, ALPHA).population).toBe(1);
  });
});

describe('build queue', () => {
  it('spends industry on the first item', () => {
    const { state, content } = newGame();
    colonyOf(state, ALPHA).buildQueue = [{ kind: 'building', building: B('factory'), progress: 0 }];
    const { state: next, events } = processTurn(state, content);
    expect(colonyOf(next, ALPHA).buildQueue).toEqual([{ kind: 'building', building: 'factory', progress: 4 }]);
    expect(colonyOf(next, ALPHA).buildings).toEqual({ farm: 1, reactor: 1 });
    expect(events).toEqual([]);
  });

  it('completes an item and carries the overflow into the next', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, ALPHA);
    colony.allocation = { food: 0, industry: 10, energy: 0, intel: 0, research: 0 };
    colony.foodStock = 100;
    colony.buildQueue = [
      { kind: 'building', building: B('factory'), progress: 50 },
      { kind: 'building', building: B('lab'), progress: 0 },
    ];
    // industry 20: 10 finishes the factory, 10 goes to the lab
    const { state: next, events } = processTurn(state, content);
    const after = colonyOf(next, ALPHA);
    expect(after.buildings).toEqual({ farm: 1, reactor: 1, factory: 1 });
    expect(after.buildQueue).toEqual([{ kind: 'building', building: 'lab', progress: 10 }]);
    expect(events).toContainEqual({ type: 'buildCompleted', system: homeOf(next, ALPHA).id, building: 'factory' });
  });

  it('can finish several items in one turn', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, ALPHA);
    colony.buildQueue = [
      { kind: 'building', building: B('farm'), progress: 38 },
      { kind: 'building', building: B('reactor'), progress: 48 },
      { kind: 'building', building: B('lab'), progress: 0 },
    ];
    // industry 4: 2 + 2 finish both, nothing left over
    const { state: next, events } = processTurn(state, content);
    const after = colonyOf(next, ALPHA);
    expect(after.buildings).toEqual({ farm: 2, reactor: 2 });
    expect(after.buildQueue).toEqual([{ kind: 'building', building: 'lab', progress: 0 }]);
    expect(events.filter((e) => e.type === 'buildCompleted')).toHaveLength(2);
  });

  it('does nothing with an empty queue', () => {
    const { state, content } = newGame();
    const { state: next } = processTurn(state, content);
    expect(colonyOf(next, ALPHA).buildQueue).toEqual([]);
    expect(colonyOf(next, ALPHA).buildings).toEqual({ farm: 1, reactor: 1 });
  });

  it('uses the outputs from the start of the turn, so a new building helps next turn', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, ALPHA);
    colony.buildQueue = [{ kind: 'building', building: B('farm'), progress: 39 }];
    const { state: next } = processTurn(state, content);
    expect(colonyOf(next, ALPHA).buildings[B('farm')]).toBe(2);
    expect(colonyOf(next, ALPHA).foodStock).toBe(9); // still the one-farm surplus
  });
});
