import { Application, Container, Graphics, Text } from 'pixi.js';
import { SECTOR_SIZE, type Camera } from './camera';
import type { MapScene } from './scene';

const GRID_COLOR = 0x8fa3c8;
const LABEL_MIN_ZOOM = 0.5;

/** Draws the galaxy with PixiJS. Knows nothing about game rules; it renders a MapScene. */
export class MapRenderer {
  private readonly app = new Application();
  private readonly world = new Container();
  private readonly grid = new Graphics();
  private readonly territory = new Graphics();
  private readonly stars = new Graphics();
  private readonly selection = new Graphics();
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
    this.world.addChild(this.grid, this.territory, this.selection, this.stars, this.labels);
    this.app.stage.addChild(this.world);
    this.ready = true;
  }

  get viewport(): { width: number; height: number } {
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  setScene(scene: MapScene, selected: string | null): void {
    if (!this.ready) return;
    const width = scene.width * SECTOR_SIZE;
    const height = scene.height * SECTOR_SIZE;

    this.grid.clear();
    for (let x = 0; x <= scene.width; x++) this.grid.moveTo(x * SECTOR_SIZE, 0).lineTo(x * SECTOR_SIZE, height);
    for (let y = 0; y <= scene.height; y++) this.grid.moveTo(0, y * SECTOR_SIZE).lineTo(width, y * SECTOR_SIZE);
    this.grid.stroke({ width: 1, color: GRID_COLOR, alpha: 0.14 });

    this.territory.clear();
    this.stars.clear();
    this.selection.clear();
    const seen = new Set<string>();

    for (const system of scene.systems) {
      if (system.owned) {
        this.territory
          .rect(system.sector.x * SECTOR_SIZE + 1, system.sector.y * SECTOR_SIZE + 1, SECTOR_SIZE - 2, SECTOR_SIZE - 2)
          .fill({ color: system.color, alpha: 0.16 })
          .stroke({ width: 1, color: system.color, alpha: 0.5 });
        this.stars.circle(system.x, system.y, system.radius + 5).fill({ color: system.color, alpha: 0.25 });
      }
      this.stars.circle(system.x, system.y, system.radius).fill({ color: system.color });
      if (system.isHome) {
        this.stars.circle(system.x, system.y, system.radius + 8).stroke({ width: 1.5, color: system.color, alpha: 0.9 });
      }
      if (system.id === selected) {
        this.selection
          .rect(system.sector.x * SECTOR_SIZE + 2, system.sector.y * SECTOR_SIZE + 2, SECTOR_SIZE - 4, SECTOR_SIZE - 4)
          .stroke({ width: 2, color: 0xffffff, alpha: 0.95 });
      }

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
      label.alpha = system.owned || system.id === selected ? 1 : 0.6;
      label.position.set(system.x, system.y + system.radius + 6);
    }

    for (const [id, label] of this.labelById) {
      if (seen.has(id)) continue;
      label.destroy();
      this.labelById.delete(id);
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
