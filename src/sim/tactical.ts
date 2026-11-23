/**
 * Commanded battles: the real-time alternative to auto-resolving a battle.
 *
 * A `TacticalBattle` starts from a `BattleSetup` (see `battlesAhead`), runs in
 * fixed ticks and ends when no armed unit has an enemy left on the field. Its
 * result, `tacticalOutcome`, goes back into `processTurn` as a commanded
 * battle. Damage per shot is worked out by `shotDamage`, exactly as in an
 * auto-resolved round; what changes is who shoots whom, and when.
 *
 * Unlike the game state, a battle is a working object that is stepped many
 * times a second, so `stepTactical` and `orderTactical` change it in place
 * rather than copying it. It is still plain JSON, and it uses only seeded
 * rolls and exactly rounded arithmetic (+, -, *, / and sqrt), so the same
 * setup, seed and orders always play out the same way.
 */
import { atWar, shotDamage } from './combat';
import type { Content } from './content';
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

export interface TacticalUnit extends BattleUnitSetup {
  x: number;
  y: number;
  /** The way the unit faces, as a unit vector. */
  hx: number;
  hy: number;
  /** Arena units per tick; 0 for an orbital battery. */
  speed: number;
  /** How far it can shoot; 0 if unarmed. */
  range: number;
  radius: number;
  /** Ticks until it can fire again. */
  reload: number;
  order: TacticalOrder;
  status: 'active' | 'destroyed' | 'withdrawn';
  /** What it is closing on or shooting at, if anything. */
  target: string | null;
}

/** One shot fired during the last step, for drawing. */
export interface TacticalShot {
  from: string;
  to: string;
  damage: number;
  destroyed: boolean;
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
  /** Shots fired during the last step. */
  shots: TacticalShot[];
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

function makeUnit(unit: BattleUnitSetup, side: TacticalSide, x: number, y: number, speed: number, content: Content, rng: RngState): TacticalUnit {
  const rules = content.rules.combat.tactical;
  const [hx, hy] = inwardOf(side.edge);
  return {
    ...unit,
    x,
    y,
    hx,
    hy,
    speed,
    range: !unit.armed ? 0 : unit.role === 'battery' ? rules.batteryRange : rules.shipRange,
    radius: unitRadius(unit.role, unit.tier),
    // Guns start staggered so a whole line does not fire on the same tick.
    reload: nextInt(rng, Math.floor(rules.reloadTicks / 3), rules.reloadTicks),
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

/** Where a unit wants to be this tick, and what it is after. */
function goalOf(battle: TacticalBattle, unit: TacticalUnit, active: TacticalUnit[]): { x: number; y: number; stopAt: number } | null {
  const enemies = active.filter((o) => tacticalHostile(battle, unit.empire, o.empire));
  const order = unit.order;

  if (order.kind === 'withdraw') {
    const [ix, iy] = inwardOf(sideOf(battle, unit.empire).edge);
    unit.target = null;
    // Straight out through the side's own edge, well past it.
    const out = 200;
    const x = ix === 0 ? unit.x : ix > 0 ? -out : battle.width + out;
    const y = iy === 0 ? unit.y : iy > 0 ? -out : battle.height + out;
    return { x, y, stopAt: 0 };
  }
  if (order.kind === 'hold') return null;
  if (order.kind === 'move') return { x: order.x, y: order.y, stopAt: 2 };
  if (order.kind === 'attack') {
    const target = active.find((o) => o.id === order.target);
    if (target) {
      unit.target = target.id;
      return { x: target.x, y: target.y, stopAt: unit.range * 0.85 };
    }
    unit.order = { kind: 'auto' };
  }

  // Auto: follow the fleet's stance.
  if (!unit.armed) {
    const friendsArmed = active.some((o) => o.empire === unit.empire && o.armed && o.order.kind !== 'withdraw');
    if (!friendsArmed) {
      unit.order = { kind: 'withdraw' };
      return goalOf(battle, unit, active);
    }
    // Keep clear of the nearest armed enemy.
    const threat = nearest(unit, enemies.filter((e) => e.armed));
    if (!threat || dist2(unit, threat) > (threat.range + 120) ** 2) return null;
    const d = Math.sqrt(dist2(unit, threat)) || 1;
    return { x: unit.x + ((unit.x - threat.x) / d) * 100, y: unit.y + ((unit.y - threat.y) / d) * 100, stopAt: 0 };
  }
  if (enemies.length === 0) return null;

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
        return { x: ward.x, y: ward.y, stopAt: 60 };
      }
    } else target = nearest(unit, armed) ?? nearest(unit, soft);
  }
  unit.target = target?.id ?? null;
  return target ? { x: target.x, y: target.y, stopAt: unit.range * 0.85 } : null;
}

/** Plays one tick of the battle. Changes it in place; does nothing once it is over. */
export function stepTactical(battle: TacticalBattle, content: Content): void {
  battle.shots = [];
  if (battle.over) return;
  const rules = content.rules.combat;
  if (battle.tick % RETHINK_TICKS === 0) computerThinks(battle, content);

  // Movement.
  let active = battle.units.filter((u) => u.status === 'active');
  for (const unit of active) {
    const goal = goalOf(battle, unit, active);
    if (unit.speed === 0) {
      const target = unit.target ? active.find((o) => o.id === unit.target) : undefined;
      if (target) face(unit, target.x - unit.x, target.y - unit.y);
      continue;
    }
    if (goal) {
      const dx = goal.x - unit.x;
      const dy = goal.y - unit.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > goal.stopAt) {
        const step = Math.min(unit.speed, d - goal.stopAt);
        unit.x += (dx / d) * step;
        unit.y += (dy / d) * step;
        face(unit, dx, dy);
      } else if (unit.order.kind === 'move') {
        unit.order = { kind: 'hold' };
      } else if (unit.target) {
        const target = active.find((o) => o.id === unit.target);
        if (target) face(unit, target.x - unit.x, target.y - unit.y);
      }
    }
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

  // Fire. Everyone who is ready picks a target in range, then all hits land together.
  const damage = new Map<string, number>();
  const shots: TacticalShot[] = [];
  for (const unit of active) {
    if (!unit.armed || unit.order.kind === 'withdraw') continue;
    if (unit.reload > 0) unit.reload--;
    if (unit.reload > 0) continue;
    const reach = unit.range * unit.range;
    const inRange = active.filter((o) => tacticalHostile(battle, unit.empire, o.empire) && dist2(unit, o) <= reach);
    if (inRange.length === 0) continue;
    const preferred = unit.target ? inRange.find((o) => o.id === unit.target) : undefined;
    const target = preferred ?? nearest(unit, inRange)!;
    const roll = nextInt(battle.rng, rules.minRollPercent, 100);
    const dealt = shotDamage(unit.attack, target, roll, target.order.kind === 'withdraw', content);
    damage.set(target.id, (damage.get(target.id) ?? 0) + dealt);
    shots.push({ from: unit.id, to: target.id, damage: dealt, destroyed: false });
    unit.reload = rules.tactical.reloadTicks;
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
  } else if (battle.tick >= rules.tactical.maxSeconds * battle.ticksPerSecond) {
    battle.over = true;
    battle.finished = false;
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
