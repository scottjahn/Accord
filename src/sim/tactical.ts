/**
 * Commanded battles: the real-time alternative to auto-resolving a battle.
 *
 * A `TacticalBattle` starts from a `BattleSetup` (see `battlesAhead`), runs in
 * fixed ticks and ends when no armed unit has an enemy left on the field. Its
 * result, `tacticalOutcome`, goes back into `processTurn` as a commanded
 * battle. Each hit is worked out by `shotDamage`, exactly as in an
 * auto-resolved round, then scaled by the weapon (see `TacticalWeapon`); what
 * changes is who shoots whom, and when. Ships never sit still: they circle
 * their targets and jink at seeded moments, and bolts and missiles fly, so a
 * ship that turns at the right time can make a bolt miss.
 *
 * Unlike the game state, a battle is a working object that is stepped many
 * times a second, so `stepTactical` and `orderTactical` change it in place
 * rather than copying it. It is still plain JSON, and it uses only seeded
 * rolls and exactly rounded arithmetic (+, -, *, / and sqrt), so the same
 * setup, seed and orders always play out the same way.
 */
import { atWar, shotDamage } from './combat';
import type { Content, TacticalWeapon } from './content';
import { sortedKeys, type BuildingId, type EmpireId, type HullId } from './ids';
import { nextInt, seedRng, type RngState } from './rng';
import type { BattleOutcome, BattleSetup, BattleUnitSetup, GameState, Sector } from './types';

export type TacticalOrder =
  /** Fight as the fleet's stance says: engage, raid, escort or evade. */
  | { kind: 'auto' }
  /** Fly to a point, then hold there. */
  | { kind: 'move'; x: number; y: number }
  /** Close on one enemy and fire at it until it is gone. */
  | { kind: 'attack'; target: string }
  /** Stay put and fire at whatever comes into range. */
  | { kind: 'hold' }
  /** Make for the side's own edge of the field and leave the battle. */
  | { kind: 'withdraw' };

export type TacticalEdge = 'left' | 'right' | 'top' | 'bottom';

export interface TacticalSide {
  empire: EmpireId;
  /** A player gives this side its orders; the computer leads every other side. */
  commander: 'player' | 'computer';
  /** The edge it arrives from and withdraws through. */
  edge: TacticalEdge;
}

export interface TacticalGun {
  weapon: string;
  /** Ticks until it can fire again. */
  reload: number;
}

export interface TacticalUnit extends BattleUnitSetup {
  x: number;
  y: number;
  /** Velocity, in arena units per tick. */
  vx: number;
  vy: number;
  /** The way the unit faces, as a unit vector. */
  hx: number;
  hy: number;
  /** Top speed in arena units per tick; 0 for an orbital battery. */
  speed: number;
  /** How far its longest-reaching gun shoots, and its shortest; 0 if unarmed. */
  range: number;
  closeRange: number;
  radius: number;
  guns: TacticalGun[];
  /** The point it circles while holding or idle. */
  ax: number;
  ay: number;
  /** Which way it circles (1 or -1), its current jink as percents, and ticks until it jinks again. */
  orbit: number;
  jx: number;
  jy: number;
  jinkTicks: number;
  order: TacticalOrder;
  status: 'active' | 'destroyed' | 'withdrawn';
  /** What it is closing on or shooting at, if anything. */
  target: string | null;
}

/** One hit that landed during the last step, for drawing: a beam firing, or a bolt or missile arriving. */
export interface TacticalShot {
  from: string;
  to: string;
  weapon: string;
  delivery: TacticalWeapon['delivery'];
  damage: number;
  destroyed: boolean;
  /** Where it struck. */
  x: number;
  y: number;
}

/** A bolt or missile in flight. */
export interface TacticalProjectile {
  id: number;
  weapon: string;
  delivery: 'bolt' | 'homing';
  from: string;
  empire: EmpireId;
  /** What a homing shot steers after; a bolt hits any enemy in its path. */
  target: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The firer's attack and the seeded roll, both fixed when it was fired, and how many weapons the firer shares damage between. */
  attack: number;
  roll: number;
  share: number;
  /** Ticks of flight left. */
  life: number;
}

export interface TacticalBattle {
  key: string;
  sector: Sector;
  width: number;
  height: number;
  tick: number;
  ticksPerSecond: number;
  rng: RngState;
  sides: TacticalSide[];
  /** Pairs of empires at war, as `a|b` with the lower id first. */
  wars: string[];
  units: TacticalUnit[];
  /** The planet a colony battle is fought over, if any. */
  planet: { x: number; y: number; radius: number } | null;
  /** Hits that landed during the last step. */
  shots: TacticalShot[];
  projectiles: TacticalProjectile[];
  nextProjectile: number;
  over: boolean;
  /** False if the battle stopped at its time limit with both sides still fighting. */
  finished: boolean;
}

export interface TacticalOptions {
  /** Empire ids at war with each other, as pairs. */
  wars: [EmpireId, EmpireId][];
  /** The empire a player commands, or null to let the computer lead everyone. */
  player: EmpireId | null;
  seed: number;
}

const EDGES: TacticalEdge[] = ['left', 'right', 'top', 'bottom'];
/** Ticks between a computer side's checks on whether to withdraw. */
const RETHINK_TICKS = 10;
/** Unit vectors for placing orbital batteries around the planet. */
const RING: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7071, 0.7071],
  [-0.7071, -0.7071],
  [0.7071, -0.7071],
  [-0.7071, 0.7071],
];

const pairKey = (a: EmpireId, b: EmpireId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** How big a unit is on the field: larger for later warship generations. */
export function unitRadius(role: string, tier: number): number {
  if (role === 'battery') return 16;
  if (role === 'warship') return 12 + 4 * tier;
  if (role === 'scout') return 9;
  return 14;
}

/** The options for fighting one of a game's battles, with the given player in command. */
export function tacticalOptionsFor(state: GameState, setup: BattleSetup, player: EmpireId | null): TacticalOptions {
  const empires = [...new Set(setup.units.map((u) => u.empire))].sort();
  const wars: [EmpireId, EmpireId][] = [];
  for (const a of empires) for (const b of empires) if (a < b && atWar(state, a, b)) wars.push([a, b]);
  // A seed of its own, so the battle's rolls do not depend on how long it took to decide to fight.
  let seed = state.rng[0] ^ Math.imul(state.turn + 1, 0x9e3779b1);
  for (let i = 0; i < setup.key.length; i++) seed = Math.imul(seed ^ setup.key.charCodeAt(i), 0x01000193);
  return { wars, player, seed };
}

/** Sets up a battle with every side drawn up at its own edge of the field. */
export function createTacticalBattle(setup: BattleSetup, content: Content, options: TacticalOptions): TacticalBattle {
  const rules = content.rules.combat.tactical;
  const rng = seedRng(options.seed);
  const width = rules.arenaWidth;
  const height = rules.arenaHeight;
  // The colony's owner defends, so it is drawn up first; everyone else in id order.
  const empires = [...new Set(setup.units.map((u) => u.empire))].sort();
  if (setup.colonyOwner && empires.includes(setup.colonyOwner)) {
    empires.splice(empires.indexOf(setup.colonyOwner), 1);
    empires.unshift(setup.colonyOwner);
  }
  const sides: TacticalSide[] = empires.map((empire, i) => ({
    empire,
    commander: empire === options.player ? 'player' : 'computer',
    edge: EDGES[i % EDGES.length],
  }));
  const planet = setup.system !== null ? { x: width / 2, y: height / 2, radius: 60 } : null;

  const units: TacticalUnit[] = [];
  for (const side of sides) {
    const mine = setup.units.filter((u) => u.empire === side.empire);
    const batteries = mine.filter((u) => u.role === 'battery');
    const ships = mine.filter((u) => u.role !== 'battery');
    batteries.forEach((unit, i) => {
      const [dx, dy] = RING[i % RING.length];
      const reach = (planet?.radius ?? 60) + 40 + 30 * Math.floor(i / RING.length);
      const cx = planet?.x ?? width / 2;
      const cy = planet?.y ?? height / 2;
      units.push(makeUnit(unit, side, cx + dx * reach, cy + dy * reach, 0, content, rng));
    });
    // Warships form the front ranks; unarmed ships start a rank of their own behind them.
    const perRank = 8;
    const spacing = 56;
    let rank = 0;
    for (const group of [ships.filter((u) => u.armed), ships.filter((u) => !u.armed)]) {
      group.forEach((unit, i) => {
        const r = rank + Math.floor(i / perRank);
        const file = i % perRank;
        const inRank = Math.min(perRank, group.length - Math.floor(i / perRank) * perRank);
        const across = (file - (inRank - 1) / 2) * spacing;
        const depth = Math.max(50, 220 - r * 60);
        const at = placeOnEdge(side.edge, width, height, depth, across);
        units.push(makeUnit(unit, side, at.x, at.y, speedOf(unit, content), content, rng));
      });
      rank += Math.ceil(group.length / perRank);
    }
  }

  return {
    key: setup.key,
    sector: { ...setup.sector },
    width,
    height,
    tick: 0,
    ticksPerSecond: rules.ticksPerSecond,
    rng,
    sides,
    wars: options.wars.map(([a, b]) => pairKey(a, b)).sort(),
    units,
    planet,
    shots: [],
    projectiles: [],
    nextProjectile: 1,
    over: false,
    finished: false,
  };
}

function placeOnEdge(edge: TacticalEdge, width: number, height: number, depth: number, across: number): { x: number; y: number } {
  if (edge === 'left') return { x: depth, y: height / 2 + across };
  if (edge === 'right') return { x: width - depth, y: height / 2 + across };
  if (edge === 'top') return { x: width / 2 + across, y: depth };
  return { x: width / 2 + across, y: height - depth };
}

function inwardOf(edge: TacticalEdge): [number, number] {
  return edge === 'left' ? [1, 0] : edge === 'right' ? [-1, 0] : edge === 'top' ? [0, 1] : [0, -1];
}

function speedOf(unit: BattleUnitSetup, content: Content): number {
  const rules = content.rules.combat.tactical;
  const hull = unit.hull ? content.hulls[unit.hull] : undefined;
  if (!hull) return 0;
  return (rules.baseSpeed + rules.speedPerHullSpeed * hull.speed) / rules.ticksPerSecond;
}

/** The weapons a unit carries, from the rules' loadouts. */
export function loadoutOf(unit: { armed: boolean; role: string; hull: HullId | null }, content: Content): string[] {
  if (!unit.armed) return [];
  const loadouts = content.rules.combat.tactical.loadouts;
  if (unit.role === 'battery') return loadouts.battery;
  return (unit.hull && loadouts[unit.hull]) || loadouts.default;
}

function makeUnit(unit: BattleUnitSetup, side: TacticalSide, x: number, y: number, speed: number, content: Content, rng: RngState): TacticalUnit {
  const weapons = content.rules.combat.tactical.weapons;
  const [hx, hy] = inwardOf(side.edge);
  const loadout = loadoutOf(unit, content);
  const ranges = loadout.map((w) => weapons[w].range);
  return {
    ...unit,
    x,
    y,
    vx: hx * speed * 0.5,
    vy: hy * speed * 0.5,
    hx,
    hy,
    speed,
    range: ranges.length ? Math.max(...ranges) : 0,
    closeRange: ranges.length ? Math.min(...ranges) : 0,
    radius: unitRadius(unit.role, unit.tier),
    // Guns start staggered so a whole line does not fire on the same tick.
    guns: loadout.map((weapon) => ({ weapon, reload: nextInt(rng, Math.floor(weapons[weapon].reloadTicks / 3), weapons[weapon].reloadTicks) })),
    ax: x,
    ay: y,
    orbit: nextInt(rng, 0, 1) === 0 ? 1 : -1,
    jx: 0,
    jy: 0,
    jinkTicks: nextInt(rng, 5, 30),
    order: unit.stance === 'evade' ? { kind: 'withdraw' } : { kind: 'auto' },
    status: 'active',
    target: null,
  };
}

/** True if the two empires are fighting each other in this battle. */
export function tacticalHostile(battle: TacticalBattle, a: EmpireId, b: EmpireId): boolean {
  return a !== b && battle.wars.includes(pairKey(a, b));
}

const sideOf = (battle: TacticalBattle, empire: EmpireId): TacticalSide => battle.sides.find((s) => s.empire === empire)!;
const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function nearest<T extends { x: number; y: number }>(from: { x: number; y: number }, pool: T[]): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const u of pool) {
    const d = dist2(from, u);
    if (d < bestD) {
      best = u;
      bestD = d;
    }
  }
  return best;
}

/**
 * Gives an order to some of a side's units. Only active units of that empire
 * take it; an attack order needs an active enemy as its target. Returns how
 * many units took the order. Changes the battle in place.
 */
export function orderTactical(battle: TacticalBattle, empire: EmpireId, unitIds: string[], order: TacticalOrder): number {
  if (battle.over) return 0;
  if (order.kind === 'attack') {
    const target = battle.units.find((u) => u.id === order.target);
    if (!target || target.status !== 'active' || !tacticalHostile(battle, empire, target.empire)) return 0;
  }
  if (order.kind === 'move' && !(Number.isFinite(order.x) && Number.isFinite(order.y))) return 0;
  let given = 0;
  for (const unit of battle.units) {
    if (unit.empire !== empire || unit.status !== 'active' || !unitIds.includes(unit.id)) continue;
    // Batteries cannot move or leave; they can only be told what to shoot.
    if (unit.speed === 0 && (order.kind === 'move' || order.kind === 'withdraw')) continue;
    if (!unit.armed && order.kind === 'attack') continue;
    if (order.kind === 'move') {
      unit.order = {
        kind: 'move',
        x: Math.max(0, Math.min(battle.width, order.x)),
        y: Math.max(0, Math.min(battle.height, order.y)),
      };
    } else {
      unit.order = { ...order };
      if (order.kind === 'hold') {
        unit.ax = unit.x;
        unit.ay = unit.y;
      }
    }
    given++;
  }
  return given;
}

/** An empire's fighting strength on the field: attack times hull, over its armed units. */
export function tacticalStrength(battle: TacticalBattle, empire: EmpireId): number {
  let total = 0;
  for (const u of battle.units) if (u.empire === empire && u.status === 'active' && u.armed && u.order.kind !== 'withdraw') total += u.attack * u.hp;
  return total;
}

/** A computer-led side withdraws once it is clearly beaten. */
function computerThinks(battle: TacticalBattle, content: Content): void {
  const percent = content.rules.combat.tactical.withdrawPercent;
  for (const side of battle.sides) {
    if (side.commander !== 'computer') continue;
    const mine = battle.units.filter((u) => u.empire === side.empire && u.status === 'active' && u.speed > 0);
    if (mine.length === 0 || mine.every((u) => u.order.kind === 'withdraw')) continue;
    const own = tacticalStrength(battle, side.empire);
    let enemy = 0;
    for (const other of battle.sides) if (tacticalHostile(battle, side.empire, other.empire)) enemy += tacticalStrength(battle, other.empire);
    if (enemy > 0 && own * 100 < enemy * percent) {
      for (const u of mine) u.order = { kind: 'withdraw' };
    }
  }
}

/** Which way a unit wants to go this tick, as a direction of any length, and how hard, as a fraction of top speed. */
interface Wish {
  x: number;
  y: number;
  throttle: number;
}

/**
 * Circles a point at the given distance: pulled in from further out, pushed
 * back from closer in, and swinging round it fastest at the right distance.
 */
function circle(unit: TacticalUnit, cx: number, cy: number, radius: number, throttle: number): Wish {
  const dx = unit.x - cx;
  const dy = unit.y - cy;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const rx = dx / d;
  const ry = dy / d;
  const off = (d - radius) / radius;
  const pull = -Math.max(-1, Math.min(1, off));
  const swirl = Math.max(0.3, 1 - Math.abs(off));
  return { x: rx * pull - ry * unit.orbit * swirl, y: ry * pull + rx * unit.orbit * swirl, throttle };
}

/** How close a ship likes to stay to what it is fighting: inside its shortest-reaching gun. */
const fightingDistance = (unit: TacticalUnit) => Math.max(unit.radius * 3, unit.closeRange * 0.7);

/** Where a unit wants to go this tick, and what it is after. Null for a unit that cannot move. */
function wishOf(battle: TacticalBattle, unit: TacticalUnit, active: TacticalUnit[]): Wish | null {
  const enemies = active.filter((o) => tacticalHostile(battle, unit.empire, o.empire));
  const order = unit.order;

  if (order.kind === 'withdraw') {
    const [ix, iy] = inwardOf(sideOf(battle, unit.empire).edge);
    unit.target = null;
    return { x: -ix, y: -iy, throttle: 1 };
  }
  if (order.kind === 'hold') {
    const inRange = enemies.filter((e) => dist2(unit, e) <= unit.range * unit.range);
    unit.target = nearest(unit, inRange)?.id ?? null;
    return circle(unit, unit.ax, unit.ay, 30, 0.4);
  }
  if (order.kind === 'move') {
    const dx = order.x - unit.x;
    const dy = order.y - unit.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 12) {
      unit.order = { kind: 'hold' };
      unit.ax = order.x;
      unit.ay = order.y;
      return circle(unit, unit.ax, unit.ay, 30, 0.4);
    }
    return { x: dx / d, y: dy / d, throttle: Math.min(1, 0.3 + d / 80) };
  }
  if (order.kind === 'attack') {
    const target = active.find((o) => o.id === order.target);
    if (target) {
      unit.target = target.id;
      return circle(unit, target.x, target.y, fightingDistance(unit), 1);
    }
    unit.order = { kind: 'auto' };
  }

  // Auto: follow the fleet's stance.
  if (!unit.armed) {
    const friendsArmed = active.some((o) => o.empire === unit.empire && o.armed && o.order.kind !== 'withdraw');
    if (!friendsArmed) {
      unit.order = { kind: 'withdraw' };
      return wishOf(battle, unit, active);
    }
    // Keep clear of the nearest armed enemy, and loiter wherever it got to.
    const threat = nearest(unit, enemies.filter((e) => e.armed));
    if (threat && dist2(unit, threat) < (threat.range + 120) ** 2) {
      const d = Math.sqrt(dist2(unit, threat)) || 1;
      unit.ax = unit.x;
      unit.ay = unit.y;
      return { x: (unit.x - threat.x) / d, y: (unit.y - threat.y) / d, throttle: 1 };
    }
    return circle(unit, unit.ax, unit.ay, 50, 0.35);
  }
  if (enemies.length === 0) {
    unit.target = null;
    return circle(unit, unit.ax, unit.ay, 40, 0.4);
  }

  const current = unit.target ? enemies.find((e) => e.id === unit.target) : undefined;
  let target: TacticalUnit | null = current ?? null;
  if (!target || battle.tick % 20 === 0) {
    const armed = enemies.filter((e) => e.armed);
    const soft = enemies.filter((e) => !e.armed);
    if (unit.stance === 'raid') target = nearest(unit, soft) ?? nearest(unit, armed);
    else if (unit.stance === 'escort') {
      const ward = nearest(unit, active.filter((o) => o.empire === unit.empire && !o.armed));
      target = ward ? nearest(ward, enemies) : nearest(unit, armed) ?? nearest(unit, soft);
      if (ward && target && dist2(ward, target) > (unit.range + 160) ** 2) {
        unit.target = null;
        return circle(unit, ward.x, ward.y, 70, 1);
      }
    } else target = nearest(unit, armed) ?? nearest(unit, soft);
  }
  unit.target = target?.id ?? null;
  if (!target) return circle(unit, unit.ax, unit.ay, 40, 0.4);
  unit.ax = unit.x;
  unit.ay = unit.y;
  return circle(unit, target.x, target.y, fightingDistance(unit), 1);
}

/** Now and then a ship throws in a new sideways jink, and sometimes turns the way it circles. */
function jink(battle: TacticalBattle, unit: TacticalUnit): void {
  if (--unit.jinkTicks > 0) return;
  unit.jinkTicks = nextInt(battle.rng, 12, 40);
  unit.jx = nextInt(battle.rng, -100, 100);
  unit.jy = nextInt(battle.rng, -100, 100);
  if (nextInt(battle.rng, 0, 3) === 0) unit.orbit = -unit.orbit;
}

/** Turns a wish into a change of velocity, as fast as the ship can turn, and moves it. */
function steer(battle: TacticalBattle, unit: TacticalUnit, wish: Wish, accelPercent: number): void {
  const withdrawing = unit.order.kind === 'withdraw';
  let wx = wish.x + (unit.jx / 100) * (withdrawing ? 0.2 : 0.45);
  let wy = wish.y + (unit.jy / 100) * (withdrawing ? 0.2 : 0.45);
  // A ship that is staying in the fight turns back from the edge of the field.
  if (!withdrawing) {
    const edge = 60;
    if (unit.x < edge) wx += 1.5;
    if (unit.x > battle.width - edge) wx -= 1.5;
    if (unit.y < edge) wy += 1.5;
    if (unit.y > battle.height - edge) wy -= 1.5;
  }
  const len = Math.sqrt(wx * wx + wy * wy);
  const top = unit.speed * wish.throttle;
  const want = len > 0 ? { x: (wx / len) * top, y: (wy / len) * top } : { x: 0, y: 0 };
  let dvx = want.x - unit.vx;
  let dvy = want.y - unit.vy;
  const dv = Math.sqrt(dvx * dvx + dvy * dvy);
  const most = (unit.speed * accelPercent) / 100;
  if (dv > most) {
    dvx = (dvx / dv) * most;
    dvy = (dvy / dv) * most;
  }
  unit.vx += dvx;
  unit.vy += dvy;
  const v = Math.sqrt(unit.vx * unit.vx + unit.vy * unit.vy);
  if (v > unit.speed) {
    unit.vx = (unit.vx / v) * unit.speed;
    unit.vy = (unit.vy / v) * unit.speed;
  }
  unit.x += unit.vx;
  unit.y += unit.vy;
}

/** A hit's damage: an auto-resolved hit, scaled by the weapon and shared among the firer's weapons. */
function hitDamage(attack: number, target: TacticalUnit, roll: number, weapon: TacticalWeapon, share: number, content: Content): number {
  const base = shotDamage(attack, target, roll, target.order.kind === 'withdraw', content);
  return Math.max(1, Math.floor((base * weapon.damagePercent) / (100 * share)));
}

/** How far along the segment from (x0, y0) by (dx, dy) it first comes within r of the point, from 0 to 1, or null. */
function sweep(x0: number, y0: number, dx: number, dy: number, px: number, py: number, r: number): number | null {
  const fx = x0 - px;
  const fy = y0 - py;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** Plays one tick of the battle. Changes it in place; does nothing once it is over. */
export function stepTactical(battle: TacticalBattle, content: Content): void {
  battle.shots = [];
  if (battle.over) return;
  const rules = content.rules.combat;
  const weapons = rules.tactical.weapons;
  if (battle.tick % RETHINK_TICKS === 0) computerThinks(battle, content);

  // Movement: everyone who can move keeps moving.
  let active = battle.units.filter((u) => u.status === 'active');
  for (const unit of active) {
    const wish = wishOf(battle, unit, active);
    if (unit.speed === 0 || !wish) {
      const target = unit.target ? active.find((o) => o.id === unit.target) : undefined;
      if (target) face(unit, target.x - unit.x, target.y - unit.y);
      continue;
    }
    jink(battle, unit);
    steer(battle, unit, wish, rules.tactical.accelPercent);
    face(unit, unit.vx, unit.vy);
  }
  // Keep ships from sitting on top of each other.
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const min = (a.radius + b.radius) * 0.9;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) / 2;
      const nx = d > 0 ? dx / d : 1;
      const ny = d > 0 ? dy / d : 0;
      if (a.speed > 0) {
        a.x -= nx * push;
        a.y -= ny * push;
      }
      if (b.speed > 0) {
        b.x += nx * push;
        b.y += ny * push;
      }
    }
  }
  // Ships that have crossed their own edge are gone.
  const margin = 40;
  for (const unit of active) {
    if (unit.order.kind !== 'withdraw') continue;
    if (unit.x < -margin || unit.y < -margin || unit.x > battle.width + margin || unit.y > battle.height + margin) unit.status = 'withdrawn';
  }
  active = active.filter((u) => u.status === 'active');

  // Everything that lands this tick lands together.
  const damage = new Map<string, number>();
  const shots: TacticalShot[] = [];
  const land = (from: string, target: TacticalUnit, weapon: string, dealt: number, x: number, y: number) => {
    damage.set(target.id, (damage.get(target.id) ?? 0) + dealt);
    shots.push({ from, to: target.id, weapon, delivery: weapons[weapon].delivery, damage: dealt, destroyed: false, x, y });
  };

  // Bolts and missiles in flight.
  const flying: TacticalProjectile[] = [];
  for (const p of battle.projectiles) {
    const weapon = weapons[p.weapon];
    const hostiles = active.filter((o) => tacticalHostile(battle, p.empire, o.empire));
    const step = weapon.speed / battle.ticksPerSecond;
    if (p.delivery === 'homing') {
      let target = hostiles.find((o) => o.id === p.target);
      if (!target) {
        target = nearest(p, hostiles) ?? undefined;
        if (target) p.target = target.id;
      }
      if (target) {
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        p.vx += ((dx / d) * step - p.vx) * (weapon.agility / 100);
        p.vy += ((dy / d) * step - p.vy) * (weapon.agility / 100);
        const v = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
        p.vx = (p.vx / v) * step;
        p.vy = (p.vy / v) * step;
      }
    }
    let struck: TacticalUnit | null = null;
    let at = 2;
    for (const o of hostiles) {
      const t = sweep(p.x, p.y, p.vx, p.vy, o.x, o.y, o.radius * 0.9 + 2);
      if (t !== null && t < at) {
        at = t;
        struck = o;
      }
    }
    if (struck) {
      const x = p.x + p.vx * at;
      const y = p.y + p.vy * at;
      land(p.from, struck, p.weapon, hitDamage(p.attack, struck, p.roll, weapon, p.share, content), x, y);
      continue;
    }
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
    const out = 200;
    if (p.life > 0 && p.x > -out && p.y > -out && p.x < battle.width + out && p.y < battle.height + out) flying.push(p);
  }
  battle.projectiles = flying;

  // Guns: each one that is ready picks a target in its own range.
  for (const unit of active) {
    if (!unit.armed || unit.order.kind === 'withdraw') continue;
    for (const gun of unit.guns) {
      if (gun.reload > 0) gun.reload--;
      if (gun.reload > 0) continue;
      const weapon = weapons[gun.weapon];
      const reach = weapon.range * weapon.range;
      const inRange = active.filter((o) => tacticalHostile(battle, unit.empire, o.empire) && dist2(unit, o) <= reach);
      if (inRange.length === 0) continue;
      const preferred = unit.target ? inRange.find((o) => o.id === unit.target) : undefined;
      const target = preferred ?? nearest(unit, inRange)!;
      const roll = nextInt(battle.rng, rules.minRollPercent, 100);
      gun.reload = weapon.reloadTicks;
      if (weapon.delivery === 'beam') {
        land(unit.id, target, gun.weapon, hitDamage(unit.attack, target, roll, weapon, unit.guns.length, content), target.x, target.y);
        continue;
      }
      const step = weapon.speed / battle.ticksPerSecond;
      let dx = target.x - unit.x;
      let dy = target.y - unit.y;
      if (weapon.delivery === 'bolt') {
        // Aimed where the target will be if it keeps its course.
        const flight = Math.sqrt(dx * dx + dy * dy) / step;
        dx += target.vx * flight;
        dy += target.vy * flight;
      } else {
        // Missiles leave along the ship's heading and curve round onto the target.
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        dx = dx / d + unit.hx * 1.2;
        dy = dy / d + unit.hy * 1.2;
      }
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      battle.projectiles.push({
        id: battle.nextProjectile++,
        weapon: gun.weapon,
        delivery: weapon.delivery,
        from: unit.id,
        empire: unit.empire,
        target: target.id,
        x: unit.x + unit.hx * unit.radius,
        y: unit.y + unit.hy * unit.radius,
        vx: (dx / d) * step,
        vy: (dy / d) * step,
        attack: unit.attack,
        roll,
        share: unit.guns.length,
        life: Math.ceil((weapon.range * (weapon.delivery === 'bolt' ? 1.3 : 2)) / step),
      });
    }
  }
  for (const unit of active) {
    const hit = damage.get(unit.id);
    if (!hit) continue;
    unit.hp = Math.max(0, unit.hp - hit);
    if (unit.hp === 0) unit.status = 'destroyed';
  }
  for (const shot of shots) shot.destroyed = battle.units.find((u) => u.id === shot.to)!.status === 'destroyed';
  battle.shots = shots;
  battle.tick++;

  // Over when no armed unit has an enemy left on the field, or at the time limit.
  const left = battle.units.filter((u) => u.status === 'active');
  const fighting = left.some((u) => u.armed && left.some((o) => tacticalHostile(battle, u.empire, o.empire)));
  if (!fighting) {
    battle.over = true;
    battle.finished = true;
    battle.projectiles = [];
  } else if (battle.tick >= rules.tactical.maxSeconds * battle.ticksPerSecond) {
    battle.over = true;
    battle.finished = false;
    battle.projectiles = [];
  }
}

function face(unit: TacticalUnit, dx: number, dy: number): void {
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d === 0) return;
  unit.hx = dx / d;
  unit.hy = dy / d;
}

/** Plays the battle to its end with nobody giving orders. */
export function runTactical(battle: TacticalBattle, content: Content): void {
  while (!battle.over) stepTactical(battle, content);
}

/** The result to hand to `processTurn` as a commanded battle. */
export function tacticalOutcome(battle: TacticalBattle): BattleOutcome {
  return {
    units: battle.units.map((u) => ({ id: u.id, hp: u.status === 'destroyed' ? 0 : u.hp, withdrawn: u.status === 'withdrawn' })),
    finished: battle.finished,
  };
}

/** Per side: how many units started, are still fighting, withdrew and were lost. */
export function tacticalTally(battle: TacticalBattle): { empire: EmpireId; started: number; active: number; withdrawn: number; destroyed: number }[] {
  return battle.sides.map((side) => {
    const mine = battle.units.filter((u) => u.empire === side.empire);
    return {
      empire: side.empire,
      started: mine.length,
      active: mine.filter((u) => u.status === 'active').length,
      withdrawn: mine.filter((u) => u.status === 'withdrawn').length,
      destroyed: mine.filter((u) => u.status === 'destroyed').length,
    };
  });
}

/** One side of a practice battle: whose ships, and what they bring. */
export interface PracticeSide {
  empire: EmpireId;
  /** Hull ids, one per ship. */
  hulls: string[];
  /** Orbital batteries; only the first side can have them, around its planet. */
  batteries: number;
}

/**
 * A battle that is not part of a game, for trying the battle screen: ships
 * at full hull with no research bonuses, fought in empty space unless the
 * first side brings batteries, which puts a colony of its own in the middle.
 */
export function practiceSetup(content: Content, sides: PracticeSide[]): BattleSetup {
  const battery = sortedKeys(content.buildings).find((id) => content.buildings[id].combat.attack > 0) as BuildingId | undefined;
  const units: BattleUnitSetup[] = [];
  let n = 0;
  sides.forEach((side, i) => {
    for (const hullId of side.hulls) {
      const hull = content.hulls[hullId as HullId];
      if (!hull) continue;
      units.push({
        id: `ship-p${++n}`,
        empire: side.empire,
        fleet: null,
        hull: hull.id,
        name: hull.name,
        role: hull.role,
        tier: hull.tier,
        attack: hull.attack,
        defence: hull.defence,
        shield: 0,
        hp: hull.hp,
        maxHp: hull.hp,
        armed: hull.attack > 0,
        stance: 'engage',
      });
    }
    if (i === 0 && battery) {
      const def = content.buildings[battery];
      for (let b = 0; b < side.batteries; b++) {
        units.push({
          id: `battery-${b + 1}`,
          empire: side.empire,
          fleet: null,
          hull: null,
          name: def.name,
          role: 'battery',
          tier: 1,
          attack: def.combat.attack,
          defence: 0,
          shield: 0,
          hp: def.combat.hp,
          maxHp: def.combat.hp,
          armed: true,
          stance: 'engage',
        });
      }
    }
  });
  const colony = (sides[0]?.batteries ?? 0) > 0 && battery !== undefined;
  return {
    key: 'practice',
    sector: { x: 0, y: 0 },
    system: colony ? ('practice' as BattleSetup['system']) : null,
    colonyOwner: colony ? sides[0].empire : null,
    units,
  };
}

export type TacticalResult = 'fighting' | 'won' | 'lost' | 'withdrew' | 'unfinished';

/**
 * How the battle stands for one empire: won if it still holds the field,
 * withdrew if it got ships away and has none left fighting, lost if
 * everything it brought was destroyed, unfinished at the time limit.
 */
export function tacticalResult(battle: TacticalBattle, empire: EmpireId): TacticalResult {
  if (!battle.over) return 'fighting';
  if (!battle.finished) return 'unfinished';
  const mine = battle.units.filter((u) => u.empire === empire);
  if (mine.some((u) => u.status === 'active')) return 'won';
  return mine.some((u) => u.status === 'withdrawn') ? 'withdrew' : 'lost';
}

/** Hands a side to the computer: its units go back to fighting by their fleet's stance. Changes the battle in place. */
export function yieldTactical(battle: TacticalBattle, empire: EmpireId): void {
  const side = battle.sides.find((s) => s.empire === empire);
  if (!side) return;
  side.commander = 'computer';
  for (const u of battle.units) if (u.empire === empire && u.status === 'active' && u.order.kind !== 'withdraw') u.order = { kind: 'auto' };
}
