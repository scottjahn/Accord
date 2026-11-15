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

/** How many named save slots the browser keeps, besides the autosave. */
export const SLOT_COUNT = 3;

export const slotKey = (slot: number): string => `accord.slot.${slot}`;

/** What one save slot holds: a game, nothing, or something that no longer loads. */
export interface SaveSlot {
  /** 1-based slot number. */
  slot: number;
  game: GameState | null;
  /** Why the slot's contents could not be read, if they could not. */
  problem: string | null;
}

/** Returns false if the save could not be written (storage blocked or full). */
export function writeSlot(storage: Store | null, slot: number, state: GameState): boolean {
  if (!storage || !Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) return false;
  try {
    storage.setItem(slotKey(slot), serialize(state));
    return true;
  } catch {
    return false;
  }
}

export function readSlot(storage: Store | null, slot: number): SaveSlot {
  const empty: SaveSlot = { slot, game: null, problem: null };
  if (!storage) return empty;
  try {
    const json = storage.getItem(slotKey(slot));
    if (json === null) return empty;
    const loaded = deserialize(json);
    return loaded.ok ? { slot, game: loaded.value, problem: null } : { slot, game: null, problem: loaded.error.message };
  } catch {
    return empty;
  }
}

/** Every slot in order, empty ones included. */
export function listSlots(storage: Store | null): SaveSlot[] {
  return Array.from({ length: SLOT_COUNT }, (_, i) => readSlot(storage, i + 1));
}

export function deleteSlot(storage: Store | null, slot: number): void {
  try {
    storage?.removeItem(slotKey(slot));
  } catch {
    // Nothing to delete if storage is unavailable.
  }
}

export function saveFileName(state: GameState): string {
  return `accord-seed-${state.seed}-turn-${state.turn}.json`;
}
