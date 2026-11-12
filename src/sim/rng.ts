/**
 * Seeded PRNG (sfc32). The state is four int32s stored in GameState, so a saved
 * game continues the exact same roll sequence. All functions advance the state
 * in place; callers pass the rng of a state they already own (a clone).
 */
export type RngState = [number, number, number, number];

function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) | 0;
  };
}

export function seedRng(seed: number): RngState {
  const mix = splitmix32(seed);
  const state: RngState = [mix(), mix(), mix(), mix()];
  for (let i = 0; i < 12; i++) nextUint32(state);
  return state;
}

/** Uniform integer in [0, 2^32). */
export function nextUint32(s: RngState): number {
  let [a, b, c, d] = s;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  s[0] = a;
  s[1] = b;
  s[2] = c;
  s[3] = d;
  return t >>> 0;
}

/** Uniform integer in [min, max], both inclusive. */
export function nextInt(s: RngState, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new Error(`nextInt: invalid range [${min}, ${max}]`);
  }
  const range = max - min + 1;
  return min + Math.floor((nextUint32(s) / 4294967296) * range);
}

/** Fisher-Yates shuffle in place. */
export function shuffle<T>(s: RngState, items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextInt(s, 0, i);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
}
