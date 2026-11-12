import type { Content, Requirements } from './content';
import { computeColonyEconomy } from './economy/outputs';
import { sortedKeys, type EmpireId } from './ids';
import {
  FIELDS,
  MAX_RESEARCH_LEVEL,
  type Empire,
  type FieldId,
  type GameState,
  type ResearchState,
  type TurnEvent,
} from './types';

const perField = (value: number): Record<FieldId, number> =>
  Object.fromEntries(FIELDS.map((f) => [f, value])) as Record<FieldId, number>;

/** An even split across the fields that sums to exactly 100. */
export function evenAllocation(): Record<FieldId, number> {
  const base = Math.floor(100 / FIELDS.length);
  const allocation = perField(base);
  let left = 100 - base * FIELDS.length;
  for (const field of FIELDS) {
    if (left-- <= 0) break;
    allocation[field] += 1;
  }
  return allocation;
}

export function newResearchState(): ResearchState {
  return { levels: perField(0), progress: perField(0), allocation: evenAllocation() };
}

/** Research needed to go from `level` to the next, or null at the maximum. */
export function levelCost(level: number, content: Content): number | null {
  return level >= MAX_RESEARCH_LEVEL ? null : content.research.levelCosts[level];
}

export function meetsRequirements(research: ResearchState, requires: Requirements): boolean {
  return FIELDS.every((field) => research.levels[field] >= (requires[field] ?? 0));
}

/** Era 1 upward, from the total of all field levels. */
export function eraOf(research: ResearchState, content: Content): number {
  const total = FIELDS.reduce((sum, f) => sum + research.levels[f], 0);
  let era = 1;
  content.research.eraThresholds.forEach((needed, i) => {
    if (total >= needed) era = i + 1;
  });
  return era;
}

/**
 * Splits research points across fields by allocation. Fields at the maximum
 * level take nothing. Points left over after rounding down go one each to the
 * fields that lost the most to rounding, so a small income still spreads out.
 */
export function distributeResearch(research: ResearchState, points: number): Record<FieldId, number> {
  const shares = perField(0);
  const open = FIELDS.filter((f) => research.levels[f] < MAX_RESEARCH_LEVEL && research.allocation[f] > 0);
  const weight = open.reduce((sum, f) => sum + research.allocation[f], 0);
  if (points <= 0 || weight === 0) return shares;

  let assigned = 0;
  for (const field of open) {
    shares[field] = Math.floor((points * research.allocation[field]) / weight);
    assigned += shares[field];
  }
  // Largest remainder first (ties in field order), one point each.
  const byRemainder = [...open].sort(
    (a, b) => ((points * research.allocation[b]) % weight) - ((points * research.allocation[a]) % weight),
  );
  for (let i = 0; assigned < points; i++, assigned++) shares[byRemainder[i]] += 1;
  return shares;
}

/** Banks this turn's research and levels fields up. Mutates the empire. */
export function applyResearch(empire: Empire, points: number, content: Content, events: TurnEvent[]): void {
  const research = empire.research;
  const shares = distributeResearch(research, points);
  for (const field of FIELDS) {
    research.progress[field] += shares[field];
    for (;;) {
      const cost = levelCost(research.levels[field], content);
      if (cost === null) {
        research.progress[field] = 0;
        break;
      }
      if (research.progress[field] < cost) break;
      research.progress[field] -= cost;
      research.levels[field] += 1;
      events.push({ type: 'researchCompleted', empire: empire.id, field, level: research.levels[field] });
    }
  }
}

/** Research produced by all of an empire's colonies this turn. */
export function researchIncome(state: GameState, empireId: EmpireId, content: Content): number {
  let total = 0;
  for (const id of sortedKeys(state.systems)) {
    const system = state.systems[id];
    if (system.colony?.owner === empireId) total += computeColonyEconomy(state, system, content).outputs.research.total;
  }
  return total;
}

export interface FieldForecast {
  level: number;
  progress: number;
  /** Research needed for the next level; null at the maximum. */
  cost: number | null;
  perTurn: number;
  /** Turns to the next level at the current income; null if maxed or stalled. */
  turnsLeft: number | null;
}

export function forecastResearch(state: GameState, empireId: EmpireId, content: Content): Record<FieldId, FieldForecast> {
  const research = state.empires[empireId].research;
  const shares = distributeResearch(research, researchIncome(state, empireId, content));
  const out = {} as Record<FieldId, FieldForecast>;
  for (const field of FIELDS) {
    const cost = levelCost(research.levels[field], content);
    const perTurn = shares[field];
    out[field] = {
      level: research.levels[field],
      progress: research.progress[field],
      cost,
      perTurn,
      turnsLeft:
        cost === null || perTurn <= 0 ? null : Math.max(1, Math.ceil((cost - research.progress[field]) / perTurn)),
    };
  }
  return out;
}
