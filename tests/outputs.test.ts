import { describe, expect, it } from 'vitest';
import { OUTPUT_KINDS, getColonyEconomy, getOutputs, totalOf, type BuildingId } from '../src/sim';
import { ALPHA, BETA, colonyOf, homeOf, newGame } from './fixture';

const ids = (o: Record<string, number>) => o as Record<BuildingId, number>;

describe('colony outputs', () => {
  it('computes the starting home outputs from workers, buildings and planets', () => {
    const { state, content } = newGame();
    const out = getOutputs(state, homeOf(state, ALPHA).id, content);

    // food: (6 workers x 4 + farm 4) x (100 + 10 - 5)% = 29.4 -> 29
    expect(out.food.total).toBe(29);
    expect(out.food.lines).toEqual([
      { source: '6 workers', kind: 'base', value: 24 },
      { source: 'Farm x1', kind: 'flat', value: 4 },
      { source: 'Planet 1 (Terran)', kind: 'percent', value: 10 },
      { source: 'Planet 2 (Barren)', kind: 'percent', value: -5 },
    ]);
    // energy: (1 worker x 2 + reactor 6) x 105% = 8.4 -> 8
    expect(out.energy.total).toBe(8);
    expect(out.industry.total).toBe(4);
    expect(out.intel.total).toBe(0);
    expect(out.intel.lines).toEqual([]);
  });

  it('applies faction percent modifiers', () => {
    const { state, content } = newGame();
    colonyOf(state, BETA).allocation = { food: 0, industry: 10, energy: 0, intel: 0, research: 0 };
    const industry = getOutputs(state, homeOf(state, BETA).id, content).industry;
    // 10 workers x 2 = 20, Beta +10% -> 22
    expect(industry.total).toBe(22);
    expect(industry.lines).toContainEqual({ source: 'Beta', kind: 'percent', value: 10 });

    colonyOf(state, ALPHA).allocation = { food: 0, industry: 10, energy: 0, intel: 0, research: 0 };
    expect(getOutputs(state, homeOf(state, ALPHA).id, content).industry.total).toBe(20);
  });

  it('floors fractional results', () => {
    const { state, content } = newGame();
    // Alpha research +10%: 9 workers -> 9.9 -> 9
    colonyOf(state, ALPHA).allocation = { food: 0, industry: 0, energy: 1, intel: 0, research: 9 };
    expect(getOutputs(state, homeOf(state, ALPHA).id, content).research.total).toBe(9);
  });

  it('stacks percent building effects per building', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, ALPHA);
    colony.buildings = ids({ lab: 2, reactor: 1 });
    colony.allocation = { food: 0, industry: 0, energy: 0, intel: 0, research: 10 };
    // 10 x (100 + 2 x 25 labs + 10 Alpha)% = 16
    expect(getOutputs(state, homeOf(state, ALPHA).id, content).research.total).toBe(16);
  });

  it('scales every output by morale', () => {
    const { state, content } = newGame();
    colonyOf(state, ALPHA).morale = 50;
    const out = getOutputs(state, homeOf(state, ALPHA).id, content);
    // food: 28 x (100 + 10 - 5 - 50)% = 15.4 -> 15
    expect(out.food.total).toBe(15);
    expect(out.industry.total).toBe(2);
    expect(out.food.lines).toContainEqual({ source: 'Morale', kind: 'percent', value: -50 });
  });

  it('never goes below zero', () => {
    const { state, content } = newGame();
    colonyOf(state, ALPHA).morale = -200;
    const out = getOutputs(state, homeOf(state, ALPHA).id, content);
    for (const kind of OUTPUT_KINDS) expect(out[kind].total).toBe(0);
  });

  it('powers buildings in id order and switches off the rest', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, ALPHA);
    colony.buildings = ids({ factory: 3, farm: 1 });
    colony.allocation = { food: 0, industry: 2, energy: 2, intel: 0, research: 0 };
    const economy = getColonyEconomy(state, homeOf(state, ALPHA).id, content);

    // energy: 2 workers x 2 x 105% = 4.2 -> 4; factories need 2 each, so 2 run and the farm gets nothing
    expect(economy.outputs.energy.total).toBe(4);
    expect(economy.online).toEqual({ factory: 2, farm: 0 });
    expect(economy.energyUsed).toBe(4);
    expect(economy.outputs.industry.total).toBe(2 * 2 + 2 * 3);
    expect(economy.outputs.food.total).toBe(0);
    expect(economy.outputs.food.lines.some((l) => l.source.startsWith('Farm'))).toBe(false);
  });

  it('reports food needs and population capacity', () => {
    const { state, content } = newGame();
    const economy = getColonyEconomy(state, homeOf(state, ALPHA).id, content);
    expect(economy.foodNeeded).toBe(20);
    expect(economy.maxPopulation).toBe(40);
  });

  it('keeps every total reproducible from its breakdown lines', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, BETA);
    colony.buildings = ids({ farm: 2, factory: 1, lab: 1, reactor: 2 });
    colony.morale = 115;
    const out = getOutputs(state, homeOf(state, BETA).id, content);
    for (const kind of OUTPUT_KINDS) expect(out[kind].total).toBe(totalOf(out[kind].lines));
  });

  it('throws for a system with no colony', () => {
    const { state, content } = newGame();
    const empty = Object.values(state.systems).find((s) => !s.colony)!;
    expect(() => getOutputs(state, empty.id, content)).toThrow(/no colony/);
  });
});
