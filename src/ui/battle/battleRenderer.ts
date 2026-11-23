/**
 * Draws a commanded battle, top down, on a 2D canvas. Drawing only: it reads
 * the battle and never changes it. The space backdrop, hull silhouettes and
 * effects follow the look of World of War's space edition.
 */
import type { EmpireId, TacticalBattle, TacticalUnit } from '../../sim';

/** How arena units map to canvas pixels. */
export interface BattleView {
  scale: number;
  ox: number;
  oy: number;
}

/** Short-lived things that are only drawn: shots and explosions. */
export interface Effect {
  kind: 'beam' | 'boom' | 'spark';
  x: number;
  y: number;
  tx: number;
  ty: number;
  color: string;
  size: number;
  /** Seconds since it started, and how long it lasts. */
  age: number;
  life: number;
}

const TAU = Math.PI * 2;

/** Fits the whole arena in the canvas, centred, with a margin. */
export function fitView(battle: TacticalBattle, width: number, height: number): BattleView {
  const margin = 24;
  const scale = Math.min((width - margin * 2) / battle.width, (height - margin * 2) / battle.height);
  return { scale, ox: (width - battle.width * scale) / 2, oy: (height - battle.height * scale) / 2 };
}

export const toWorld = (view: BattleView, sx: number, sy: number) => ({ x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale });

/** The active unit under a point in arena units, if any. */
export function unitAt(battle: TacticalBattle, x: number, y: number, slack: number): TacticalUnit | null {
  let best: TacticalUnit | null = null;
  let bestD = Infinity;
  for (const u of battle.units) {
    if (u.status !== 'active') continue;
    const d = Math.hypot(u.x - x, u.y - y);
    if (d <= u.radius + slack && d < bestD) {
      best = u;
      bestD = d;
    }
  }
  return best;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Lightens (amount > 0) or darkens (< 0) a colour. */
function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** A small seeded generator for the backdrop, so it looks the same every time. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Paints the starfield, distant gas and (for a colony battle) the planet onto an offscreen canvas. */
export function bakeBackdrop(battle: TacticalBattle, view: BattleView, width: number, height: number, ratio: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const g = canvas.getContext('2d');
  if (!g) return canvas;
  g.scale(ratio, ratio);
  let seed = 7;
  for (let i = 0; i < battle.key.length; i++) seed = Math.imul(seed ^ battle.key.charCodeAt(i), 16777619);
  const rand = lcg(seed);

  g.fillStyle = '#05070e';
  g.fillRect(0, 0, width, height);
  const tints = ['#1c2a58', '#3a1c58', '#123a48'];
  const tint = tints[Math.floor(rand() * tints.length)];
  for (let i = 0; i < 9; i++) {
    const cx = rand() * width;
    const cy = rand() * height;
    const r = (0.16 + rand() * 0.36) * width * 0.5;
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grd.addColorStop(0, rgba(tint, 0.2 * 0.35));
    grd.addColorStop(0.5, rgba(tint, 0.09 * 0.35));
    grd.addColorStop(1, rgba(tint, 0));
    g.fillStyle = grd;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  const stars = Math.round((width * height) / 1800);
  for (let i = 0; i < stars; i++) {
    const x = rand() * width;
    const y = rand() * height;
    const m = rand();
    const bright = m > 0.986;
    const r = bright ? 1.4 + rand() * 1.1 : m > 0.86 ? 0.8 + rand() * 0.5 : 0.35 + rand() * 0.4;
    const a = bright ? 0.95 : m > 0.86 ? 0.55 + rand() * 0.35 : 0.14 + rand() * 0.3;
    const hue = rand();
    g.fillStyle = hue > 0.8 ? `rgba(255,214,170,${a})` : hue > 0.55 ? `rgba(180,205,255,${a})` : `rgba(255,255,255,${a})`;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    if (bright) {
      g.strokeStyle = `rgba(255,255,255,${a * 0.35})`;
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(x - r * 4, y);
      g.lineTo(x + r * 4, y);
      g.moveTo(x, y - r * 4);
      g.lineTo(x, y + r * 4);
      g.stroke();
    }
  }

  // The arena's edge, faintly: ships leave the battle across it.
  g.strokeStyle = 'rgba(140,170,230,0.14)';
  g.setLineDash([6, 8]);
  g.strokeRect(view.ox, view.oy, battle.width * view.scale, battle.height * view.scale);
  g.setLineDash([]);

  if (battle.planet) {
    const p = battle.planet;
    const x = view.ox + p.x * view.scale;
    const y = view.oy + p.y * view.scale;
    const r = p.radius * view.scale;
    const halo = g.createRadialGradient(x, y, r * 0.9, x, y, r * 1.6);
    halo.addColorStop(0, 'rgba(120,170,255,0.25)');
    halo.addColorStop(1, 'rgba(120,170,255,0)');
    g.fillStyle = halo;
    g.beginPath();
    g.arc(x, y, r * 1.6, 0, TAU);
    g.fill();
    const body = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    body.addColorStop(0, '#7fb0d8');
    body.addColorStop(0.55, '#3d6f96');
    body.addColorStop(1, '#122438');
    g.fillStyle = body;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    g.save();
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = r * 0.12;
    for (let i = -2; i <= 2; i++) {
      g.beginPath();
      g.ellipse(x, y + i * r * 0.32, r * 1.1, r * 0.08, 0.15, 0, TAU);
      g.stroke();
    }
    const night = g.createLinearGradient(x - r, y - r, x + r, y + r);
    night.addColorStop(0.45, 'rgba(0,0,0,0)');
    night.addColorStop(1, 'rgba(0,0,0,0.65)');
    g.fillStyle = night;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.restore();
  }
  return canvas;
}

const EXHAUST = '#9fd4ff';
const NACELLE = '#2a3242';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** First-generation warship: a command block on a spine, with an engine block behind. */
function drawFrigate(ctx: CanvasRenderingContext2D, r: number, body: string, dark: string, light: string): void {
  ctx.fillStyle = dark;
  roundRect(ctx, r * 0.55, -r * 0.7, r * 0.95, r * 1.4, r * 0.18);
  ctx.fill();
  ctx.fillStyle = body;
  roundRect(ctx, r * 0.66, -r * 0.55, r * 0.72, r * 1.1, r * 0.14);
  ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(r * 1.26, 0, r * 0.16, 0, TAU);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.fillRect(-r * 0.55, -r * 0.18, r * 1.15, r * 0.36);
  ctx.fillStyle = body;
  ctx.fillRect(-r * 0.5, -r * 0.1, r * 1.05, r * 0.2);
  ctx.fillStyle = dark;
  roundRect(ctx, -r * 1.3, -r * 0.85, r * 0.8, r * 1.7, r * 0.14);
  ctx.fill();
  ctx.fillStyle = body;
  roundRect(ctx, -r * 1.2, -r * 0.7, r * 0.6, r * 1.4, r * 0.1);
  ctx.fill();
  ctx.fillStyle = EXHAUST;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(-r * 1.34, i * r * 0.36, r * 0.11, 0, TAU);
    ctx.fill();
  }
}

/** Second generation: a long hull with a broad bridge and an engine bank. */
function drawDestroyer(ctx: CanvasRenderingContext2D, r: number, body: string, dark: string, light: string): void {
  ctx.fillStyle = dark;
  roundRect(ctx, r * 0.95, -r * 0.62, r * 0.62, r * 1.24, r * 0.16);
  ctx.fill();
  ctx.fillStyle = body;
  roundRect(ctx, r * 1.05, -r * 0.48, r * 0.42, r * 0.96, r * 0.12);
  ctx.fill();
  ctx.fillStyle = light;
  ctx.fillRect(r * 1.36, -r * 0.2, r * 0.12, r * 0.4);
  ctx.fillStyle = dark;
  ctx.fillRect(r * 0.45, -r * 0.2, r * 0.6, r * 0.4);
  ctx.beginPath();
  ctx.moveTo(r * 0.75, -r * 0.34);
  ctx.lineTo(-r * 1.2, -r * 0.5);
  ctx.lineTo(-r * 1.2, r * 0.5);
  ctx.lineTo(r * 0.75, r * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(r * 0.6, -r * 0.24);
  ctx.lineTo(-r * 1.05, -r * 0.36);
  ctx.lineTo(-r * 1.05, r * 0.36);
  ctx.lineTo(r * 0.6, r * 0.24);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = NACELLE;
  ctx.fillRect(-r * 1.35, -r * 0.5, r * 0.2, r * 1.0);
  ctx.fillStyle = EXHAUST;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.arc(-r * 1.32, i * r * 0.2, r * 0.078, 0, TAU);
    ctx.fill();
  }
}

/** Third generation and up: a dagger-shaped capital ship. */
function drawCapital(ctx: CanvasRenderingContext2D, r: number, body: string, dark: string, light: string): void {
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(r * 1.75, 0);
  ctx.lineTo(-r * 1.15, -r * 0.95);
  ctx.lineTo(-r * 1.3, -r * 0.8);
  ctx.lineTo(-r * 1.3, r * 0.8);
  ctx.lineTo(-r * 1.15, r * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(r * 1.5, 0);
  ctx.lineTo(-r * 1.02, -r * 0.76);
  ctx.lineTo(-r * 1.15, -r * 0.64);
  ctx.lineTo(-r * 1.15, r * 0.64);
  ctx.lineTo(-r * 1.02, r * 0.76);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(0.8, r * 0.035);
  for (let s = -1; s <= 1; s += 2) {
    ctx.beginPath();
    ctx.moveTo(r * 1.45, 0);
    ctx.lineTo(-r * 1.05, s * r * 0.5);
    ctx.stroke();
  }
  ctx.fillStyle = dark;
  roundRect(ctx, -r * 0.98, -r * 0.42, r * 0.88, r * 0.84, r * 0.06);
  ctx.fill();
  ctx.fillStyle = light;
  roundRect(ctx, -r * 0.74, -r * 0.2, r * 0.36, r * 0.4, r * 0.05);
  ctx.fill();
  ctx.fillStyle = NACELLE;
  ctx.fillRect(-r * 1.38, -r * 0.68, r * 0.18, r * 1.36);
  ctx.fillStyle = EXHAUST;
  for (const [y, s] of [
    [0, 0.15],
    [0.32, 0.15],
    [-0.32, 0.15],
    [0.58, 0.1],
    [-0.58, 0.1],
  ]) {
    ctx.beginPath();
    ctx.arc(-r * 1.33, y * r, s * r, 0, TAU);
    ctx.fill();
  }
}

/** A light dart with swept wings. */
function drawScout(ctx: CanvasRenderingContext2D, r: number, body: string, dark: string, light: string): void {
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(r * 1.5, 0);
  ctx.lineTo(-r * 0.9, -r * 1.0);
  ctx.lineTo(-r * 0.5, 0);
  ctx.lineTo(-r * 0.9, r * 1.0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(r * 1.3, 0);
  ctx.lineTo(-r * 0.7, -r * 0.7);
  ctx.lineTo(-r * 0.35, 0);
  ctx.lineTo(-r * 0.7, r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.ellipse(r * 0.45, 0, r * 0.3, r * 0.14, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = EXHAUST;
  ctx.beginPath();
  ctx.arc(-r * 0.45, 0, r * 0.14, 0, TAU);
  ctx.fill();
}

/** A rounded freighter: a colony ship or an ark. */
function drawColony(ctx: CanvasRenderingContext2D, r: number, body: string, dark: string, light: string): void {
  ctx.fillStyle = dark;
  roundRect(ctx, -r * 1.2, -r * 0.7, r * 2.3, r * 1.4, r * 0.55);
  ctx.fill();
  ctx.fillStyle = body;
  roundRect(ctx, -r * 1.05, -r * 0.55, r * 2.0, r * 1.1, r * 0.45);
  ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(r * 0.2, 0, r * 0.36, 0, TAU);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(r * 0.2, 0, r * 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = EXHAUST;
  for (let i = -1; i <= 1; i += 2) {
    ctx.beginPath();
    ctx.arc(-r * 1.2, i * r * 0.3, r * 0.12, 0, TAU);
    ctx.fill();
  }
}

/** A boxy troop carrier with cargo pods along its spine. */
function drawTransport(ctx: CanvasRenderingContext2D, r: number, body: string, dark: string, light: string): void {
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(r * 1.3, 0);
  ctx.lineTo(r * 0.8, -r * 0.6);
  ctx.lineTo(-r * 1.2, -r * 0.6);
  ctx.lineTo(-r * 1.2, r * 0.6);
  ctx.lineTo(r * 0.8, r * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = body;
  for (let i = 0; i < 3; i++) {
    roundRect(ctx, -r * 1.05 + i * r * 0.62, -r * 0.48, r * 0.5, r * 0.96, r * 0.1);
    ctx.fill();
  }
  ctx.fillStyle = light;
  ctx.fillRect(r * 0.85, -r * 0.18, r * 0.25, r * 0.36);
  ctx.fillStyle = EXHAUST;
  ctx.fillRect(-r * 1.32, -r * 0.4, r * 0.12, r * 0.8);
}

/** An orbital battery: a hexagonal platform with three gun arms. */
function drawBattery(ctx: CanvasRenderingContext2D, r: number, body: string, dark: string, light: string): void {
  ctx.fillStyle = dark;
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i / 3) * TAU);
    roundRect(ctx, r * 0.3, -r * 0.2, r * 1.1, r * 0.4, r * 0.1);
    ctx.fill();
    ctx.restore();
  }
  const hex = (size: number) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      if (i === 0) ctx.moveTo(Math.cos(a) * size, Math.sin(a) * size);
      else ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size);
    }
    ctx.closePath();
  };
  hex(r * 0.82);
  ctx.fillStyle = dark;
  ctx.fill();
  hex(r * 0.62);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.24, 0, TAU);
  ctx.fill();
}

/** One unit's silhouette, nose along +x at the origin. */
export function drawHull(ctx: CanvasRenderingContext2D, role: string, tier: number, r: number, color: string): void {
  const body = color;
  const dark = shade(color, -0.55);
  const light = shade(color, 0.45);
  if (role === 'battery') drawBattery(ctx, r, body, dark, light);
  else if (role === 'scout') drawScout(ctx, r, body, dark, light);
  else if (role === 'colony') drawColony(ctx, r, body, dark, light);
  else if (role === 'transport') drawTransport(ctx, r, body, dark, light);
  else if (tier >= 3) drawCapital(ctx, r, body, dark, light);
  else if (tier === 2) drawDestroyer(ctx, r, body, dark, light);
  else drawFrigate(ctx, r, body, dark, light);
}

export interface DrawOptions {
  colors: Record<EmpireId, string>;
  player: EmpireId | null;
  selected: Set<string>;
  effects: Effect[];
  /** A drag-select box in canvas pixels, if one is being drawn. */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  /** The unit under the pointer, for a hover ring. */
  hover: string | null;
}

/** Draws one frame. */
export function drawBattle(
  ctx: CanvasRenderingContext2D,
  battle: TacticalBattle,
  view: BattleView,
  backdrop: HTMLCanvasElement | null,
  width: number,
  height: number,
  opts: DrawOptions,
): void {
  ctx.clearRect(0, 0, width, height);
  if (backdrop) ctx.drawImage(backdrop, 0, 0, width, height);
  const sx = (x: number) => view.ox + x * view.scale;
  const sy = (y: number) => view.oy + y * view.scale;
  const byId = new Map(battle.units.map((u) => [u.id, u]));

  // Orders of the selected ships: where they are going and what they are after.
  ctx.save();
  ctx.lineWidth = 1;
  for (const id of opts.selected) {
    const u = byId.get(id);
    if (!u || u.status !== 'active') continue;
    if (u.order.kind === 'move') {
      ctx.strokeStyle = 'rgba(140,220,140,0.55)';
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(sx(u.x), sy(u.y));
      ctx.lineTo(sx(u.order.x), sy(u.order.y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(sx(u.order.x), sy(u.order.y), 4, 0, TAU);
      ctx.stroke();
    } else if (u.order.kind === 'attack') {
      const t = byId.get(u.order.target);
      if (t && t.status === 'active') {
        ctx.strokeStyle = 'rgba(255,110,90,0.6)';
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(sx(u.x), sy(u.y));
        ctx.lineTo(sx(t.x), sy(t.y));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (u.order.kind === 'withdraw') {
      ctx.strokeStyle = 'rgba(255,210,110,0.45)';
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(sx(u.x), sy(u.y));
      ctx.lineTo(sx(u.x + u.hx * 80), sy(u.y + u.hy * 80));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.restore();

  // Weapon ranges of selected units, faintly.
  for (const id of opts.selected) {
    const u = byId.get(id);
    if (!u || u.status !== 'active' || u.range === 0) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.arc(sx(u.x), sy(u.y), u.range * view.scale, 0, TAU);
    ctx.stroke();
  }

  // Ships and batteries.
  for (const u of battle.units) {
    if (u.status !== 'active') continue;
    const x = sx(u.x);
    const y = sy(u.y);
    const r = Math.max(6, u.radius * view.scale);
    const color = opts.colors[u.empire] ?? '#aaaaaa';
    // Engine glow behind moving ships.
    if (u.speed > 0) {
      const gx = x - u.hx * r * 1.6;
      const gy = y - u.hy * r * 1.6;
      const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, r * 1.1);
      glow.addColorStop(0, 'rgba(160,210,255,0.35)');
      glow.addColorStop(1, 'rgba(160,210,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(gx, gy, r * 1.1, 0, TAU);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(u.hy, u.hx));
    drawHull(ctx, u.role, u.tier, r, color);
    ctx.restore();

    const selected = opts.selected.has(u.id);
    if (selected || opts.hover === u.id) {
      ctx.strokeStyle = selected ? 'rgba(140,255,160,0.9)' : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = selected ? 1.6 : 1;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.6 + 3, 0, TAU);
      ctx.stroke();
    }
    // Hull bar for anything damaged, selected or under the pointer.
    if (u.hp < u.maxHp || selected || opts.hover === u.id) {
      const w = Math.max(18, r * 2.6);
      const frac = Math.max(0, u.hp / u.maxHp);
      const by = y + r * 1.6 + 5;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - w / 2 - 1, by - 1, w + 2, 5);
      ctx.fillStyle = frac > 0.6 ? '#5fd38a' : frac > 0.3 ? '#e3c04f' : '#e5533d';
      ctx.fillRect(x - w / 2, by, w * frac, 3);
    }
    // A small team marker so sides read at a glance even at small sizes.
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x - 2, y - r * 1.6 - 6, 4, 4);
    ctx.globalAlpha = 1;
  }

  // Effects on top.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const e of opts.effects) {
    const k = Math.min(1, e.age / e.life);
    if (e.kind === 'beam') {
      ctx.strokeStyle = rgba(e.color, (1 - k) * 0.95);
      ctx.lineWidth = Math.max(1, e.size * view.scale * (1 - k * 0.5));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx(e.x), sy(e.y));
      ctx.lineTo(sx(e.tx), sy(e.ty));
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.8})`;
      ctx.lineWidth = Math.max(0.5, e.size * view.scale * 0.35);
      ctx.stroke();
    } else if (e.kind === 'spark') {
      const r = e.size * view.scale * (0.5 + k);
      const g = ctx.createRadialGradient(sx(e.x), sy(e.y), 0, sx(e.x), sy(e.y), r);
      g.addColorStop(0, `rgba(255,240,200,${1 - k})`);
      g.addColorStop(1, 'rgba(255,140,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx(e.x), sy(e.y), r, 0, TAU);
      ctx.fill();
    } else {
      const r = e.size * view.scale * (0.35 + k * 1.3);
      const g = ctx.createRadialGradient(sx(e.x), sy(e.y), 0, sx(e.x), sy(e.y), r);
      const a = 1 - k;
      g.addColorStop(0, `rgba(255,246,200,${a * 0.95})`);
      g.addColorStop(0.35, `rgba(255,168,60,${a * 0.8})`);
      g.addColorStop(1, 'rgba(120,40,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx(e.x), sy(e.y), r, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();

  if (opts.box) {
    const { x0, y0, x1, y1 } = opts.box;
    ctx.fillStyle = 'rgba(140,255,160,0.08)';
    ctx.strokeStyle = 'rgba(140,255,160,0.7)';
    ctx.lineWidth = 1;
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  }
}

/** Effects for the shots fired in the last step: a beam for each, a spark on the hit, a fireball for a kill. */
export function effectsForShots(battle: TacticalBattle, colors: Record<EmpireId, string>): Effect[] {
  const byId = new Map(battle.units.map((u) => [u.id, u]));
  const out: Effect[] = [];
  for (const shot of battle.shots) {
    const from = byId.get(shot.from);
    const to = byId.get(shot.to);
    if (!from || !to) continue;
    const color = colors[from.empire] ?? '#ffffff';
    const reach = from.radius * 0.6;
    out.push({ kind: 'beam', x: from.x + from.hx * reach, y: from.y + from.hy * reach, tx: to.x, ty: to.y, color, size: from.role === 'battery' ? 3 : 2, age: 0, life: 0.22 });
    out.push({ kind: 'spark', x: to.x, y: to.y, tx: 0, ty: 0, color, size: 6, age: 0, life: 0.25 });
    if (shot.destroyed) out.push({ kind: 'boom', x: to.x, y: to.y, tx: 0, ty: 0, color, size: to.radius * 2.4, age: 0, life: 0.9 });
  }
  return out;
}
