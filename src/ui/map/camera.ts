/**
 * Pan, zoom and hit-test maths for the galaxy map. Pure functions with no
 * rendering, so they are unit tested.
 *
 * World space: one sector is SECTOR_SIZE units square, sector (0,0) at the origin.
 * Screen space: CSS pixels from the map's top-left corner.
 * screen = (world - camera) * zoom
 */
export const SECTOR_SIZE = 64;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

export interface Point {
  x: number;
  y: number;
}

export interface Camera {
  /** World coordinates shown at the screen's top-left corner. */
  x: number;
  y: number;
  zoom: number;
}

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export function sectorCenter(sector: Point): Point {
  return { x: (sector.x + 0.5) * SECTOR_SIZE, y: (sector.y + 0.5) * SECTOR_SIZE };
}

/** The sector containing a world point (may be off the map). */
export function worldToSector(world: Point): Point {
  return { x: Math.floor(world.x / SECTOR_SIZE), y: Math.floor(world.y / SECTOR_SIZE) };
}

export function screenToWorld(camera: Camera, screen: Point): Point {
  return { x: screen.x / camera.zoom + camera.x, y: screen.y / camera.zoom + camera.y };
}

export function worldToScreen(camera: Camera, world: Point): Point {
  return { x: (world.x - camera.x) * camera.zoom, y: (world.y - camera.y) * camera.zoom };
}

/** Moves the view by a drag measured in screen pixels. */
export function pan(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x - dx / camera.zoom, y: camera.y - dy / camera.zoom };
}

/** Zooms by a factor while keeping the world point under `anchor` fixed on screen. */
export function zoomAt(camera: Camera, anchor: Point, factor: number): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  const world = screenToWorld(camera, anchor);
  return { zoom, x: world.x - anchor.x / zoom, y: world.y - anchor.y / zoom };
}

/** A camera that shows the whole galaxy centred in the viewport. */
export function fitCamera(
  galaxy: { width: number; height: number },
  viewport: { width: number; height: number },
  padding = 24,
): Camera {
  const worldWidth = galaxy.width * SECTOR_SIZE;
  const worldHeight = galaxy.height * SECTOR_SIZE;
  const zoom = clampZoom(
    Math.min(
      Math.max(1, viewport.width - padding * 2) / worldWidth,
      Math.max(1, viewport.height - padding * 2) / worldHeight,
    ),
  );
  return {
    zoom,
    x: (worldWidth - viewport.width / zoom) / 2,
    y: (worldHeight - viewport.height / zoom) / 2,
  };
}

/** A camera at the given zoom with `world` in the middle of the viewport. */
export function centerOn(world: Point, viewport: { width: number; height: number }, zoom: number): Camera {
  const z = clampZoom(zoom);
  return { zoom: z, x: world.x - viewport.width / z / 2, y: world.y - viewport.height / z / 2 };
}

/** The item nearest to `world` within `radius` world units, or null. */
export function pickNearest<T extends Point>(items: readonly T[], world: Point, radius: number): T | null {
  let best: T | null = null;
  let bestDistance = radius * radius;
  for (const item of items) {
    const d = (item.x - world.x) ** 2 + (item.y - world.y) ** 2;
    if (d <= bestDistance) {
      best = item;
      bestDistance = d;
    }
  }
  return best;
}
