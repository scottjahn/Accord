import { Application, Container, Graphics, Text } from 'pixi.js';
import { SECTOR_SIZE, type Camera } from './camera';
import type { MapScene } from './scene';

const GRID_COLOR = 0x8fa3c8;
const RANGE_COLOR = 0x6cb6ff;
const LABEL_MIN_ZOOM = 0.5;

/** Draws the galaxy with PixiJS. Knows nothing about game rules; it renders a MapScene. */
export class MapRenderer {
  private readonly app = new Application();
  private readonly world = new Container();
  private readonly grid = new Graphics();
  private readonly range = new Graphics();
  private readonly territory = new Graphics();
  private readonly fog = new Graphics();
  private readonly selection = new Graphics();
  private readonly stars = new Graphics();
  private readonly fleets = new Graphics();
  private readonly labels = new Container();
  private readonly labelById = new Map<string, Text>();
  private zoom = 1;
  private ready = false;

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      antialias: true,
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    host.appendChild(this.app.canvas);
    this.world.addChild(this.grid, this.territory, this.fog, this.range, this.selection, this.stars, this.fleets, this.labels);
    this.app.stage.addChild(this.world);
    this.ready = true;
  }

  get viewport(): { width: number; height: number } {
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  setScene(scene: MapScene, selectedSystem: string | null): void {
    if (!this.ready) return;
    const S = SECTOR_SIZE;
    const width = scene.width * S;
    const height = scene.height * S;

    this.grid.clear();
    for (let x = 0; x <= scene.width; x++) this.grid.moveTo(x * S, 0).lineTo(x * S, height);
    for (let y = 0; y <= scene.height; y++) this.grid.moveTo(0, y * S).lineTo(width, y * S);
    this.grid.stroke({ width: 1, color: GRID_COLOR, alpha: 0.14 });

    // Fog over everything the player cannot see right now; supply range for the selected fleet.
    this.fog.clear();
    this.range.clear();
    for (let y = 0; y < scene.height; y++) {
      for (let x = 0; x < scene.width; x++) {
        const key = `${x},${y}`;
        if (!scene.visible.has(key)) this.fog.rect(x * S, y * S, S, S).fill({ color: 0x000000, alpha: 0.42 });
        if (scene.range?.has(key)) this.range.rect(x * S + 1, y * S + 1, S - 2, S - 2).fill({ color: RANGE_COLOR, alpha: 0.1 });
      }
    }
    if (scene.route && scene.route.length > 1) {
      this.range.moveTo(scene.route[0].x, scene.route[0].y);
      for (const point of scene.route.slice(1)) this.range.lineTo(point.x, point.y);
      this.range.stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
      const end = scene.route[scene.route.length - 1];
      this.range.circle(end.x, end.y, 6).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
    }

    this.territory.clear();
    this.stars.clear();
    this.selection.clear();
    const seen = new Set<string>();

    for (const system of scene.systems) {
      if (system.owned) {
        this.territory
          .rect(system.sector.x * S + 1, system.sector.y * S + 1, S - 2, S - 2)
          .fill({ color: system.color, alpha: 0.16 })
          .stroke({ width: 1, color: system.color, alpha: 0.5 });
        this.stars.circle(system.x, system.y, system.radius + 5).fill({ color: system.color, alpha: 0.25 });
      }
      this.stars.circle(system.x, system.y, system.radius).fill({ color: system.color, alpha: system.known ? 1 : 0.45 });
      if (system.minor) {
        // A gold diamond marks an independent people.
        const r = system.radius + 7;
        this.stars
          .poly([system.x, system.y - r, system.x + r, system.y, system.x, system.y + r, system.x - r, system.y])
          .stroke({ width: 1.5, color: 0xe8c15a, alpha: 0.95 });
      }
      if (system.isHome) {
        this.stars.circle(system.x, system.y, system.radius + 8).stroke({ width: 1.5, color: system.color, alpha: 0.9 });
      }
      if (system.id === selectedSystem) {
        this.selection
          .rect(system.sector.x * S + 2, system.sector.y * S + 2, S - 4, S - 4)
          .stroke({ width: 2, color: 0xffffff, alpha: 0.95 });
      }

      if (!system.known) continue;
      seen.add(system.id);
      let label = this.labelById.get(system.id);
      if (!label) {
        label = new Text({
          text: system.name,
          style: { fontFamily: 'system-ui, sans-serif', fontSize: 12, fill: 0xffffff },
          resolution: 2,
        });
        label.anchor.set(0.5, 0);
        this.labelById.set(system.id, label);
        this.labels.addChild(label);
      }
      label.text = system.name;
      label.alpha = system.owned || system.id === selectedSystem ? 1 : 0.6;
      label.position.set(system.x, system.y + system.radius + 6);
    }

    for (const [id, label] of this.labelById) {
      if (seen.has(id)) continue;
      label.destroy();
      this.labelById.delete(id);
    }

    // Fleets: a chevron in the sector's top-right corner, one per owner, with a pip per ship.
    this.fleets.clear();
    for (const fleet of scene.fleets) {
      const cx = (fleet.sector.x + 1) * S - 14 - fleet.slot * 18;
      const cy = fleet.sector.y * S + 14;
      if (fleet.selected) this.fleets.circle(cx, cy, 11).stroke({ width: 2, color: 0xffffff, alpha: 0.95 });
      this.fleets
        .poly([cx, cy - 7, cx + 6, cy + 6, cx, cy + 2, cx - 6, cy + 6])
        .fill({ color: fleet.color })
        .stroke(fleet.hostile ? { width: 2, color: 0xff3b30, alpha: 1 } : { width: 1, color: 0x000000, alpha: 0.6 });
      for (let i = 0; i < Math.min(fleet.ships, 5); i++) {
        this.fleets.circle(cx - 6 + i * 3, cy + 10, 1).fill({ color: 0xffffff, alpha: 0.9 });
      }
    }

    this.scaleLabels();
  }

  setCamera(camera: Camera): void {
    if (!this.ready) return;
    this.zoom = camera.zoom;
    this.world.scale.set(camera.zoom);
    this.world.position.set(-camera.x * camera.zoom, -camera.y * camera.zoom);
    this.scaleLabels();
  }

  /** Labels stay the same size on screen at any zoom and hide when zoomed far out. */
  private scaleLabels(): void {
    this.labels.visible = this.zoom >= LABEL_MIN_ZOOM;
    for (const label of this.labelById.values()) label.scale.set(1 / this.zoom);
  }

  destroy(): void {
    if (!this.ready) return;
    this.ready = false;
    this.labelById.clear();
    this.app.destroy(true, { children: true });
  }
}
