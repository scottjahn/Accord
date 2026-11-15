import type { Content } from './content';
import { applyGovernor, governorAllocation } from './economy/governor';
import { atWar, invadeBlocker, warKey } from './combat';
import { buyOutCost, membershipCost, mercenaryCost } from './credits';
import { addOpinion, boundToPeace, breakTreaty, hasMet, hasTreaty, signTreaty, treatyBlocker } from './diplomacy';
import { itemCost } from './economy/build';
import { coloniseBlocker, empireSupport, findPath, fleetOfShip, spawnShip } from './fleets';
import { inBounds, sameSector, sectorKey } from './geometry';
import type { BuildingId, EmpireId, FleetId, HullId, ShipId, SystemId } from './ids';
import { courtGain, minorOf } from './minors';
import { addEmpireMorale } from './morale';
import { operationBlocker } from './intel';
import { meetsRequirements } from './research';
import {
  FIELDS,
  GOVERNORS,
  OUTPUT_KINDS,
  STANCES,
  TREATY_TYPES,
  type Colony,
  type FieldId,
  type Fleet,
  type GameState,
  type AutoGovernor,
  type Governor,
  type OutputKind,
  type WorkerCaps,
  type OperationKind,
  type Outputs,
  type Result,
  type Sector,
  type Stance,
  type StarSystem,
  type TreatyType,
} from './types';
import { visibleSectors } from './view';

/**
 * Everything a player can do. The human UI, the AI and the headless runner all
 * act through these and nothing else.
 */
export type Command =
  | { type: 'setAllocation'; empire: EmpireId; system: SystemId; allocation: Outputs }
  | { type: 'setGovernor'; empire: EmpireId; system: SystemId; governor: Governor }
  | { type: 'adjustWorkers'; empire: EmpireId; system: SystemId; pinned: Outputs }
  /** Sets the most workers a governor may leave on each output; null lifts a limit. */
  | { type: 'capWorkers'; empire: EmpireId; system: SystemId; capped: WorkerCaps }
  /**
   * Under a governor, asks for exactly `workers` on one output: more than the
   * governor would place there are placed by hand, fewer become a cap.
   */
  | { type: 'placeWorkers'; empire: EmpireId; system: SystemId; output: OutputKind; workers: number }
  | { type: 'enqueueBuild'; empire: EmpireId; system: SystemId; building: BuildingId }
  | { type: 'enqueueShip'; empire: EmpireId; system: SystemId; hull: HullId }
  | { type: 'enqueueRefit'; empire: EmpireId; system: SystemId; ship: ShipId; hull: HullId }
  | { type: 'dequeueBuild'; empire: EmpireId; system: SystemId; index: number }
  | { type: 'moveBuild'; empire: EmpireId; system: SystemId; from: number; to: number }
  | { type: 'setResearchAllocation'; empire: EmpireId; allocation: Record<FieldId, number> }
  | { type: 'moveFleet'; empire: EmpireId; fleet: FleetId; to: Sector }
  | { type: 'stopFleet'; empire: EmpireId; fleet: FleetId }
  | { type: 'coloniseSystem'; empire: EmpireId; fleet: FleetId; system: SystemId }
  | { type: 'invadeSystem'; empire: EmpireId; fleet: FleetId; system: SystemId }
  | { type: 'setStance'; empire: EmpireId; fleet: FleetId; stance: Stance }
  | { type: 'declareWar'; empire: EmpireId; on: EmpireId }
  | { type: 'proposeTreaty'; empire: EmpireId; to: EmpireId; treaty: TreatyType }
  | { type: 'answerOffer'; empire: EmpireId; offer: string; accept: boolean; note?: string }
  | { type: 'breakTreaty'; empire: EmpireId; with: EmpireId; treaty: TreatyType }
  | { type: 'buyOut'; empire: EmpireId; system: SystemId }
  | { type: 'giftCredits'; empire: EmpireId; to: EmpireId; amount: number }
  | { type: 'buyMembership'; empire: EmpireId; system: SystemId }
  | { type: 'hireMercenaries'; empire: EmpireId; system: SystemId; hull: HullId }
  | { type: 'setIntelSplit'; empire: EmpireId; percent: number }
  | { type: 'runOperation'; empire: EmpireId; target: EmpireId; kind: OperationKind; system: SystemId | null }
  | { type: 'courtMinor'; empire: EmpireId; system: SystemId; points: number }
  | { type: 'mergeFleets'; empire: EmpireId; from: FleetId; into: FleetId }
  | { type: 'splitFleet'; empire: EmpireId; fleet: FleetId; ships: ShipId[] };

export type CommandErrorCode =
  | 'unknownEmpire'
  | 'unknownSystem'
  | 'notOwner'
  | 'invalidAllocation'
  | 'unknownGovernor'
  | 'unknownBuilding'
  | 'unknownHull'
  | 'unknownShip'
  | 'unknownFleet'
  | 'locked'
  | 'noShipyard'
  | 'supportCap'
  | 'badRefit'
  | 'buildLimit'
  | 'queueFull'
  | 'badIndex'
  | 'outOfRange'
  | 'cannotColonise'
  | 'notThere'
  | 'cannotInvade'
  | 'badStance'
  | 'badWar'
  | 'cannotCourt'
  | 'badTreaty'
  | 'badOffer'
  | 'badSplit'
  | 'cannotAfford'
  | 'notAllowed'
  | 'cannotOperate'
  | 'gameOver'
  | 'badFleets';

export interface CommandError {
  code: CommandErrorCode;
  message: string;
}

const fail = (code: CommandErrorCode, message: string): CommandError => ({ code, message });
const isError = (v: object): v is CommandError => 'code' in v && 'message' in v;

function ownColony(state: GameState, empire: EmpireId, systemId: SystemId): { system: StarSystem; colony: Colony } | CommandError {
  const system = state.systems[systemId];
  if (!system) return fail('unknownSystem', `No system ${systemId}`);
  if (!system.colony || system.colony.owner !== empire) return fail('notOwner', `${empire} does not own ${system.name}`);
  return { system, colony: system.colony };
}

function ownFleet(state: GameState, empire: EmpireId, fleetId: FleetId): Fleet | CommandError {
  const fleet = state.fleets[fleetId];
  if (!fleet) return fail('unknownFleet', `No fleet ${fleetId}`);
  if (fleet.owner !== empire) return fail('notOwner', `${empire} does not command ${fleetId}`);
  return fleet;
}

function requirementText(requires: Partial<Record<FieldId, number>>, content: Content): string {
  return FIELDS.filter((f) => requires[f])
    .map((f) => `${content.fields[f].name} ${requires[f]}`)
    .join(', ');
}

/** Returns why the command is illegal, or null if it is legal. */
export function validateCommand(state: GameState, cmd: Command, content: Content): CommandError | null {
  const empire = state.empires[cmd.empire];
  if (!empire) return fail('unknownEmpire', `No empire ${cmd.empire}`);
  if (state.winner !== null) return fail('gameOver', 'The game is over');
  if (empire.eliminated) return fail('gameOver', 'This empire has been eliminated');

  switch (cmd.type) {
    case 'setAllocation': {
      const own = ownColony(state, cmd.empire, cmd.system);
      if (isError(own)) return own;
      const a = cmd.allocation;
      const valid =
        typeof a === 'object' &&
        a !== null &&
        Object.keys(a).length === OUTPUT_KINDS.length &&
        OUTPUT_KINDS.every((k) => Number.isInteger(a[k]) && a[k] >= 0);
      if (!valid) return fail('invalidAllocation', 'Allocation needs a whole number >= 0 for each output');
      const assigned = OUTPUT_KINDS.reduce((sum, k) => sum + a[k], 0);
      if (assigned > own.colony.population) {
        return fail('invalidAllocation', `Allocation uses ${assigned} workers but population is ${own.colony.population}`);
      }
      return null;
    }
    case 'adjustWorkers': {
      const own = ownColony(state, cmd.empire, cmd.system);
      if (isError(own)) return own;
      if (own.colony.governor === 'manual') {
        return fail('invalidAllocation', 'Hand adjustments sit on top of a governor; under Manual, set the workers directly');
      }
      const p = cmd.pinned;
      const valid =
        typeof p === 'object' &&
        p !== null &&
        Object.keys(p).length === OUTPUT_KINDS.length &&
        OUTPUT_KINDS.every((k) => Number.isInteger(p[k]) && p[k] >= 0);
      if (!valid) return fail('invalidAllocation', 'Adjustments need a whole number >= 0 for each output');
      const held = OUTPUT_KINDS.reduce((sum, k) => sum + p[k], 0);
      return held > own.colony.population
        ? fail('invalidAllocation', `That places ${held} workers by hand but population is ${own.colony.population}`)
        : null;
    }
    case 'capWorkers': {
      const own = ownColony(state, cmd.empire, cmd.system);
      if (isError(own)) return own;
      if (own.colony.governor === 'manual') {
        return fail('invalidAllocation', 'Limits apply to a governor; under Manual, set the workers directly');
      }
      const c = cmd.capped;
      const valid =
        typeof c === 'object' &&
        c !== null &&
        Object.keys(c).length === OUTPUT_KINDS.length &&
        OUTPUT_KINDS.every((k) => c[k] === null || (Number.isInteger(c[k]) && (c[k] as number) >= 0));
      return valid ? null : fail('invalidAllocation', 'Limits need a whole number >= 0, or none, for each output');
    }
    case 'placeWorkers': {
      const own = ownColony(state, cmd.empire, cmd.system);
      if (isError(own)) return own;
      if (own.colony.governor === 'manual') {
        return fail('invalidAllocation', 'Under Manual, set the workers directly');
      }
      if (!OUTPUT_KINDS.includes(cmd.output)) return fail('invalidAllocation', `No output ${String(cmd.output)}`);
      if (!Number.isInteger(cmd.workers) || cmd.workers < 0) return fail('invalidAllocation', 'Workers must be a whole number >= 0');
      const elsewhere = OUTPUT_KINDS.reduce((sum, k) => sum + (k === cmd.output ? 0 : own.colony.pinned[k]), 0);
      const free = own.colony.population - elsewhere;
      return cmd.workers > free
        ? fail('invalidAllocation', `Only ${free} workers are free: ${elsewhere} are placed by hand elsewhere`)
        : null;
    }
    case 'setGovernor': {
      const own = ownColony(state, cmd.empire, cmd.system);
      if (isError(own)) return own;
      return GOVERNORS.includes(cmd.governor) ? null : fail('unknownGovernor', `No governor ${String(cmd.governor)}`);
    }
    case 'enqueueBuild': {
      const own = ownColony(state, cmd.empire, cmd.system);
      if (isError(own)) return own;
      const def = content.buildings[cmd.building];
      if (!def) return fail('unknownBuilding', `No building ${cmd.building}`);
      if (def.faction !== null && def.faction !== empire.faction) {
        return fail('locked', `Only ${content.factions[def.faction].name} can build the ${def.name}`);
      }
      if (!meetsRequirements(empire.research, def.requires)) {
        return fail('locked', `${def.name} needs ${requirementText(def.requires, content)}`);
      }
      if (own.colony.buildQueue.length >= content.rules.maxQueueLength) {
        return fail('queueFull', `Build queue holds at most ${content.rules.maxQueueLength} items`);
      }
      const built = own.colony.buildings[cmd.building] ?? 0;
      const queued = own.colony.buildQueue.filter((i) => i.kind === 'building' && i.building === cmd.building).length;
      if (built + queued >= def.maxPerSystem) {
        return fail('buildLimit', `${own.system.name} can hold at most ${def.maxPerSystem} ${def.name}`);
      }
      return null;
    }
    case 'enqueueShip':
    case 'enqueueRefit': {
      const own = ownColony(state, cmd.empire, cmd.system);
      if (isError(own)) return own;
      const hull = content.hulls[cmd.hull];
      if (!hull) return fail('unknownHull', `No hull ${cmd.hull}`);
      const yard = content.rules.fleets.shipyardBuilding;
      if ((own.colony.buildings[yard] ?? 0) < 1) {
        return fail('noShipyard', `${own.system.name} needs a ${content.buildings[yard].name}`);
      }
      if (hull.faction !== null && hull.faction !== empire.faction) {
        return fail('locked', `Only ${content.factions[hull.faction].name} can build the ${hull.name}`);
      }
      if (!meetsRequirements(empire.research, hull.requires)) {
        return fail('locked', `${hull.name} needs ${requirementText(hull.requires, content)}`);
      }
      if (own.colony.buildQueue.length >= content.rules.maxQueueLength) {
        return fail('queueFull', `Build queue holds at most ${content.rules.maxQueueLength} items`);
      }
      const support = empireSupport(state, cmd.empire, content);
      if (cmd.type === 'enqueueShip') {
        if (support.used + hull.support > support.cap) {
          return fail('supportCap', `Fleet support is ${support.used} of ${support.cap}; ${hull.name} needs ${hull.support}`);
        }
        return null;
      }
      const fleet = fleetOfShip(state, cmd.ship);
      const ship = fleet?.ships.find((s) => s.id === cmd.ship);
      if (!fleet || !ship || fleet.owner !== cmd.empire || !sameSector(fleet.sector, own.system.sector)) {
        return fail('unknownShip', `That ship is not docked at ${own.system.name}`);
      }
      const current = content.hulls[ship.hull];
      if (!current || current.role !== hull.role || hull.tier <= current.tier) {
        return fail('badRefit', `A ship can only be refitted to a newer hull of the same role`);
      }
      if (own.colony.buildQueue.some((i) => i.kind === 'refit' && i.ship === cmd.ship)) {
        return fail('badRefit', 'That ship is already queued for a refit');
      }
      if (support.used - current.support + hull.support > support.cap) {
        return fail('supportCap', `Fleet support is ${support.used} of ${support.cap}`);
      }
      return null;
    }
    case 'dequeueBuild':
    case 'moveBuild': {
      const own = ownColony(state, cmd.empire, cmd.system);
      if (isError(own)) return own;
      const inQueue = (i: number) => Number.isInteger(i) && i >= 0 && i < own.colony.buildQueue.length;
      if (cmd.type === 'dequeueBuild') {
        return inQueue(cmd.index) ? null : fail('badIndex', `No build queue item at ${cmd.index}`);
      }
      return inQueue(cmd.from) && inQueue(cmd.to)
        ? null
        : fail('badIndex', `Cannot move build queue item ${cmd.from} to ${cmd.to}`);
    }
    case 'setResearchAllocation': {
      const a = cmd.allocation;
      const valid =
        typeof a === 'object' &&
        a !== null &&
        Object.keys(a).length === FIELDS.length &&
        FIELDS.every((f) => Number.isInteger(a[f]) && a[f] >= 0) &&
        FIELDS.reduce((sum, f) => sum + a[f], 0) === 100;
      return valid ? null : fail('invalidAllocation', 'Research allocation needs whole percents for each field that sum to 100');
    }
    case 'moveFleet': {
      const fleet = ownFleet(state, cmd.empire, cmd.fleet);
      if (isError(fleet)) return fleet;
      if (!cmd.to || !inBounds(state.galaxy, cmd.to)) return fail('outOfRange', 'That sector is off the map');
      return findPath(state, fleet, cmd.to, content) ? null : fail('outOfRange', 'That sector is outside supply range');
    }
    case 'stopFleet': {
      const fleet = ownFleet(state, cmd.empire, cmd.fleet);
      return isError(fleet) ? fleet : null;
    }
    case 'coloniseSystem': {
      const fleet = ownFleet(state, cmd.empire, cmd.fleet);
      if (isError(fleet)) return fleet;
      const system = state.systems[cmd.system];
      // An empire can only target systems it has scanned.
      if (!system || !(cmd.system in empire.knownSystems)) return fail('unknownSystem', `No known system ${cmd.system}`);
      // Judged on what the empire knows, so an order never reveals what fog hides:
      // a system settled out of sight still accepts the order, and it fails on arrival.
      const seen = visibleSectors(state, cmd.empire, content).has(sectorKey(system.sector));
      const occupied = seen ? system.colony !== null : empire.knownSystems[cmd.system] !== null;
      const blocker = coloniseBlocker(fleet, system, content, occupied);
      if (blocker) return fail('cannotColonise', blocker);
      if (!findPath(state, fleet, system.sector, content)) return fail('outOfRange', `${system.name} is outside supply range`);
      // Founding is its own step for every empire: the fleet travels there first. This is checked
      // last, so 'notThere' also says the system is one this fleet could settle on arrival.
      return sameSector(fleet.sector, system.sector) ? null : fail('notThere', `Move the fleet to ${system.name} first`);
    }
    case 'invadeSystem': {
      const fleet = ownFleet(state, cmd.empire, cmd.fleet);
      if (isError(fleet)) return fleet;
      const system = state.systems[cmd.system];
      if (!system || !(cmd.system in empire.knownSystems)) return fail('unknownSystem', `No known system ${cmd.system}`);
      // As with colonising, judged on what the empire knows.
      const seen = visibleSectors(state, cmd.empire, content).has(sectorKey(system.sector));
      const owner = seen ? (system.colony?.owner ?? null) : empire.knownSystems[cmd.system];
      const blocker = invadeBlocker(state, fleet, system, owner, content);
      if (blocker) return fail('cannotInvade', blocker);
      return findPath(state, fleet, system.sector, content)
        ? null
        : fail('outOfRange', `${system.name} is outside supply range`);
    }
    case 'setStance': {
      const fleet = ownFleet(state, cmd.empire, cmd.fleet);
      if (isError(fleet)) return fleet;
      return STANCES.includes(cmd.stance) ? null : fail('badStance', `No stance ${String(cmd.stance)}`);
    }
    case 'declareWar': {
      const other = state.empires[cmd.on];
      if (!other || cmd.on === cmd.empire) return fail('badWar', 'Choose another empire to declare war on');
      if (other.eliminated) return fail('badWar', 'That empire has been eliminated');
      if (atWar(state, cmd.empire, cmd.on)) return fail('badWar', 'You are already at war with that empire');
      return boundToPeace(state, cmd.empire, cmd.on) ? fail('badWar', 'A treaty forbids it; break the treaty first') : null;
    }
    case 'proposeTreaty': {
      if (!TREATY_TYPES.includes(cmd.treaty)) return fail('badTreaty', `No treaty ${String(cmd.treaty)}`);
      const blocker = treatyBlocker(state, cmd.empire, cmd.to, cmd.treaty, content);
      if (blocker) return fail('badTreaty', blocker);
      if (state.offers.some((o) => o.type === cmd.treaty && ((o.from === cmd.empire && o.to === cmd.to) || (o.from === cmd.to && o.to === cmd.empire)))) {
        return fail('badTreaty', 'That treaty has already been proposed');
      }
      return null;
    }
    case 'answerOffer': {
      const offer = state.offers.find((o) => o.id === cmd.offer);
      if (!offer || offer.to !== cmd.empire) return fail('badOffer', 'There is no such offer to answer');
      if (cmd.accept) {
        const blocker = treatyBlocker(state, offer.from, offer.to, offer.type, content);
        if (blocker) return fail('badOffer', blocker);
      }
      return null;
    }
    case 'buyOut': {
      const own = ownColony(state, cmd.empire, cmd.system);
      if (isError(own)) return own;
      const cost = buyOutCost(own.system, content);
      if (cost === null) return fail('notAllowed', 'There is nothing in the queue to buy');
      return cost > empire.credits ? fail('cannotAfford', `That costs ${cost} credits; you have ${empire.credits}`) : null;
    }
    case 'giftCredits': {
      const other = state.empires[cmd.to];
      if (!other || cmd.to === cmd.empire || other.eliminated) return fail('notAllowed', 'Choose another empire');
      if (!hasMet(state, cmd.empire, cmd.to)) return fail('notAllowed', 'You have not made contact with them yet');
      if (!Number.isInteger(cmd.amount) || cmd.amount <= 0) return fail('notAllowed', 'A gift must be a whole number of credits');
      return cmd.amount > empire.credits ? fail('cannotAfford', `That costs ${cmd.amount} credits; you have ${empire.credits}`) : null;
    }
    case 'buyMembership': {
      const faction = content.factions[empire.faction];
      if (!faction.traits.buysMinors) return fail('notAllowed', `${faction.name} cannot buy a people's loyalty`);
      const system = state.systems[cmd.system];
      if (!system || !(cmd.system in empire.knownSystems)) return fail('unknownSystem', `No known system ${cmd.system}`);
      if (!minorOf(system, content)) return fail('notAllowed', `No independent people live at ${system.name}`);
      if (state.pledges.some((p) => p.system === cmd.system)) return fail('notAllowed', `The people of ${system.name} have already agreed to join an empire`);
      const cost = membershipCost(state, system, cmd.empire, content);
      return cost > empire.credits ? fail('cannotAfford', `That costs ${cost} credits; you have ${empire.credits}`) : null;
    }
    case 'hireMercenaries': {
      const faction = content.factions[empire.faction];
      if (!faction.traits.hiresMercenaries) return fail('notAllowed', `${faction.name} does not hire mercenaries`);
      const own = ownColony(state, cmd.empire, cmd.system);
      if (isError(own)) return own;
      const hull = content.hulls[cmd.hull];
      if (!hull) return fail('unknownHull', `No hull ${cmd.hull}`);
      if (hull.role !== 'warship') return fail('notAllowed', 'Only warships can be hired');
      if (hull.faction !== null && hull.faction !== empire.faction) return fail('locked', `Only ${content.factions[hull.faction].name} can field the ${hull.name}`);
      if (!meetsRequirements(empire.research, hull.requires)) return fail('locked', `${hull.name} needs ${requirementText(hull.requires, content)}`);
      const yard = content.rules.fleets.shipyardBuilding;
      if ((own.colony.buildings[yard] ?? 0) < 1) return fail('noShipyard', `${own.system.name} needs a ${content.buildings[yard].name}`);
      const support = empireSupport(state, cmd.empire, content);
      if (support.used + hull.support > support.cap) return fail('supportCap', `Fleet support is ${support.used} of ${support.cap}; ${hull.name} needs ${hull.support}`);
      const cost = mercenaryCost(hull, content);
      return cost > empire.credits ? fail('cannotAfford', `That costs ${cost} credits; you have ${empire.credits}`) : null;
    }
    case 'setIntelSplit':
      return Number.isInteger(cmd.percent) && cmd.percent >= 0 && cmd.percent <= 100
        ? null
        : fail('badSplit', 'The counter-intel share must be a whole percent from 0 to 100');
    case 'runOperation': {
      const blocker = operationBlocker(state, { by: cmd.empire, target: cmd.target, kind: cmd.kind, system: cmd.system }, content);
      return blocker ? fail('cannotOperate', blocker) : null;
    }
    case 'breakTreaty':
      return state.empires[cmd.with] && hasTreaty(state, cmd.empire, cmd.with, cmd.treaty)
        ? null
        : fail('badTreaty', 'There is no such treaty to break');
    case 'courtMinor': {
      const system = state.systems[cmd.system];
      if (!system || !(cmd.system in empire.knownSystems)) return fail('unknownSystem', `No known system ${cmd.system}`);
      const def = minorOf(system, content);
      if (!def) return fail('cannotCourt', `No independent people live at ${system.name}`);
      const cost = content.rules.minors.influenceCost;
      if (!Number.isInteger(cmd.points) || cmd.points < cost) return fail('cannotCourt', `Courting takes at least ${cost} intel`);
      if (cmd.points > empire.intelPool) return fail('cannotCourt', `You have ${empire.intelPool} intel, not ${cmd.points}`);
      return null;
    }
    case 'mergeFleets': {
      const from = ownFleet(state, cmd.empire, cmd.from);
      if (isError(from)) return from;
      const into = ownFleet(state, cmd.empire, cmd.into);
      if (isError(into)) return into;
      if (cmd.from === cmd.into) return fail('badFleets', 'A fleet cannot merge with itself');
      return sameSector(from.sector, into.sector) ? null : fail('badFleets', 'Fleets must be in the same sector to merge');
    }
    case 'splitFleet': {
      const fleet = ownFleet(state, cmd.empire, cmd.fleet);
      if (isError(fleet)) return fleet;
      const ids = cmd.ships;
      const valid =
        Array.isArray(ids) &&
        ids.length > 0 &&
        ids.length < fleet.ships.length &&
        new Set(ids).size === ids.length &&
        ids.every((id) => fleet.ships.some((s) => s.id === id));
      return valid ? null : fail('badFleets', 'Choose some, but not all, of the ships in the fleet');
    }
  }
}

/**
 * Validates a command and applies it, returning the new state. The input state
 * is not modified. Setting an allocation by hand switches the colony to the
 * manual governor; after any other colony command an automated governor
 * reassigns workers straight away. Commands take effect immediately and only
 * change the issuing empire's own colonies, fleets and research, so empires can
 * act in any order within a turn. Fleets move when the turn resolves.
 */
export function submitCommand(state: GameState, cmd: Command, content: Content): Result<GameState, CommandError> {
  const error = validateCommand(state, cmd, content);
  if (error) return { ok: false, error };
  const next = structuredClone(state);
  applyValidated(next, cmd, content);
  return { ok: true, value: next };
}

/**
 * Applies several commands in order with a single copy of the state. Stops at
 * the first illegal command and reports its index; the input is not modified.
 */
export function submitCommands(
  state: GameState,
  commands: readonly Command[],
  content: Content,
): Result<GameState, CommandError & { index: number }> {
  const next = structuredClone(state);
  for (let index = 0; index < commands.length; index++) {
    const error = validateCommand(next, commands[index], content);
    if (error) return { ok: false, error: { ...error, index } };
    applyValidated(next, commands[index], content);
  }
  return { ok: true, value: next };
}

/**
 * Applies a command in place. Only for callers that own `next` (a private
 * copy) and have just checked the command with validateCommand.
 */
export function applyValidated(next: GameState, cmd: Command, content: Content): void {
  const colony = 'system' in cmd && cmd.type !== 'coloniseSystem' && cmd.type !== 'invadeSystem' && cmd.type !== 'courtMinor' && cmd.type !== 'runOperation' && 'system' in cmd ? next.systems[cmd.system].colony! : null;

  switch (cmd.type) {
    case 'setAllocation':
      for (const kind of OUTPUT_KINDS) colony!.allocation[kind] = cmd.allocation[kind];
      colony!.governor = 'manual';
      colony!.pinned = { food: 0, industry: 0, energy: 0, intel: 0, research: 0 };
      colony!.capped = { food: null, industry: null, energy: null, intel: null, research: null };
      break;
    case 'setGovernor':
      colony!.governor = cmd.governor;
      // Hand adjustments belong to a governor; under Manual the allocation itself is the player's.
      if (cmd.governor === 'manual') {
        colony!.pinned = { food: 0, industry: 0, energy: 0, intel: 0, research: 0 };
        colony!.capped = { food: null, industry: null, energy: null, intel: null, research: null };
      }
      break;
    case 'adjustWorkers':
      colony!.pinned = { food: cmd.pinned.food, industry: cmd.pinned.industry, energy: cmd.pinned.energy, intel: cmd.pinned.intel, research: cmd.pinned.research };
      break;
    case 'capWorkers':
      colony!.capped = { food: cmd.capped.food, industry: cmd.capped.industry, energy: cmd.capped.energy, intel: cmd.capped.intel, research: cmd.capped.research };
      break;
    case 'placeWorkers': {
      const system = next.systems[cmd.system];
      const governor = colony!.governor as AutoGovernor;
      // What the governor would do here with no adjustment to this output.
      colony!.pinned[cmd.output] = 0;
      colony!.capped[cmd.output] = null;
      const own = governorAllocation(next, system, content, governor)[cmd.output];
      if (cmd.workers < own) {
        colony!.capped[cmd.output] = cmd.workers;
      } else if (cmd.workers > own) {
        // Hand-placed workers leave the governor fewer to place, so it may put fewer here itself:
        // add by hand until the output has what was asked for.
        let pin = cmd.workers - own;
        colony!.pinned[cmd.output] = pin;
        while (pin < cmd.workers && governorAllocation(next, system, content, governor)[cmd.output] < cmd.workers) {
          colony!.pinned[cmd.output] = ++pin;
        }
      }
      break;
    }
    case 'enqueueBuild':
      colony!.buildQueue.push({ kind: 'building', building: cmd.building, progress: 0 });
      break;
    case 'enqueueShip':
      colony!.buildQueue.push({ kind: 'ship', hull: cmd.hull, progress: 0 });
      break;
    case 'enqueueRefit':
      colony!.buildQueue.push({ kind: 'refit', ship: cmd.ship, hull: cmd.hull, progress: 0 });
      break;
    case 'dequeueBuild':
      colony!.buildQueue.splice(cmd.index, 1);
      break;
    case 'moveBuild': {
      const [item] = colony!.buildQueue.splice(cmd.from, 1);
      colony!.buildQueue.splice(cmd.to, 0, item);
      break;
    }
    case 'setResearchAllocation':
      for (const field of FIELDS) next.empires[cmd.empire].research.allocation[field] = cmd.allocation[field];
      break;
    case 'moveFleet': {
      const fleet = next.fleets[cmd.fleet];
      fleet.destination = sameSector(fleet.sector, cmd.to) ? null : { x: cmd.to.x, y: cmd.to.y };
      fleet.order = 'none';
      break;
    }
    case 'stopFleet':
      next.fleets[cmd.fleet].destination = null;
      next.fleets[cmd.fleet].order = 'none';
      break;
    case 'coloniseSystem': {
      const fleet = next.fleets[cmd.fleet];
      fleet.destination = null;
      fleet.order = 'colonise';
      break;
    }
    case 'invadeSystem': {
      const fleet = next.fleets[cmd.fleet];
      const target = next.systems[cmd.system].sector;
      fleet.destination = sameSector(fleet.sector, target) ? null : { ...target };
      fleet.order = 'invade';
      break;
    }
    case 'setStance':
      next.fleets[cmd.fleet].stance = cmd.stance;
      break;
    case 'declareWar':
      next.wars[warKey(cmd.empire, cmd.on)] = next.turn;
      addEmpireMorale(next, cmd.empire, 'warDeclared', content);
      addOpinion(next, cmd.on, cmd.empire, 'warDeclared');
      next.pendingEvents.push({ type: 'warDeclared', by: cmd.empire, on: cmd.on });
      break;
    case 'proposeTreaty': {
      const offer = { id: `off-${String(next.nextId++).padStart(5, '0')}`, from: cmd.empire, to: cmd.to, type: cmd.treaty, turn: next.turn };
      next.offers.push(offer);
      next.pendingEvents.push({ type: 'offerMade', empires: [cmd.empire, cmd.to], offer });
      break;
    }
    case 'answerOffer': {
      const offer = next.offers.find((o) => o.id === cmd.offer)!;
      next.offers = next.offers.filter((o) => o.id !== cmd.offer);
      if (cmd.accept) signTreaty(next, offer.from, offer.to, offer.type, content);
      else next.pendingEvents.push({ type: 'offerRefused', empires: [offer.from, offer.to], offer, note: (cmd.note ?? '').slice(0, 200) });
      break;
    }
    case 'breakTreaty':
      breakTreaty(next, cmd.empire, cmd.with, cmd.treaty, content);
      break;
    case 'buyOut': {
      const system = next.systems[cmd.system];
      next.empires[cmd.empire].credits -= buyOutCost(system, content)!;
      // Paid in full: it completes when the turn resolves, whatever the colony's industry.
      const item = system.colony!.buildQueue[0];
      item.progress = itemCost(item, content)!;
      break;
    }
    case 'giftCredits':
      next.empires[cmd.empire].credits -= cmd.amount;
      next.empires[cmd.to].credits += cmd.amount;
      if (cmd.amount >= content.rules.credits.giftSize) addOpinion(next, cmd.to, cmd.empire, 'gift');
      break;
    case 'buyMembership': {
      const system = next.systems[cmd.system];
      next.empires[cmd.empire].credits -= membershipCost(next, system, cmd.empire, content);
      // They join when the turn resolves, so the buyer learns nothing new mid-turn.
      next.pledges.push({ system: cmd.system, empire: cmd.empire });
      break;
    }
    case 'hireMercenaries':
      next.empires[cmd.empire].credits -= mercenaryCost(content.hulls[cmd.hull], content);
      spawnShip(next, cmd.empire, next.systems[cmd.system].sector, cmd.hull, content);
      break;
    case 'setIntelSplit':
      next.empires[cmd.empire].intelSplit = cmd.percent;
      break;
    case 'runOperation':
      // Paid for now; it resolves, with its roll, when the turn does.
      next.empires[cmd.empire].intelPool -= content.rules.intel.operations[cmd.kind].cost;
      next.operations.push({ by: cmd.empire, target: cmd.target, kind: cmd.kind, system: cmd.system });
      break;
    case 'courtMinor': {
      const system = next.systems[cmd.system];
      const minor = system.minor!;
      const current = minor.attitude[cmd.empire] ?? content.rules.minors.startAttitude;
      minor.attitude[cmd.empire] = Math.min(100, current + courtGain(minorOf(system, content)!, cmd.points, content));
      next.empires[cmd.empire].intelPool -= cmd.points;
      break;
    }
    case 'mergeFleets':
      next.fleets[cmd.into].ships.push(...next.fleets[cmd.from].ships);
      delete next.fleets[cmd.from];
      break;
    case 'splitFleet': {
      const fleet = next.fleets[cmd.fleet];
      const leaving = fleet.ships.filter((s) => cmd.ships.includes(s.id));
      fleet.ships = fleet.ships.filter((s) => !cmd.ships.includes(s.id));
      const id = `flt-${String(next.nextId++).padStart(5, '0')}` as FleetId;
      next.fleets[id] = { id, owner: fleet.owner, sector: { ...fleet.sector }, ships: leaving, destination: null, order: 'none', stance: fleet.stance };
      break;
    }
  }
  if (colony) applyGovernor(next, next.systems[(cmd as { system: SystemId }).system], content);
}
