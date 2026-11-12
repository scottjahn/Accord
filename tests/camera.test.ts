import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  SECTOR_SIZE,
  centerOn,
  fitCamera,
  pan,
  pickNearest,
  screenToWorld,
  sectorCenter,
  worldToScreen,
  zoomAt,
  type Camera,
} from '../src/ui/map/camera';
import { NEUTRAL_COLOR, buildScene } from '../src/ui/map/scene';
import { ALPHA, BETA, homeOf, newGame } from './fixture';

const camera: Camera = { x: 100, y: 40, zoom: 1.5 };

describe('camera', () => {
  it('converts between screen and world and back', () => {
    const world = screenToWorld(camera, { x: 300, y: 150 });
    expect(world).toEqual({ x: 300, y: 140 });
    expect(worldToScreen(camera, world)).toEqual({ x: 300, y: 150 });
  });

  it('pans by the drag distance in screen pixels', () => {
    const moved = pan(camera, 30, -15);
    // The world point that was under the cursor follows it.
    const before = screenToWorld(camera, { x: 200, y: 200 });
    expect(worldToScreen(moved, before)).toEqual({ x: 230, y: 185 });
    expect(moved.zoom).toBe(1.5);
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const anchor = { x: 420, y: 260 };
    const world = screenToWorld(camera, anchor);
    for (const factor of [1.15, 1 / 1.15, 1.6]) {
      const zoomed = zoomAt(camera, anchor, factor);
      const screen = worldToScreen(zoomed, world);
      expect(screen.x).toBeCloseTo(anchor.x, 6);
      expect(screen.y).toBeCloseTo(anchor.y, 6);
      expect(zoomed.zoom).toBeCloseTo(1.5 * factor, 6);
    }
  });

  it('clamps zoom at both ends', () => {
    expect(zoomAt(camera, { x: 0, y: 0 }, 100).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(camera, { x: 0, y: 0 }, 0.001).zoom).toBe(MIN_ZOOM);
  });

  it('fits the whole galaxy, centred, inside the viewport', () => {
    const galaxy = { width: 16, height: 12 };
    const viewport = { width: 900, height: 500 };
    const fitted = fitCamera(galaxy, viewport);
    const topLeft = worldToScreen(fitted, { x: 0, y: 0 });
    const bottomRight = worldToScreen(fitted, { x: 16 * SECTOR_SIZE, y: 12 * SECTOR_SIZE });
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(900);
    expect(bottomRight.y).toBeLessThanOrEqual(500);
    expect(topLeft.x).toBeCloseTo(900 - bottomRight.x, 6);
    expect(topLeft.y).toBeCloseTo(500 - bottomRight.y, 6);
  });

  it('centres on a world point', () => {
    const viewport = { width: 800, height: 600 };
    const centred = centerOn({ x: 500, y: 300 }, viewport, 2);
    expect(worldToScreen(centred, { x: 500, y: 300 })).toEqual({ x: 400, y: 300 });
  });

  it('puts a sector centre in the middle of its cell', () => {
    expect(sectorCenter({ x: 0, y: 0 })).toEqual({ x: 32, y: 32 });
    expect(sectorCenter({ x: 3, y: 1 })).toEqual({ x: 224, y: 96 });
  });

  it('picks the nearest item within the radius', () => {
    const items = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 50, y: 0 },
    ];
    expect(pickNearest(items, { x: 30, y: 0 }, 25)?.id).toBe('b');
    expect(pickNearest(items, { x: 10, y: 5 }, 25)?.id).toBe('a');
    expect(pickNearest(items, { x: 25, y: 40 }, 25)).toBeNull();
    expect(pickNearest([], { x: 0, y: 0 }, 25)).toBeNull();
  });
});

describe('map scene', () => {
  it('describes every system with position, owner colour and home flag', () => {
    const { state, content } = newGame(2);
    const scene = buildScene(state, content);
    expect(scene.width).toBe(8);
    expect(scene.height).toBe(6);
    expect(scene.systems).toHaveLength(12);

    const alphaHome = scene.systems.find((s) => s.id === homeOf(state, ALPHA).id)!;
    expect(alphaHome).toMatchObject({ color: 0x4da3ff, owned: true, isHome: true });
    expect({ x: alphaHome.x, y: alphaHome.y }).toEqual(sectorCenter(homeOf(state, ALPHA).sector));

    const betaHome = scene.systems.find((s) => s.id === homeOf(state, BETA).id)!;
    expect(betaHome.color).toBe(0xe5533d);

    const neutral = scene.systems.filter((s) => !s.owned);
    expect(neutral).toHaveLength(10);
    for (const s of neutral) {
      expect(s.color).toBe(NEUTRAL_COLOR);
      expect(s.isHome).toBe(false);
    }
  });

  it('can pick a system from a click at its position', () => {
    const { state, content } = newGame(2);
    const scene = buildScene(state, content);
    const fitted = fitCamera(scene, { width: 800, height: 600 });
    const target = scene.systems[5];
    const click = worldToScreen(fitted, target);
    expect(pickNearest(scene.systems, screenToWorld(fitted, click), SECTOR_SIZE * 0.45)?.id).toBe(target.id);
  });
});
