import { SAVE_VERSION, type GameState, type Result } from './types';

export interface SaveError {
  code: 'badJson' | 'badShape' | 'wrongVersion';
  message: string;
}

/** GameState is plain JSON, so a save is just the state as text. */
export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function deserialize(json: string): Result<GameState, SaveError> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: { code: 'badJson', message: `Save is not valid JSON: ${(e as Error).message}` } };
  }
  const bad = (message: string): Result<GameState, SaveError> => ({ ok: false, error: { code: 'badShape', message } });

  if (!isObj(raw)) return bad('Save must be an object');
  if (raw.saveVersion !== SAVE_VERSION) {
    return {
      ok: false,
      error: {
        code: 'wrongVersion',
        message: `Save is version ${String(raw.saveVersion)}, this build reads version ${SAVE_VERSION}`,
      },
    };
  }
  if (!Number.isInteger(raw.seed)) return bad('Save has no seed');
  if (!Number.isInteger(raw.turn) || (raw.turn as number) < 1) return bad('Save has no valid turn');
  if (!Array.isArray(raw.rng) || raw.rng.length !== 4 || !raw.rng.every((n) => Number.isInteger(n))) {
    return bad('Save has no valid rng state');
  }
  if (!isObj(raw.galaxy) || !Number.isInteger(raw.galaxy.width) || !Number.isInteger(raw.galaxy.height)) {
    return bad('Save has no galaxy size');
  }
  if (!isObj(raw.systems) || !isObj(raw.empires)) return bad('Save has no systems or empires');

  return { ok: true, value: raw as unknown as GameState };
}

/** FNV-1a hash of the serialized state, as 8 hex digits. Used to compare runs. */
export function hashState(state: GameState): string {
  const text = serialize(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
