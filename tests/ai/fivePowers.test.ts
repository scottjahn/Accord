import { describe, expect, it } from 'vitest';
import { loadContent } from '../../src/data';
import { createSession, startNewGame } from '../../src/game/session';
import { runGame } from '../../src/runner/runGame';
import { coloniesOf, deserialize, serialize, sortedKeys } from '../../src/sim';

const content = loadContent();
const all = sortedKeys(content.factions);

/**
 * Milestone 8 part A exit test: all five powers share a medium galaxy and the
 * game plays through headless, every command legal and every invariant held
 * (runGame checks both each turn), with each power using what is its own.
 */
describe('a five-power game', () => {
  it('runs headless for 200 turns with every power growing and using its own content', () => {
    const state = runGame({ content, seed: 10, turns: 200, preset: 'medium', factions: all });
    const empires = sortedKeys(state.empires);
    expect(empires).toHaveLength(5);
    for (const id of empires) {
      const empire = state.empires[id];
      const colonies = coloniesOf(state, id);
      expect(colonies.length).toBeGreaterThanOrEqual(5);
      expect(empire.credits).toBeGreaterThan(0);
      // Nobody ends up with something only another power can build.
      for (const system of colonies) {
        for (const building of sortedKeys(system.colony!.buildings)) {
          const owner = content.buildings[building].faction;
          // Captured and bought colonies keep what was there, so only judge the home.
          if (system.id === empire.homeSystem) expect(owner === null || owner === empire.faction).toBe(true);
        }
      }
      const own = sortedKeys(content.buildings).filter((b) => content.buildings[b].faction === empire.faction);
      expect(own.length).toBe(2);
      expect(colonies.some((s) => own.some((b) => (s.colony!.buildings[b] ?? 0) > 0))).toBe(true);
    }
    const restored = deserialize(serialize(state));
    expect(restored.ok && restored.value).toEqual(state);
  }, 300_000);

  it.each(all)('can be played as %s against the other four', (faction) => {
    const opponents = all.filter((id) => id !== faction);
    const session = createSession(content, startNewGame(content, { seed: 3, preset: 'medium', faction, opponents }));
    for (let i = 0; i < 5; i++) session.endTurn();
    const { state, player } = session.getSnapshot();
    expect(state.turn).toBe(6);
    expect(state.empires[player].faction).toBe(faction);
    expect(sortedKeys(state.empires).map((id) => state.empires[id].faction).sort()).toEqual(all);
  });

  it('defaults to a duel with the chosen power\'s rival', () => {
    const state = startNewGame(content, { seed: 3, preset: 'small', faction: 'orrin' });
    expect(sortedKeys(state.empires).map((id) => state.empires[id].faction)).toEqual(['orrin', 'concord']);
  });
});
