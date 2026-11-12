import type { Content } from './content';
import { sameSector } from './geometry';
import { sortedKeys, type EmpireId } from './ids';
import { MORALE_EVENTS, type Colony, type GameState, type MoraleEventKind, type OutputBreakdown, type StarSystem } from './types';

export { MORALE_EVENTS };

/** How much an event moves this faction's morale and for how long. Factions can override the value. */
export function moraleEvent(
  kind: MoraleEventKind,
  state: GameState,
  empireId: EmpireId,
  content: Content,
): { value: number; turns: number; label: string } {
  const base = content.rules.morale.events[kind];
  const override = content.factions[state.empires[empireId].faction]?.morale.events[kind];
  return { value: override ?? base.value, turns: base.turns, label: base.label };
}

/**
 * Applies a morale event to one colony. An event of the same kind already in
 * force is replaced, not stacked, so a long war cannot pile up without limit.
 * Mutates the colony.
 */
export function addColonyMorale(state: GameState, system: StarSystem, kind: MoraleEventKind, content: Content): void {
  const colony = system.colony;
  if (!colony) return;
  const { value, turns } = moraleEvent(kind, state, colony.owner, content);
  colony.moraleEffects = colony.moraleEffects.filter((e) => e.source !== kind);
  if (value !== 0) colony.moraleEffects.push({ source: kind, value, turnsLeft: turns });
  colony.morale = moraleBreakdown(state, system, content).total;
}

/** Applies a morale event to every colony of an empire. */
export function addEmpireMorale(state: GameState, empireId: EmpireId, kind: MoraleEventKind, content: Content): void {
  for (const id of sortedKeys(state.systems)) {
    if (state.systems[id].colony?.owner === empireId) addColonyMorale(state, state.systems[id], kind, content);
  }
}

/**
 * A colony's morale and everything behind it: 100, plus timed events, plus
 * standing causes (a warship on guard, morale buildings, member races, and for
 * some powers a long peace). The total is held within the allowed swing.
 */
export function moraleBreakdown(state: GameState, system: StarSystem, content: Content): OutputBreakdown {
  const colony = system.colony;
  if (!colony) throw new Error(`moraleBreakdown: ${system.id} has no colony`);
  const rules = content.rules.morale;
  const empire = state.empires[colony.owner];
  const lines: OutputBreakdown['lines'] = [{ source: 'Base', kind: 'base', value: 100 }];

  for (const effect of colony.moraleEffects) {
    const label = rules.events[effect.source]?.label ?? effect.source;
    lines.push({ source: effect.turnsLeft === null ? label : `${label} (${effect.turnsLeft} turns left)`, kind: 'flat', value: effect.value });
  }

  if (rules.guard !== 0) {
    const guarded = sortedKeys(state.fleets).some((id) => {
      const fleet = state.fleets[id];
      return fleet.owner === colony.owner && sameSector(fleet.sector, system.sector) && fleet.ships.some((s) => (content.hulls[s.hull]?.attack ?? 0) > 0);
    });
    if (guarded) lines.push({ source: 'Warship on guard', kind: 'flat', value: rules.guard });
  }

  for (const id of sortedKeys(colony.buildings)) {
    const def = content.buildings[id];
    if (def && def.morale !== 0 && colony.buildings[id] > 0) {
      lines.push({ source: `${def.name} x${colony.buildings[id]}`, kind: 'flat', value: def.morale * colony.buildings[id] });
    }
  }

  for (const member of empire?.members ?? []) {
    const def = content.minors[member];
    if (def?.bonus.kind === 'morale') lines.push({ source: `${def.name} membership`, kind: 'flat', value: def.bonus.value });
  }

  const perTen = content.factions[empire?.faction]?.morale.peacePerTenTurns ?? 0;
  if (empire && perTen !== 0) {
    const decades = Math.floor((state.turn - empire.lastWarTurn) / 10);
    const value = Math.max(-rules.maxPeacePenalty, Math.min(rules.maxPeacePenalty, decades * perTen));
    if (value !== 0) lines.push({ source: 'Long peace', kind: 'flat', value });
  }

  const sum = lines.reduce((n, line) => n + line.value, 0);
  const total = Math.max(100 - rules.maxSwing, Math.min(100 + rules.maxSwing, sum));
  return { total, lines };
}

/** A colony in unrest does not grow. */
export function inUnrest(colony: Colony, content: Content): boolean {
  return colony.morale < content.rules.morale.unrestBelow;
}

/** Recomputes every colony's stored morale from its causes. Mutates the state. */
export function refreshMorale(state: GameState, content: Content): void {
  for (const id of sortedKeys(state.systems)) {
    const system = state.systems[id];
    if (system.colony) system.colony.morale = moraleBreakdown(state, system, content).total;
  }
}

/** Ages timed morale events by a turn and drops the ones that have run out. Mutates the state. */
export function decayMorale(state: GameState): void {
  for (const id of sortedKeys(state.systems)) {
    const colony = state.systems[id].colony;
    if (!colony) continue;
    for (const effect of colony.moraleEffects) {
      if (effect.turnsLeft !== null) effect.turnsLeft -= 1;
    }
    colony.moraleEffects = colony.moraleEffects.filter((e) => e.turnsLeft === null || e.turnsLeft > 0);
  }
}
