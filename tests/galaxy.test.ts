import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/data';
import { checkInvariants, createGame, sectorDistance, sortedKeys } from '../src/sim';
import { ALPHA, BETA, colonyOf, fixtureContent, homeOf, newGame } from './fixture';

describe('galaxy generation', () => {
  it('is identical for the same seed', () => {
    expect(newGame(11).state).toEqual(newGame(11).state);
  });

  it('differs between seeds', () => {
    expect(newGame(11).state.systems).not.toEqual(newGame(12).state.systems);
  });

  it('creates the preset number of systems in distinct sectors on the map', () => {
    const { state } = newGame(3);
    const systems = Object.values(state.systems);
    expect(systems).toHaveLength(12);
    expect(state.galaxy).toEqual({ width: 8, height: 6 });
    const sectors = new Set(systems.map((s) => `${s.sector.x},${s.sector.y}`));
    expect(sectors.size).toBe(12);
    for (const s of systems) {
      expect(s.sector.x).toBeGreaterThanOrEqual(0);
      expect(s.sector.x).toBeLessThan(8);
      expect(s.sector.y).toBeGreaterThanOrEqual(0);
      expect(s.sector.y).toBeLessThan(6);
    }
  });

  it('gives every system a unique name and a legal set of planets', () => {
    const { state, content } = newGame(4);
    const systems = Object.values(state.systems);
    expect(new Set(systems.map((s) => s.name)).size).toBe(systems.length);
    for (const s of systems) {
      if (s.colony) continue; // homes use the fixed home planets
      expect(s.planets.length).toBeGreaterThanOrEqual(1);
      expect(s.planets.length).toBeLessThanOrEqual(3);
      for (const p of s.planets) {
        const def = content.planetTypes[p.type];
        expect(def).toBeDefined();
        expect(p.maxPopulation).toBeGreaterThanOrEqual(def.maxPopulation[0]);
        expect(p.maxPopulation).toBeLessThanOrEqual(def.maxPopulation[1]);
        expect(p.foodBonus).toBe(def.foodBonus);
      }
    }
  });

  it('gives each empire an identical home colony in its own system', () => {
    const { state } = newGame(5);
    expect(sortedKeys(state.empires)).toEqual([ALPHA, BETA]);
    expect(state.empires[ALPHA].homeSystem).not.toBe(state.empires[BETA].homeSystem);
    expect(Object.values(state.systems).filter((s) => s.colony)).toHaveLength(2);

    for (const empire of [ALPHA, BETA]) {
      expect(homeOf(state, empire).planets.map((p) => [p.type, p.maxPopulation])).toEqual([
        ['terran', 30],
        ['barren', 10],
      ]);
      expect(colonyOf(state, empire)).toEqual({
        owner: empire,
        population: 10,
        growthProgress: 0,
        foodStock: 0,
        allocation: { food: 6, industry: 2, energy: 1, intel: 0, research: 1 },
        governor: 'manual',
        buildings: { farm: 1, reactor: 1 },
        buildQueue: [],
        morale: 100,
      });
    }
    expect(state.turn).toBe(1);
  });

  it('places homes far apart', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { state } = newGame(seed);
      const distance = sectorDistance(homeOf(state, ALPHA).sector, homeOf(state, BETA).sector);
      expect(distance).toBeGreaterThanOrEqual(3);
    }
  });

  it('starts in a state that passes the invariants', () => {
    const { state, content } = newGame(6);
    expect(checkInvariants(state, content)).toEqual([]);
  });

  it('rejects bad configs', () => {
    const content = fixtureContent();
    const empires = [{ faction: 'alpha', controller: 'ai' as const }];
    expect(() => createGame({ seed: 1, galaxyPreset: 'huge', empires }, content)).toThrow(/preset/);
    expect(() => createGame({ seed: 1.5, galaxyPreset: 'tiny', empires }, content)).toThrow(/seed/);
    expect(() => createGame({ seed: 1, galaxyPreset: 'tiny', empires: [] }, content)).toThrow(/empires/);
    expect(() =>
      createGame({ seed: 1, galaxyPreset: 'tiny', empires: [{ faction: 'nobody', controller: 'ai' }] }, content),
    ).toThrow(/faction/);
  });

  it('generates every shipped preset', () => {
    const content = loadContent();
    for (const preset of Object.values(content.galaxyPresets)) {
      const state = createGame(
        {
          seed: 1,
          galaxyPreset: preset.id,
          empires: [
            { faction: 'concord', controller: 'human' },
            { faction: 'vashran', controller: 'ai' },
          ],
        },
        content,
      );
      expect(Object.keys(state.systems)).toHaveLength(preset.systems);
      expect(checkInvariants(state, content)).toEqual([]);
    }
  });
});
