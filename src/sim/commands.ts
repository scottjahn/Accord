import type { Content } from './content';
import type { BuildingId, EmpireId, SystemId } from './ids';
import { applyGovernor } from './economy/governor';
import { GOVERNORS, OUTPUT_KINDS, type GameState, type Governor, type Outputs, type Result } from './types';

/**
 * Everything a player can do. The human UI, the AI and the headless runner all
 * act through these and nothing else.
 */
export type Command =
  | { type: 'setAllocation'; empire: EmpireId; system: SystemId; allocation: Outputs }
  | { type: 'setGovernor'; empire: EmpireId; system: SystemId; governor: Governor }
  | { type: 'enqueueBuild'; empire: EmpireId; system: SystemId; building: BuildingId }
  | { type: 'dequeueBuild'; empire: EmpireId; system: SystemId; index: number }
  | { type: 'moveBuild'; empire: EmpireId; system: SystemId; from: number; to: number };

export type CommandErrorCode =
  | 'unknownEmpire'
  | 'unknownSystem'
  | 'notOwner'
  | 'invalidAllocation'
  | 'unknownGovernor'
  | 'unknownBuilding'
  | 'buildLimit'
  | 'queueFull'
  | 'badIndex';

export interface CommandError {
  code: CommandErrorCode;
  message: string;
}

const fail = (code: CommandErrorCode, message: string): CommandError => ({ code, message });

/** Returns why the command is illegal, or null if it is legal. */
export function validateCommand(state: GameState, cmd: Command, content: Content): CommandError | null {
  if (!state.empires[cmd.empire]) return fail('unknownEmpire', `No empire ${cmd.empire}`);
  const system = state.systems[cmd.system];
  if (!system) return fail('unknownSystem', `No system ${cmd.system}`);
  const colony = system.colony;
  if (!colony || colony.owner !== cmd.empire) {
    return fail('notOwner', `${cmd.empire} does not own ${system.name}`);
  }

  const inQueue = (i: number) => Number.isInteger(i) && i >= 0 && i < colony.buildQueue.length;

  switch (cmd.type) {
    case 'setAllocation': {
      const a = cmd.allocation;
      const valid =
        typeof a === 'object' &&
        a !== null &&
        Object.keys(a).length === OUTPUT_KINDS.length &&
        OUTPUT_KINDS.every((k) => Number.isInteger(a[k]) && a[k] >= 0);
      if (!valid) return fail('invalidAllocation', 'Allocation needs a whole number >= 0 for each output');
      const assigned = OUTPUT_KINDS.reduce((sum, k) => sum + a[k], 0);
      if (assigned > colony.population) {
        return fail('invalidAllocation', `Allocation uses ${assigned} workers but population is ${colony.population}`);
      }
      return null;
    }
    case 'setGovernor':
      return GOVERNORS.includes(cmd.governor) ? null : fail('unknownGovernor', `No governor ${String(cmd.governor)}`);
    case 'enqueueBuild': {
      const def = content.buildings[cmd.building];
      if (!def) return fail('unknownBuilding', `No building ${cmd.building}`);
      if (colony.buildQueue.length >= content.rules.maxQueueLength) {
        return fail('queueFull', `Build queue holds at most ${content.rules.maxQueueLength} items`);
      }
      const built = colony.buildings[cmd.building] ?? 0;
      const queued = colony.buildQueue.filter((item) => item.building === cmd.building).length;
      if (built + queued >= def.maxPerSystem) {
        return fail('buildLimit', `${system.name} can hold at most ${def.maxPerSystem} ${def.name}`);
      }
      return null;
    }
    case 'dequeueBuild':
      return inQueue(cmd.index) ? null : fail('badIndex', `No build queue item at ${cmd.index}`);
    case 'moveBuild':
      return inQueue(cmd.from) && inQueue(cmd.to)
        ? null
        : fail('badIndex', `Cannot move build queue item ${cmd.from} to ${cmd.to}`);
  }
}

/**
 * Validates a command and applies it, returning the new state. The input state
 * is not modified. Setting an allocation by hand switches the colony to the
 * manual governor; after any other command an automated governor reassigns
 * workers straight away. Commands take effect immediately; they only ever change the
 * issuing empire's own colonies, so empires can act in any order within a turn.
 */
export function submitCommand(state: GameState, cmd: Command, content: Content): Result<GameState, CommandError> {
  const error = validateCommand(state, cmd, content);
  if (error) return { ok: false, error };

  const next = structuredClone(state);
  const colony = next.systems[cmd.system].colony!;

  switch (cmd.type) {
    case 'setAllocation':
      for (const kind of OUTPUT_KINDS) colony.allocation[kind] = cmd.allocation[kind];
      colony.governor = 'manual';
      break;
    case 'setGovernor':
      colony.governor = cmd.governor;
      break;
    case 'enqueueBuild':
      colony.buildQueue.push({ building: cmd.building, progress: 0 });
      break;
    case 'dequeueBuild':
      colony.buildQueue.splice(cmd.index, 1);
      break;
    case 'moveBuild': {
      const [item] = colony.buildQueue.splice(cmd.from, 1);
      colony.buildQueue.splice(cmd.to, 0, item);
      break;
    }
  }
  applyGovernor(next, next.systems[cmd.system], content);
  return { ok: true, value: next };
}
