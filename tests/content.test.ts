import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/data';
import { validateContent } from '../src/sim';
import { rawFixture } from './fixture';

function errorsFor(mutate: (raw: any) => void): string[] {
  const raw = structuredClone(rawFixture);
  mutate(raw);
  const result = validateContent(raw);
  return result.ok ? [] : result.error;
}

describe('content validation', () => {
  it('accepts the fixture and the shipped data', () => {
    expect(validateContent(structuredClone(rawFixture)).ok).toBe(true);
    expect(() => loadContent()).not.toThrow();
  });

  it('ships the two MVP factions', () => {
    expect(Object.keys(loadContent().factions).sort()).toEqual(['concord', 'vashran']);
  });

  it('rejects non-objects', () => {
    expect(validateContent(null).ok).toBe(false);
    expect(validateContent([]).ok).toBe(false);
  });

  it('rejects duplicate ids', () => {
    expect(errorsFor((r) => r.buildings.push(r.buildings[0]))).toContain('buildings.farm: duplicate id');
  });

  it('rejects a building with a non-positive cost', () => {
    expect(errorsFor((r) => (r.buildings[0].cost = 0)).join()).toMatch(/farm: cost/);
  });

  it('rejects an energy building that has upkeep', () => {
    expect(errorsFor((r) => (r.buildings[2].energyUpkeep = 1)).join()).toMatch(/reactor.*energyUpkeep 0/);
  });

  it('rejects an unknown output kind in an effect', () => {
    expect(errorsFor((r) => (r.buildings[0].effects[0].output = 'credits')).length).toBeGreaterThan(0);
  });

  it('rejects a preset with more systems than sectors', () => {
    expect(errorsFor((r) => (r.galaxyPresets[0].systems = 49)).join()).toMatch(/more systems than sectors/);
  });

  it('rejects too few names for the largest galaxy', () => {
    expect(errorsFor((r) => (r.names.suffixes = ['ra'])).join()).toMatch(/not enough prefix/);
  });

  it('rejects a starting allocation larger than the starting population', () => {
    expect(errorsFor((r) => (r.rules.startingAllocation.food = 20)).join()).toMatch(/startingAllocation/);
  });

  it('rejects unknown starting buildings and home planet types', () => {
    expect(errorsFor((r) => (r.rules.startingBuildings.palace = 1)).join()).toMatch(/unknown building palace/);
    expect(errorsFor((r) => (r.rules.homePlanets[0].type = 'lava')).join()).toMatch(/homePlanets/);
  });

  it('reports every problem, not just the first', () => {
    const errors = errorsFor((r) => {
      r.buildings[0].cost = -1;
      r.rules.foodPerPop = 1.5;
    });
    expect(errors.length).toBe(2);
  });
});
