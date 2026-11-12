import { describe, expect, it } from 'vitest';
import { stepGame } from '../src/runner/runGame';
import { SAVE_VERSION, deserialize, hashState, serialize, type GameState } from '../src/sim';
import { newGame } from './fixture';

function advance(state: GameState, turns: number, content: ReturnType<typeof newGame>['content']): GameState {
  let s = state;
  for (let i = 0; i < turns; i++) s = stepGame(s, content).state;
  return s;
}

describe('save and load', () => {
  it('round-trips a new game exactly', () => {
    const { state } = newGame(8);
    const loaded = deserialize(serialize(state));
    expect(loaded.ok && loaded.value).toEqual(state);
  });

  it('round-trips a game in progress exactly', () => {
    const { state, content } = newGame(8);
    const mid = advance(state, 40, content);
    const loaded = deserialize(serialize(mid));
    expect(loaded.ok && loaded.value).toEqual(mid);
    expect(loaded.ok && serialize(loaded.value)).toBe(serialize(mid));
  });

  it('continues a loaded game exactly like the uninterrupted one', () => {
    const { state, content } = newGame(8);
    const straight = advance(state, 80, content);

    const loaded = deserialize(serialize(advance(state, 40, content)));
    if (!loaded.ok) throw new Error(loaded.error.message);
    const resumed = advance(loaded.value, 40, content);

    expect(hashState(resumed)).toBe(hashState(straight));
    expect(resumed).toEqual(straight);
  });

  it('rejects text that is not JSON', () => {
    const r = deserialize('{not json');
    expect(!r.ok && r.error.code).toBe('badJson');
  });

  it('rejects saves from another version', () => {
    const { state } = newGame();
    const r = deserialize(JSON.stringify({ ...state, saveVersion: SAVE_VERSION + 1 }));
    expect(!r.ok && r.error.code).toBe('wrongVersion');
  });

  it('rejects saves with missing parts', () => {
    const { state } = newGame();
    for (const key of ['seed', 'turn', 'rng', 'galaxy', 'systems', 'empires'] as const) {
      const broken: Record<string, unknown> = { ...state };
      delete broken[key];
      const r = deserialize(JSON.stringify(broken));
      expect(!r.ok && r.error.code, key).toBe('badShape');
    }
    expect(deserialize('[]').ok).toBe(false);
  });

  it('hashes equal states equally and different states differently', () => {
    const a = newGame(1).state;
    expect(hashState(a)).toBe(hashState(newGame(1).state));
    expect(hashState(a)).not.toBe(hashState(newGame(2).state));
    expect(hashState(a)).toMatch(/^[0-9a-f]{8}$/);
  });
});
