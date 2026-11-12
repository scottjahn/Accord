import { describe, expect, it } from 'vitest';
import {
  FIELDS,
  distributeResearch,
  eraOf,
  evenAllocation,
  forecastResearch,
  getOutputs,
  levelCost,
  meetsRequirements,
  newResearchState,
  processTurn,
  submitCommand,
  type BuildingId,
  type FieldId,
  type HullId,
} from '../src/sim';
import { ALPHA, BETA, colonyOf, homeOf, newGame } from './fixture';

const focus = (field: FieldId): Record<FieldId, number> =>
  Object.fromEntries(FIELDS.map((f) => [f, f === field ? 100 : 0])) as Record<FieldId, number>;

describe('research', () => {
  it('starts every field at level 0 with an even split summing to 100', () => {
    const { state } = newGame();
    const research = state.empires[ALPHA].research;
    expect(Object.values(research.levels)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Object.values(evenAllocation()).reduce((a, b) => a + b, 0)).toBe(100);
    expect(research.allocation).toEqual({ biology: 17, construction: 17, energy: 17, propulsion: 17, computing: 16, weapons: 16 });
  });

  it('splits points by allocation and gives rounding leftovers to the largest remainders', () => {
    const research = newResearchState();
    research.allocation = { biology: 50, construction: 30, energy: 20, propulsion: 0, computing: 0, weapons: 0 };
    // 4.5, 2.7, 1.8 round down to 4 + 2 + 1; the 2 left over go to energy (.8) and construction (.7)
    expect(distributeResearch(research, 9)).toEqual({ biology: 4, construction: 3, energy: 2, propulsion: 0, computing: 0, weapons: 0 });
    expect(Object.values(distributeResearch(research, 0)).every((n) => n === 0)).toBe(true);
    // A small income on an even split still reaches several fields.
    expect(distributeResearch(newResearchState(), 4)).toEqual({ biology: 1, construction: 1, energy: 1, propulsion: 1, computing: 0, weapons: 0 });
  });

  it('gives nothing to fields at the maximum level and reroutes their share', () => {
    const research = newResearchState();
    research.allocation = { biology: 50, construction: 50, energy: 0, propulsion: 0, computing: 0, weapons: 0 };
    research.levels.biology = 10;
    expect(distributeResearch(research, 10)).toMatchObject({ biology: 0, construction: 10 });
  });

  it('levels a field up when progress reaches the cost and carries the rest over', () => {
    const { state, content } = newGame();
    const alpha = state.empires[ALPHA];
    alpha.research.allocation = focus('weapons');
    alpha.research.progress.weapons = 9; // level 1 costs 10; home makes 1 research a turn
    const { state: next, events } = processTurn(state, content);
    expect(next.empires[ALPHA].research.levels.weapons).toBe(1);
    expect(next.empires[ALPHA].research.progress.weapons).toBe(0);
    expect(events).toContainEqual({ type: 'researchCompleted', empire: ALPHA, field: 'weapons', level: 1 });
    expect(next.empires[BETA].research.levels.weapons).toBe(0);
  });

  it('can gain several levels in one turn and stops at the maximum', () => {
    const { state, content } = newGame();
    const research = state.empires[ALPHA].research;
    research.allocation = focus('energy');
    research.progress.energy = 35; // 10 + 20 = two levels, 5 + 1 left over
    let next = processTurn(state, content).state;
    expect(next.empires[ALPHA].research.levels.energy).toBe(2);
    expect(next.empires[ALPHA].research.progress.energy).toBe(6);

    next.empires[ALPHA].research.levels.energy = 9;
    next.empires[ALPHA].research.progress.energy = 500;
    next = processTurn(next, content).state;
    expect(next.empires[ALPHA].research.levels.energy).toBe(10);
    expect(next.empires[ALPHA].research.progress.energy).toBe(0);
    expect(levelCost(10, content)).toBeNull();
  });

  it('adds a traceable percent bonus per level to the matching output', () => {
    const { state, content } = newGame();
    state.empires[ALPHA].research.levels.biology = 3;
    const food = getOutputs(state, homeOf(state, ALPHA).id, content).food;
    // (24 + 4) x (100 + 10 - 5 + 15)% = 33.6 -> 33
    expect(food.total).toBe(33);
    expect(food.lines).toContainEqual({ source: 'Biology level 3', kind: 'percent', value: 15 });
    expect(getOutputs(state, homeOf(state, BETA).id, content).food.total).toBe(29);
  });

  it('derives the era from total levels', () => {
    const { state, content } = newGame();
    const research = state.empires[ALPHA].research;
    expect(eraOf(research, content)).toBe(1);
    research.levels.biology = 2;
    expect(eraOf(research, content)).toBe(2);
    research.levels.weapons = 6;
    expect(eraOf(research, content)).toBe(5);
  });

  it('checks requirements against research levels', () => {
    const research = newResearchState();
    expect(meetsRequirements(research, {})).toBe(true);
    expect(meetsRequirements(research, { weapons: 1 })).toBe(false);
    research.levels.weapons = 1;
    expect(meetsRequirements(research, { weapons: 1 })).toBe(true);
    expect(meetsRequirements(research, { weapons: 1, computing: 2 })).toBe(false);
  });

  it('locks buildings and hulls until their research is done', () => {
    const { state, content } = newGame();
    const home = homeOf(state, ALPHA).id;
    colonyOf(state, ALPHA).buildings['shipyard' as BuildingId] = 1;
    const vault = { type: 'enqueueBuild', empire: ALPHA, system: home, building: 'vault' as BuildingId } as const;
    const destroyer = { type: 'enqueueShip', empire: ALPHA, system: home, hull: 'destroyer' as HullId } as const;

    const lockedBuilding = submitCommand(state, vault, content);
    expect(!lockedBuilding.ok && lockedBuilding.error).toMatchObject({ code: 'locked', message: 'Vault needs Computing 1' });
    const lockedHull = submitCommand(state, destroyer, content);
    expect(!lockedHull.ok && lockedHull.error.code).toBe('locked');

    state.empires[ALPHA].research.levels.computing = 1;
    state.empires[ALPHA].research.levels.weapons = 1;
    expect(submitCommand(state, vault, content).ok).toBe(true);
    expect(submitCommand(state, destroyer, content).ok).toBe(true);
  });

  it('accepts only allocations of whole percents summing to 100', () => {
    const { state, content } = newGame();
    const set = (allocation: unknown) =>
      submitCommand(state, { type: 'setResearchAllocation', empire: ALPHA, allocation: allocation as Record<FieldId, number> }, content);
    const ok = set(focus('propulsion'));
    expect(ok.ok && ok.value.empires[ALPHA].research.allocation).toEqual(focus('propulsion'));
    expect(state.empires[ALPHA].research.allocation.propulsion).toBe(17);
    expect(set({ ...focus('propulsion'), weapons: 1 }).ok).toBe(false);
    expect(set({ ...focus('propulsion'), propulsion: 99.5, weapons: 0.5 }).ok).toBe(false);
    expect(set({ biology: 100 }).ok).toBe(false);
    expect(set({ ...focus('propulsion'), propulsion: 110, weapons: -10 }).ok).toBe(false);
  });

  it('forecasts turns to the next level in each field', () => {
    const { state, content } = newGame();
    colonyOf(state, ALPHA).allocation = { food: 5, industry: 0, energy: 0, intel: 0, research: 5 };
    state.empires[ALPHA].research.allocation = focus('computing');
    state.empires[ALPHA].research.progress.computing = 4;
    const forecast = forecastResearch(state, ALPHA, content);
    // 5 research x 110% (Alpha) = 5 a turn; 6 more needed -> 2 turns
    expect(forecast.computing).toEqual({ level: 0, progress: 4, cost: 10, perTurn: 5, turnsLeft: 2 });
    expect(forecast.weapons).toMatchObject({ perTurn: 0, turnsLeft: null });

    let s = state;
    s = processTurn(s, content).state;
    expect(s.empires[ALPHA].research.levels.computing).toBe(0);
    s = processTurn(s, content).state;
    expect(s.empires[ALPHA].research.levels.computing).toBe(1);
  });
});
