import { describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_KEY, clearAutosave, readAutosave, saveFileName, writeAutosave } from '../src/game/persistence';
import { createSession, humanEmpire, startNewGame } from '../src/game/session';
import { serialize, type BuildingId, type SystemId } from '../src/sim';
import { ALPHA, BETA, colonyOf, fixtureContent, homeOf, newGame } from './fixture';

const B = (id: string) => id as BuildingId;

function newSession(faction = 'beta') {
  const content = fixtureContent();
  const state = startNewGame(content, { seed: 3, preset: 'tiny', faction });
  return { content, session: createSession(content, state) };
}

describe('startNewGame', () => {
  it('makes the chosen faction human and every other faction an AI opponent', () => {
    const { session } = newSession('beta');
    const { state, player } = session.getSnapshot();
    expect(player).toBe(ALPHA); // the human is always the first empire
    expect(state.empires[ALPHA]).toMatchObject({ faction: 'beta', controller: 'human' });
    expect(state.empires[BETA]).toMatchObject({ faction: 'alpha', controller: 'ai' });
    expect(humanEmpire(state)).toBe(ALPHA);
  });

  it('starts the player under the balanced governor with everyone working', () => {
    const { session } = newSession();
    const colony = colonyOf(session.getSnapshot().state, ALPHA);
    expect(colony.governor).toBe('balanced');
    expect(Object.values(colony.allocation).reduce((a, b) => a + b, 0)).toBe(colony.population);
  });
});

describe('session', () => {
  it('applies accepted commands and publishes a new snapshot', () => {
    const { session } = newSession();
    const listener = vi.fn();
    session.subscribe(listener);
    const before = session.getSnapshot();
    const home = homeOf(before.state, ALPHA).id;

    expect(session.dispatch({ type: 'enqueueBuild', empire: ALPHA, system: home, building: B('lab') })).toBe(true);

    const after = session.getSnapshot();
    expect(after).not.toBe(before);
    expect(colonyOf(after.state, ALPHA).buildQueue).toEqual([{ building: 'lab', progress: 0 }]);
    expect(colonyOf(before.state, ALPHA).buildQueue).toEqual([]);
    expect(after.lastError).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the state and reports the reason when a command is rejected', () => {
    const { session } = newSession();
    const before = session.getSnapshot();
    const ok = session.dispatch({ type: 'enqueueBuild', empire: ALPHA, system: 'sys-999' as SystemId, building: B('lab') });
    expect(ok).toBe(false);
    expect(session.getSnapshot().state).toBe(before.state);
    expect(session.getSnapshot().lastError?.code).toBe('unknownSystem');

    const home = homeOf(before.state, ALPHA).id;
    session.dispatch({ type: 'enqueueBuild', empire: ALPHA, system: home, building: B('lab') });
    expect(session.getSnapshot().lastError).toBeNull();
  });

  it('returns the same snapshot object until something changes', () => {
    const { session } = newSession();
    expect(session.getSnapshot()).toBe(session.getSnapshot());
  });

  it('stops notifying after unsubscribe', () => {
    const { session } = newSession();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    unsubscribe();
    session.endTurn();
    expect(listener).not.toHaveBeenCalled();
  });

  it('ends the turn: the AI acts, the human is left alone, events are published', () => {
    const { session } = newSession();
    const before = session.getSnapshot().state;
    expect(colonyOf(before, BETA).governor).toBe('manual');

    session.endTurn();

    const { state, lastEvents } = session.getSnapshot();
    expect(state.turn).toBe(2);
    expect(Array.isArray(lastEvents)).toBe(true);
    // The AI opponent took its turn through the command API.
    expect(colonyOf(state, BETA).governor).toBe('balanced');
    expect(colonyOf(state, BETA).buildQueue.length).toBe(1);
    // Nobody queued anything for the human.
    expect(colonyOf(state, ALPHA).buildQueue).toEqual([]);
    expect(colonyOf(state, ALPHA).governor).toBe('balanced');
    expect(state.empires[ALPHA].researchPool).toBeGreaterThan(0);
  });

  it('round-trips a save through export and import', () => {
    const { content, session } = newSession();
    session.endTurn();
    session.endTurn();
    const json = session.exportSave();

    const other = createSession(content, startNewGame(content, { seed: 99, preset: 'tiny', faction: 'alpha' }));
    const listener = vi.fn();
    other.subscribe(listener);
    expect(other.importSave(json).ok).toBe(true);
    expect(other.getSnapshot().state).toEqual(session.getSnapshot().state);
    expect(other.getSnapshot().state.turn).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects bad saves and saves with no human player, keeping the current game', () => {
    const { session } = newSession();
    const before = session.getSnapshot();
    expect(session.importSave('nope').ok).toBe(false);
    const allAi = session.importSave(serialize(newGame().state));
    expect(!allAi.ok && allAi.error.message).toMatch(/human/);
    expect(session.getSnapshot()).toBe(before);
  });

  it('refuses to start a session with no human empire', () => {
    const { state, content } = newGame();
    expect(() => createSession(content, state)).toThrow(/human/);
  });
});

describe('persistence', () => {
  const memoryStorage = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  };

  it('writes and reads the autosave', () => {
    const storage = memoryStorage();
    const { state } = newGame(4);
    expect(readAutosave(storage)).toBeNull();
    expect(writeAutosave(storage, state)).toBe(true);
    const loaded = readAutosave(storage);
    expect(loaded?.ok && loaded.value).toEqual(state);
    clearAutosave(storage);
    expect(readAutosave(storage)).toBeNull();
  });

  it('reports a corrupt autosave instead of throwing', () => {
    const storage = memoryStorage();
    storage.setItem(AUTOSAVE_KEY, '{broken');
    expect(readAutosave(storage)?.ok).toBe(false);
  });

  it('works without storage and survives storage that throws', () => {
    const { state } = newGame();
    expect(writeAutosave(null, state)).toBe(false);
    expect(readAutosave(null)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(writeAutosave(broken, state)).toBe(false);
    expect(readAutosave(broken)).toBeNull();
    expect(() => clearAutosave(broken)).not.toThrow();
  });

  it('names save files by seed and turn', () => {
    expect(saveFileName(newGame(12).state)).toBe('accord-seed-12-turn-1.json');
  });
});
