import { describe, expect, it } from 'vitest';
import { nextInt, nextUint32, seedRng, shuffle, type RngState } from '../src/sim/rng';

const take = (rng: RngState, n: number) => Array.from({ length: n }, () => nextUint32(rng));

describe('rng', () => {
  it('gives the same sequence for the same seed', () => {
    expect(take(seedRng(42), 50)).toEqual(take(seedRng(42), 50));
  });

  it('gives different sequences for different seeds', () => {
    expect(take(seedRng(1), 10)).not.toEqual(take(seedRng(2), 10));
  });

  it('keeps nextInt inside its inclusive range and reaches both ends', () => {
    const rng = seedRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const n = nextInt(rng, 3, 8);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(8);
      seen.add(n);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it('rejects an invalid range', () => {
    expect(() => nextInt(seedRng(1), 5, 4)).toThrow();
    expect(() => nextInt(seedRng(1), 0.5, 4)).toThrow();
  });

  it('continues the same sequence after a JSON round trip', () => {
    const rng = seedRng(99);
    take(rng, 10);
    const restored = JSON.parse(JSON.stringify(rng)) as RngState;
    expect(take(restored, 20)).toEqual(take(rng, 20));
  });

  it('shuffles deterministically and keeps every item', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const b = [...a];
    shuffle(seedRng(5), a);
    shuffle(seedRng(5), b);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(a).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
