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
  worldToSector,
  zoomAt,
  type Camera,
} from '../src/ui/map/camera';
import { NEUTRAL_COLOR, buildScene } from '../src/ui/map/scene';
import { getEmpireView } from '../src/sim';
import { ALPHA, BETA, addFleet, homeOf, newGame } from './fixture';

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
  it('finds the sector under a world point', () => {
    expect(worldToSector({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(worldToSector({ x: 63.9, y: 64 })).toEqual({ x: 0, y: 1 });
    expect(worldToSector({ x: -1, y: 200 })).toEqual({ x: -1, y: 3 });
    expect(worldToSector(sectorCenter({ x: 5, y: 2 }))).toEqual({ x: 5, y: 2 });
  });

  it('shows only what the player knows', () => {
    const { state, content } = newGame(2);
    const view = getEmpireView(state, ALPHA, content);
    const scene = buildScene(state, content, view);
    expect(scene.width).toBe(8);
    expect(scene.height).toBe(6);
    expect(scene.systems).toHaveLength(12);
    expect(scene.visible).toBe(view.visible);
    expect(scene.range).toBeNull();
    expect(scene.route).toBeNull();

    const home = homeOf(state, ALPHA);
    const alphaHome = scene.systems.find((s) => s.id === home.id)!;
    expect(alphaHome).toMatchObject({ color: 0x4da3ff, owned: true, isHome: true, known: true, name: home.name });
    expect({ x: alphaHome.x, y: alphaHome.y }).toEqual(sectorCenter(home.sector));

    // The rival's home has not been scanned: a dim anonymous star.
    const betaHome = scene.systems.find((s) => s.id === homeOf(state, BETA).id)!;
    expect(betaHome).toMatchObject({ color: NEUTRAL_COLOR, owned: false, isHome: false, known: false, name: '' });
  });

  it('colours a rival system from the last time it was seen', () => {
    const { state, content } = newGame(2);
    state.empires[ALPHA].knownSystems[homeOf(state, BETA).id] = BETA;
    const scene = buildScene(state, content, getEmpireView(state, ALPHA, content));
    const betaHome = scene.systems.find((s) => s.id === homeOf(state, BETA).id)!;
    expect(betaHome).toMatchObject({ color: 0xe5533d, owned: true, isHome: true, known: true });
  });

  it('draws one fleet marker per owner per sector and marks the selection', () => {
    const { state, content } = newGame(2);
    const home = homeOf(state, ALPHA).sector;
    const mine = addFleet(state, content, ALPHA, home, ['frigate']);
    addFleet(state, content, ALPHA, home, ['scout', 'scout']);
    addFleet(state, content, BETA, home, ['frigate']);
    addFleet(state, content, BETA, homeOf(state, BETA).sector, ['frigate']); // out of sight

    const scene = buildScene(state, content, getEmpireView(state, ALPHA, content), mine);
    expect(scene.fleets).toHaveLength(2);
    expect(scene.fleets.find((f) => f.own)).toMatchObject({ sector: home, ships: 3, color: 0x4da3ff, selected: true, slot: 0 });
    expect(scene.fleets.find((f) => !f.own)).toMatchObject({ sector: home, ships: 1, color: 0xe5533d, selected: false, slot: 1 });
  });

  it('gives the supply range and route of the selected fleet', () => {
    const { state, content } = newGame(2);
    const home = homeOf(state, ALPHA).sector;
    const fleet = addFleet(state, content, ALPHA, home, ['frigate']);
    const dest = { x: home.x + (home.x < 6 ? 2 : -2), y: home.y };
    fleet.destination = dest;

    const scene = buildScene(state, content, getEmpireView(state, ALPHA, content), fleet);
    expect(scene.range!.has(`${home.x},${home.y}`)).toBe(true);
    expect(scene.range!.has(`${dest.x},${dest.y}`)).toBe(true);
    expect(scene.route).toHaveLength(3);
    expect(scene.route![0]).toEqual(sectorCenter(home));
    expect(scene.route![2]).toEqual(sectorCenter(dest));

    // A rival's fleet shows no range or route.
    const theirs = addFleet(state, content, BETA, home, ['frigate']);
    expect(buildScene(state, content, getEmpireView(state, ALPHA, content), theirs).range).toBeNull();
  });

  it('can pick the sector of a system from a click at its position', () => {
    const { state, content } = newGame(2);
    const scene = buildScene(state, content, getEmpireView(state, ALPHA, content));
    const fitted = fitCamera(scene, { width: 800, height: 600 });
    const target = scene.systems[5];
    const click = worldToScreen(fitted, target);
    expect(worldToSector(screenToWorld(fitted, click))).toEqual(target.sector);
    expect(pickNearest(scene.systems, screenToWorld(fitted, click), SECTOR_SIZE * 0.45)?.id).toBe(target.id);
  });
});
