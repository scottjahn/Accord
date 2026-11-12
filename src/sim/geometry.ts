import type { Sector } from './types';

/** Moves between sectors can be diagonal, so distance is Chebyshev. */
export function sectorDistance(a: Sector, b: Sector): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export const sectorKey = (s: Sector): string => `${s.x},${s.y}`;

export const sameSector = (a: Sector, b: Sector): boolean => a.x === b.x && a.y === b.y;

export function inBounds(galaxy: { width: number; height: number }, s: Sector): boolean {
  return Number.isInteger(s.x) && Number.isInteger(s.y) && s.x >= 0 && s.y >= 0 && s.x < galaxy.width && s.y < galaxy.height;
}

/** Keys of every sector within `range` of `centre`, clipped to the map. */
export function sectorsAround(galaxy: { width: number; height: number }, centre: Sector, range: number, into: Set<string>): void {
  for (let y = Math.max(0, centre.y - range); y <= Math.min(galaxy.height - 1, centre.y + range); y++) {
    for (let x = Math.max(0, centre.x - range); x <= Math.min(galaxy.width - 1, centre.x + range); x++) {
      into.add(`${x},${y}`);
    }
  }
}
