import { describe, expect, it } from 'vitest';
import { forecastColony, processTurn, type BuildingId, type GameState } from '../src/sim';
import { ALPHA, colonyOf, homeOf, newGame } from './fixture';

const B = (id: string) => id as BuildingId;

describe('colony forecast', () => {
  it('reports the surplus and turns to grow for the starting colony', () => {
    const { state, content } = newGame();
    const forecast = forecastColony(state, homeOf(state, ALPHA), content);
    // food 29, eaten 20; growth costs 60
    expect(forecast.foodSurplus).toBe(9);
    expect(forecast.turnsToGrow).toBe(7);
    expect(forecast.turnsToStarve).toBeNull();
    expect(forecast.idleWorkers).toBe(0);
    expect(forecast.offline).toEqual({});
    expect(forecast.queue).toEqual([]);
  });

  it('predicts growth on the turn it actually happens', () => {
    const { state, content } = newGame();
    const predicted = forecastColony(state, homeOf(state, ALPHA), content).turnsToGrow!;
    let s: GameState = state;
    for (let i = 0; i < predicted - 1; i++) s = processTurn(s, content).state;
    expect(colonyOf(s, ALPHA).population).toBe(10);
    s = processTurn(s, content).state;
    expect(colonyOf(s, ALPHA).population).toBe(11);
  });

  it('does not forecast growth at the population cap', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, ALPHA);
    colony.population = 40;
    colony.allocation = { food: 25, industry: 0, energy: 0, intel: 0, research: 0 };
    const forecast = forecastColony(state, homeOf(state, ALPHA), content);
    expect(forecast.foodSurplus).toBeGreaterThan(0);
    expect(forecast.turnsToGrow).toBeNull();
    expect(forecast.idleWorkers).toBe(15);
  });

  it('predicts starvation on the turn it actually happens', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, ALPHA);
    colony.allocation = { food: 0, industry: 9, energy: 1, intel: 0, research: 0 };
    colony.foodStock = 20;
    // food 4, eaten 20: 20 -> 4 -> starve on turn 2
    const forecast = forecastColony(state, homeOf(state, ALPHA), content);
    expect(forecast.foodSurplus).toBe(-16);
    expect(forecast.turnsToStarve).toBe(2);
    expect(forecast.turnsToGrow).toBeNull();

    const first = processTurn(state, content);
    expect(first.events.some((e) => e.type === 'starvation')).toBe(false);
    const second = processTurn(first.state, content);
    expect(second.events.some((e) => e.type === 'starvation')).toBe(true);
  });

  it('lists buildings without power', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, ALPHA);
    colony.buildings = { [B('factory')]: 3, [B('farm')]: 1 } as Record<BuildingId, number>;
    colony.allocation = { food: 0, industry: 2, energy: 2, intel: 0, research: 0 };
    expect(forecastColony(state, homeOf(state, ALPHA), content).offline).toEqual({ factory: 1, farm: 1 });
  });

  it('gives cumulative turns for each queued building', () => {
    const { state, content } = newGame();
    colonyOf(state, ALPHA).buildQueue = [
      { kind: 'building', building: B('factory'), progress: 50 },
      { kind: 'building', building: B('lab'), progress: 0 },
    ];
    // industry 4: 10 left -> 3 turns; then 80 more -> 90 / 4 -> 23 turns
    expect(forecastColony(state, homeOf(state, ALPHA), content).queue).toEqual([
      { name: 'Factory', cost: 60, turnsLeft: 3 },
      { name: 'Lab', cost: 80, turnsLeft: 23 },
    ]);
  });

  it('predicts the turn a building completes', () => {
    const { state, content } = newGame();
    colonyOf(state, ALPHA).buildQueue = [{ kind: 'building', building: B('factory'), progress: 50 }];
    let s: GameState = state;
    for (let i = 0; i < 2; i++) s = processTurn(s, content).state;
    expect(colonyOf(s, ALPHA).buildQueue).toHaveLength(1);
    s = processTurn(s, content).state;
    expect(colonyOf(s, ALPHA).buildQueue).toHaveLength(0);
  });

  it('marks the queue as stalled with no industry', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, ALPHA);
    colony.allocation = { food: 6, industry: 0, energy: 1, intel: 0, research: 3 };
    colony.buildQueue = [{ kind: 'building', building: B('factory'), progress: 0 }];
    expect(forecastColony(state, homeOf(state, ALPHA), content).queue).toEqual([{ name: 'Factory', cost: 60, turnsLeft: null }]);
  });

  it('throws for a system with no colony', () => {
    const { state, content } = newGame();
    const empty = Object.values(state.systems).find((s) => !s.colony)!;
    expect(() => forecastColony(state, empty, content)).toThrow(/no colony/);
  });
});
