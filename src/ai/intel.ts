import { opinionBreakdown, sortedKeys, type Content, type EmpireId, type OperationKind, type Personality } from '../sim';
import type { Planner } from './agent';
import { enemiesOf, knownColoniesOf } from './tactical/war';

/**
 * Sets the counter-intel share the personality calls for, then spends its
 * espionage budget on one operation against the rival it likes least: at war,
 * unrest or sabotage in the nearest enemy colony; in peace, stolen research,
 * or surveillance if that is all it can afford. A rival it has no quarrel with
 * is left alone.
 */
export function runEspionage(plan: Planner, empireId: EmpireId, content: Content, personality: Personality): void {
  const me = plan.state.empires[empireId];
  if (me.intelSplit !== personality.counterIntel) {
    plan.attempt({ type: 'setIntelSplit', empire: empireId, percent: personality.counterIntel });
  }
  const budget = Math.floor((plan.state.empires[empireId].intelPool * personality.espionage) / 100);
  if (budget <= 0) return;

  const enemies = enemiesOf(plan.state, empireId);
  const target =
    enemies[0] ??
    sortedKeys(plan.state.empires)
      .filter((id) => id !== empireId && !plan.state.empires[id].eliminated)
      .map((id) => ({ id, opinion: opinionBreakdown(plan.state, empireId, id, content).total }))
      .filter((r) => r.opinion < 0)
      .sort((a, b) => a.opinion - b.opinion || (a.id < b.id ? -1 : 1))[0]?.id;
  if (!target) return;

  const cost = (kind: OperationKind) => content.rules.intel.operations[kind].cost;
  const colony = knownColoniesOf(plan.state, empireId, [target])[0];
  const wanted: OperationKind[] = enemies.length > 0 ? ['inciteUnrest', 'sabotage', 'gatherIntel'] : ['stealResearch', 'gatherIntel'];
  for (const kind of wanted) {
    if (cost(kind) > budget) continue;
    const system = kind === 'sabotage' || kind === 'inciteUnrest' ? (colony?.id ?? null) : null;
    if (plan.attempt({ type: 'runOperation', empire: empireId, target, kind, system })) return;
  }
}
