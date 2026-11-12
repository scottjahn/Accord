import { describe, expect, it } from 'vitest';
import { runGame } from '../src/runner/runGame';
import { hashState, sortedKeys } from '../src/sim';
import { fixtureContent } from './fixture';

/**
 * Golden replay: a seeded 150-turn game on the fixed fixture content must end in
 * exactly the same state every time, on every machine.
 *
 * If this fails after an intentional rule change, check the summary diff makes
 * sense, then update the snapshot with `npx vitest run -u tests/golden.test.ts`.
 * If you did not mean to change a rule, the change broke determinism or behaviour.
 */
function play(seed: number) {
  return runGame({ content: fixtureContent(), seed, turns: 150, preset: 'tiny', factions: ['alpha', 'beta'] });
}

describe('golden replay', () => {
  it('is reproducible within a run', () => {
    expect(hashState(play(42))).toBe(hashState(play(42)));
  });

  it('matches the recorded final state', () => {
    const final = play(42);
    const summary = {
      hash: hashState(final),
      turn: final.turn,
      empires: sortedKeys(final.empires).map((id) => {
        const empire = final.empires[id];
        const colony = final.systems[empire.homeSystem].colony!;
        return {
          faction: empire.faction,
          research: empire.research.levels,
          colonies: Object.values(final.systems).filter((s) => s.colony?.owner === id).length,
          ships: Object.values(final.fleets).filter((f) => f.owner === id).reduce((n, f) => n + f.ships.length, 0),
          intelPool: empire.intelPool,
          population: colony.population,
          buildings: colony.buildings,
        };
      }),
    };
    expect(summary).toMatchSnapshot();
  });
});
