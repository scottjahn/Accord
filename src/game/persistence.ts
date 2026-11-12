import { deserialize, serialize, type GameState, type Result, type SaveError } from '../sim';

export const AUTOSAVE_KEY = 'accord.autosave';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Browser storage can be missing or throw (private windows, blocked site data),
 * so every access is guarded and the game works without it.
 */
export function browserStorage(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Returns false if the save could not be written. */
export function writeAutosave(storage: Store | null, state: GameState): boolean {
  if (!storage) return false;
  try {
    storage.setItem(AUTOSAVE_KEY, serialize(state));
    return true;
  } catch {
    return false;
  }
}

/** The autosaved game, an error if it is unreadable, or null if there is none. */
export function readAutosave(storage: Store | null): Result<GameState, SaveError> | null {
  if (!storage) return null;
  try {
    const json = storage.getItem(AUTOSAVE_KEY);
    return json === null ? null : deserialize(json);
  } catch {
    return null;
  }
}

export function clearAutosave(storage: Store | null): void {
  try {
    storage?.removeItem(AUTOSAVE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export function saveFileName(state: GameState): string {
  return `accord-seed-${state.seed}-turn-${state.turn}.json`;
}
