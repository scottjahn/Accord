import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/data';
import { runGame } from '../src/runner/runGame';
import { hashState, type TurnEvent } from '../src/sim';

/**
 * Milestone 1 exit test: 500 turns run headless with no errors, on the shipped
 * content. runGame throws on any illegal agent command or broken invariant.
 */
describe('500-turn soak', () => {
  const content = loadContent();

  it.each([1, 2026])('seed %i runs 500 turns with sound state every turn', (seed) => {
    const events: TurnEvent[] = [];
    const final = runGame({
      content,
      seed,
      turns: 500,
      preset: 'small',
      factions: ['concord', 'vashran'],
      onTurn: (_state, turnEvents) => events.push(...turnEvents),
    });

    expect(final.turn).toBe(501);
    for (const empire of Object.values(final.empires)) {
      const colony = final.systems[empire.homeSystem].colony!;
      // The game actually progressed: colonies grew, built and banked points.
      expect(colony.population).toBeGreaterThan(content.rules.startingPopulation);
      expect(Object.values(empire.research.levels).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
      expect(empire.intelPool).toBeGreaterThan(0);
    }
    expect(events.some((e) => e.type === 'buildCompleted')).toBe(true);
    expect(events.some((e) => e.type === 'populationGrew')).toBe(true);
    expect(events.some((e) => e.type === 'starvation')).toBe(false);
  });

  it('runs the largest preset', () => {
    const final = runGame({ content, seed: 5, turns: 100, preset: 'large', factions: ['concord', 'vashran'] });
    expect(final.turn).toBe(101);
  });

  it('gives the same result for the same seed', () => {
    const run = () => runGame({ content, seed: 9, turns: 200, preset: 'small', factions: ['concord', 'vashran'] });
    expect(hashState(run())).toBe(hashState(run()));
  });
});
