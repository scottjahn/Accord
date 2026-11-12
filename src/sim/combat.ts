import type { Content } from './content';
import { applyGovernor } from './economy/governor';
import { coloniesOf, findPath, fleetsOf, systemAt } from './fleets';
import { sameSector, sectorDistance, sectorKey } from './geometry';
import { sortedKeys, type EmpireId, type FleetId } from './ids';
import { nextInt } from './rng';
import type {
  BreakdownLine,
  CombatReport,
  CombatShot,
  CombatUnit,
  Fleet,
  GameState,
  InvasionReport,
  Sector,
  Stance,
  StarSystem,
  TurnEvent,
} from './types';

/** Key for a pair of empires, the same whichever way round they are given. */
export const warKey = (a: EmpireId, b: EmpireId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const atWar = (state: GameState, a: EmpireId, b: EmpireId): boolean => a !== b && warKey(a, b) in state.wars;

const totalOfLines = (lines: BreakdownLine[]): number => {
  let sum = 0;
  let percent = 0;
  for (const line of lines) {
    if (line.kind === 'percent') percent += line.value;
    else sum += line.value;
  }
  return Math.max(0, Math.floor((sum * (100 + percent)) / 100));
};

/** Percent added to attack and taken off incoming damage by an empire's research. */
export function combatBonuses(state: GameState, empireId: EmpireId, content: Content): { attack: number; shield: number } {
  const levels = state.empires[empireId].research.levels;
  let attack = 0;
  let shield = 0;
  for (const field of sortedKeys(content.fields)) {
    attack += content.fields[field].combat.attackPercent * levels[field];
    shield += content.fields[field].combat.shieldPercent * levels[field];
  }
  return { attack, shield: Math.min(75, shield) };
}

/** Ships at a friendly shipyard regain part of their hull each turn. Mutates the state. */
export function repairShips(state: GameState, content: Content): void {
  const yard = content.rules.fleets.shipyardBuilding;
  for (const id of sortedKeys(state.fleets)) {
    const fleet = state.fleets[id];
    const colony = systemAt(state, fleet.sector)?.colony;
    if (!colony || colony.owner !== fleet.owner || (colony.buildings[yard] ?? 0) < 1) continue;
    for (const ship of fleet.ships) {
      const max = content.hulls[ship.hull]?.hp ?? ship.hp;
      ship.hp = Math.min(max, ship.hp + Math.ceil((max * content.rules.combat.repairPercent) / 100));
    }
  }
}

interface Fighter extends CombatUnit {
  attack: number;
  defence: number;
  shield: number;
  hp: number;
  stance: Stance;
  armed: boolean;
  /** The fleet a ship belongs to; null for an orbital battery. */
  fleet: FleetId | null;
  /** True for a ship in an evading fleet: it does not fire and leaves after the first round. */
  evading: boolean;
}

/** Everything in a sector that can take part in a battle. */
function fightersAt(state: GameState, sector: Sector, content: Content): Fighter[] {
  const fighters: Fighter[] = [];
  const bonus = new Map<EmpireId, { attack: number; shield: number }>();
  const bonusOf = (empire: EmpireId) => {
    if (!bonus.has(empire)) bonus.set(empire, combatBonuses(state, empire, content));
    return bonus.get(empire)!;
  };

  for (const id of sortedKeys(state.fleets)) {
    const fleet = state.fleets[id];
    if (!sameSector(fleet.sector, sector)) continue;
    for (const ship of fleet.ships) {
      const hull = content.hulls[ship.hull];
      if (!hull) continue;
      const b = bonusOf(fleet.owner);
      fighters.push({
        id: ship.id,
        empire: fleet.owner,
        name: hull.name,
        role: hull.role,
        attack: Math.floor((hull.attack * (100 + b.attack)) / 100),
        defence: hull.defence,
        shield: b.shield,
        hp: ship.hp,
        stance: fleet.stance,
        armed: hull.attack > 0,
        fleet: id,
        evading: fleet.stance === 'evade',
      });
    }
  }

  const system = systemAt(state, sector);
  if (system?.colony) {
    const owner = system.colony.owner;
    let n = 0;
    for (const id of sortedKeys(system.colony.buildings)) {
      const def = content.buildings[id];
      if (!def || def.combat.attack <= 0) continue;
      for (let i = 0; i < system.colony.buildings[id]; i++) {
        const b = bonusOf(owner);
        fighters.push({
          id: `battery-${++n}`,
          empire: owner,
          name: def.name,
          role: 'battery',
          attack: Math.floor((def.combat.attack * (100 + b.attack)) / 100),
          defence: 0,
          shield: b.shield,
          hp: def.combat.hp,
          stance: 'engage',
          armed: true,
          fleet: null,
          evading: false,
        });
      }
    }
  }
  return fighters;
}

/**
 * Picks a target for one shooter.
 * - engage and escort go for armed enemies first;
 * - raid goes for unarmed ships first, but an enemy escort in the sector draws that fire onto itself.
 * Within the preferred group the target is a seeded roll, so fire spreads out.
 */
function chooseTarget(state: GameState, shooter: Fighter, alive: Fighter[]): Fighter | null {
  const enemies = alive.filter((f) => atWar(state, shooter.empire, f.empire));
  if (enemies.length === 0) return null;
  const armed = enemies.filter((f) => f.armed);
  const soft = enemies.filter((f) => !f.armed);
  let pool: Fighter[];
  if (shooter.stance === 'raid') {
    const escorts = armed.filter((f) => f.stance === 'escort' && soft.some((s) => s.empire === f.empire));
    const exposed = soft.filter((s) => !escorts.some((e) => e.empire === s.empire));
    pool = exposed.length > 0 ? exposed : escorts.length > 0 ? escorts : soft.length > 0 ? soft : armed;
  } else {
    pool = armed.length > 0 ? armed : soft;
  }
  return pool[nextInt(state.rng, 0, pool.length - 1)];
}

/** The owner's nearest other colony, for a fleet falling back. */
function retreatStep(state: GameState, fleet: Fleet, content: Content): Sector | null {
  const havens = coloniesOf(state, fleet.owner)
    .filter((c) => !sameSector(c.sector, fleet.sector))
    .sort((a, b) => sectorDistance(a.sector, fleet.sector) - sectorDistance(b.sector, fleet.sector) || (a.id < b.id ? -1 : 1));
  for (const haven of havens) {
    const path = findPath(state, fleet, haven.sector, content);
    if (path && path.length > 0) return path[0];
  }
  return null;
}

/**
 * Fights every sector where empires at war meet. Up to `maxRounds` rounds per
 * turn; all shots in a round are simultaneous. Damage to ships lasts; orbital
 * batteries are restored each turn. Returns the sectors where a colony's
 * batteries were knocked out this turn, which lets an invasion land.
 * Mutates the state.
 */
export function resolveBattles(state: GameState, content: Content, events: TurnEvent[]): Set<string> {
  const rules = content.rules.combat;
  const silenced = new Set<string>();
  const sectors = new Map<string, Sector>();
  for (const id of sortedKeys(state.fleets)) sectors.set(sectorKey(state.fleets[id].sector), state.fleets[id].sector);

  for (const key of [...sectors.keys()].sort()) {
    const sector = sectors.get(key)!;
    const everyone = fightersAt(state, sector, content);
    const hostile = (f: Fighter, pool: Fighter[]) => pool.some((o) => atWar(state, f.empire, o.empire));
    // Only empires with an enemy present take part, and someone has to be able to shoot.
    const fighters = everyone.filter((f) => hostile(f, everyone));
    if (fighters.length === 0 || !fighters.some((f) => f.armed && !f.evading)) continue;

    const units: CombatUnit[] = fighters.map(({ id, empire, name, role }) => ({ id, empire, name, role }));
    const before = new Map<EmpireId, number>();
    for (const f of fighters) before.set(f.empire, (before.get(f.empire) ?? 0) + 1);

    let alive = fighters;
    const rounds: CombatShot[][] = [];
    for (let round = 0; round < rules.maxRounds; round++) {
      const shooters = alive.filter((f) => f.armed && !f.evading);
      const damage = new Map<string, number>();
      const shots: CombatShot[] = [];
      for (const shooter of shooters) {
        const target = chooseTarget(state, shooter, alive);
        if (!target) continue;
        const roll = nextInt(state.rng, rules.minRollPercent, 100);
        let dealt = Math.max(1, Math.floor((shooter.attack * roll) / 100) - target.defence);
        dealt = Math.max(1, Math.floor((dealt * (100 - target.shield)) / 100));
        if (target.evading) dealt = Math.max(1, Math.floor((dealt * rules.evadeFirePercent) / 100));
        damage.set(target.id, (damage.get(target.id) ?? 0) + dealt);
        shots.push({ attacker: shooter.id, target: target.id, roll, damage: dealt, destroyed: false });
      }
      if (shots.length === 0) break;
      for (const f of alive) f.hp -= damage.get(f.id) ?? 0;
      for (const shot of shots) shot.destroyed = alive.find((f) => f.id === shot.target)!.hp <= 0;
      rounds.push(shots);
      // Evading ships that survived the first round are away.
      alive = alive.filter((f) => f.hp > 0 && !(f.evading && round === 0));
      if (!alive.some((f) => f.armed && hostile(f, alive))) break;
    }
    if (rounds.length === 0) continue;

    // Write the results back: hull damage, losses, and fleets that got away.
    const survivors = new Map(fighters.filter((f) => f.hp > 0).map((f) => [f.id, f.hp]));
    const fleetIds = [...new Set(fighters.map((f) => f.fleet).filter((f): f is FleetId => f !== null))].sort();
    for (const id of fleetIds) {
      const fleet = state.fleets[id];
      fleet.ships = fleet.ships.filter((s) => survivors.has(s.id));
      for (const ship of fleet.ships) ship.hp = survivors.get(ship.id)!;
      if (fleet.ships.length === 0) {
        delete state.fleets[id];
      } else if (fleet.stance === 'evade') {
        const step = retreatStep(state, fleet, content);
        if (step) {
          fleet.sector = { ...step };
          fleet.destination = null;
          fleet.order = 'none';
        }
      }
    }

    const colonyOwner = systemAt(state, sector)?.colony?.owner;
    if (colonyOwner && fighters.some((f) => f.role === 'battery') && !fighters.some((f) => f.role === 'battery' && f.hp > 0)) {
      silenced.add(key);
    }

    const stillHere = fightersAt(state, sector, content).filter((f) => f.role !== 'battery' || !silenced.has(key));
    const report: CombatReport = {
      sector: { ...sector },
      units,
      sides: [...before.keys()].sort().map((empire) => ({
        empire,
        before: before.get(empire)!,
        after: fighters.filter((f) => f.empire === empire && f.hp > 0).length,
      })),
      rounds,
      outcome: stillHere.some((f) => f.armed && hostile(f, stillHere)) ? 'ongoing' : 'decided',
    };
    events.push({ type: 'battle', empires: report.sides.map((s) => s.empire), report });
  }
  return silenced;
}

/** Ground strength of a colony's defenders, with its causes. */
export function garrisonStrength(system: StarSystem, content: Content): { total: number; lines: BreakdownLine[] } {
  const colony = system.colony!;
  const perPop = content.rules.combat.garrisonPerPopulation;
  const lines: BreakdownLine[] = [{ source: `Population ${colony.population}`, kind: 'base', value: colony.population * perPop }];
  for (const id of sortedKeys(colony.buildings)) {
    const def = content.buildings[id];
    if (def && def.combat.garrison > 0 && colony.buildings[id] > 0) {
      lines.push({ source: `${def.name} x${colony.buildings[id]}`, kind: 'flat', value: def.combat.garrison * colony.buildings[id] });
    }
  }
  return { total: totalOfLines(lines), lines };
}

/** Troops a fleet can land, with the empire's attack research applied. */
export function troopStrength(state: GameState, fleets: Fleet[], content: Content): { total: number; lines: BreakdownLine[] } {
  const lines: BreakdownLine[] = [];
  let transports = 0;
  let troops = 0;
  for (const fleet of fleets) {
    for (const ship of fleet.ships) {
      const carried = content.hulls[ship.hull]?.troops ?? 0;
      if (carried > 0) {
        transports += 1;
        troops += carried;
      }
    }
  }
  if (transports > 0) lines.push({ source: `${transports} transport${transports === 1 ? '' : 's'}`, kind: 'base', value: troops });
  const bonus = fleets.length > 0 ? combatBonuses(state, fleets[0].owner, content).attack : 0;
  if (bonus !== 0) lines.push({ source: 'Weapons research', kind: 'percent', value: bonus });
  return { total: totalOfLines(lines), lines };
}

/** Why this fleet cannot invade this system, or null if it can. `owner` is who holds it as far as the empire knows. */
export function invadeBlocker(state: GameState, fleet: Fleet, system: StarSystem, owner: EmpireId | null, content: Content): string | null {
  if (!fleet.ships.some((s) => (content.hulls[s.hull]?.troops ?? 0) > 0)) return 'The fleet has no troop transports';
  if (owner === null) return `${system.name} has no colony to invade`;
  if (owner === fleet.owner) return `${system.name} is already yours`;
  if (!atWar(state, fleet.owner, owner)) return `You are not at war with the owner of ${system.name}`;
  return null;
}

/**
 * Lands troops for fleets that have arrived with an invade order. Defending
 * warships or working batteries in the sector stop the landing. Troops are
 * spent whether or not the colony falls. Mutates the state.
 */
export function resolveInvasions(state: GameState, content: Content, silenced: Set<string>, events: TurnEvent[]): void {
  const rules = content.rules.combat;
  const landings = new Map<string, Fleet[]>();
  for (const id of sortedKeys(state.fleets)) {
    const fleet = state.fleets[id];
    if (fleet.order !== 'invade' || fleet.destination) continue;
    const key = `${sectorKey(fleet.sector)}:${fleet.owner}`;
    landings.set(key, [...(landings.get(key) ?? []), fleet]);
  }

  for (const key of [...landings.keys()].sort()) {
    const fleets = landings.get(key)!;
    const attacker = fleets[0].owner;
    const system = systemAt(state, fleets[0].sector);
    const defender = system?.colony?.owner ?? null;
    if (!system || invadeBlocker(state, fleets[0], system, defender, content)) {
      for (const fleet of fleets) fleet.order = 'none';
      continue;
    }

    const defended =
      fleetsOf(state, defender!).some((f) => sameSector(f.sector, system.sector) && f.ships.some((s) => (content.hulls[s.hull]?.attack ?? 0) > 0)) ||
      (!silenced.has(sectorKey(system.sector)) &&
        sortedKeys(system.colony!.buildings).some((b) => (content.buildings[b]?.combat.attack ?? 0) > 0 && system.colony!.buildings[b] > 0));
    if (defended) continue; // keep the order and try again next turn

    const attack = troopStrength(state, fleets, content);
    const defence = garrisonStrength(system, content);
    const roll = nextInt(state.rng, rules.minRollPercent, 100);
    const captured = Math.floor((attack.total * roll) / 100) > defence.total;

    // The troops have landed either way; their transports are used up.
    for (const fleet of fleets) {
      fleet.order = 'none';
      fleet.ships = fleet.ships.filter((s) => (content.hulls[s.hull]?.troops ?? 0) === 0);
      if (fleet.ships.length === 0) delete state.fleets[fleet.id];
    }

    const colony = system.colony!;
    const populationBefore = colony.population;
    if (captured) {
      colony.owner = attacker;
      colony.population = Math.max(1, colony.population - Math.ceil((colony.population * rules.captureLossPercent) / 100));
      for (const b of sortedKeys(colony.buildings)) {
        colony.buildings[b] = Math.floor((colony.buildings[b] * (100 - rules.captureBuildingLossPercent)) / 100);
        if (colony.buildings[b] === 0) delete colony.buildings[b];
      }
      colony.buildQueue = [];
      colony.growthProgress = 0;
      colony.allocation = { food: 0, industry: 0, energy: 0, intel: 0, research: 0 };
      colony.governor = 'balanced';
      applyGovernor(state, system, content);
    }
    const report: InvasionReport = {
      system: system.id,
      attacker,
      defender: defender!,
      attack,
      defence,
      roll,
      captured,
      populationLost: populationBefore - colony.population,
    };
    events.push({ type: 'invasion', empires: [attacker, defender!], report });
  }
}

/**
 * Eliminates empires with no colony and no colony ship, and declares a winner
 * when only one empire is left. Mutates the state.
 */
export function checkVictory(state: GameState, content: Content, events: TurnEvent[]): void {
  const ids = sortedKeys(state.empires);
  for (const id of ids) {
    const empire = state.empires[id];
    if (empire.eliminated) continue;
    const settlers = fleetsOf(state, id).some((f) => f.ships.some((s) => content.hulls[s.hull]?.role === 'colony'));
    if (coloniesOf(state, id).length > 0 || settlers) continue;
    empire.eliminated = true;
    for (const fleet of fleetsOf(state, id)) delete state.fleets[fleet.id];
    events.push({ type: 'empireEliminated', empire: id });
  }
  const standing = ids.filter((id) => !state.empires[id].eliminated);
  if (ids.length > 1 && standing.length === 1 && state.winner === null) {
    state.winner = standing[0];
    events.push({ type: 'gameWon', empire: standing[0] });
  }
}
