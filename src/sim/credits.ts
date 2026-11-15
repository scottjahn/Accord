import type { Content, HullDef } from './content';
import { itemCost } from './economy/build';
import { computeColonyEconomy } from './economy/outputs';
import { coloniesOf } from './fleets';
import { sortedKeys, type EmpireId } from './ids';
import type { BreakdownLine, GameState, OutputBreakdown, StarSystem } from './types';

const total = (lines: BreakdownLine[]): number => {
  let sum = 0;
  let percent = 0;
  for (const line of lines) {
    if (line.kind === 'percent') percent += line.value;
    else sum += line.value;
  }
  return Math.max(0, Math.floor((sum * (100 + percent)) / 100));
};

/**
 * An empire's credit income for a turn, with every cause: a tax on its people,
 * buildings that earn credits, treaties that carry trade, and industry with
 * nothing to build, which is sold off instead of being wasted. Some powers
 * earn a percentage more.
 *
 * `idleIndustry` is the industry left unspent this turn. Leave it out for a
 * forecast: colonies with an empty build queue are then counted in full.
 */
export function creditIncome(state: GameState, empireId: EmpireId, content: Content, idleIndustry?: number): OutputBreakdown {
  const rules = content.rules.credits;
  const colonies = coloniesOf(state, empireId);
  const lines: BreakdownLine[] = [];

  const people = colonies.reduce((sum, s) => sum + s.colony!.population, 0);
  const tax = Math.floor((people * rules.perPopulationPercent) / 100);
  if (tax > 0) lines.push({ source: `Tax on ${people} people`, kind: 'base', value: tax });

  const earning = new Map<string, { count: number; credits: number }>();
  for (const system of colonies) {
    for (const id of sortedKeys(system.colony!.buildings)) {
      const def = content.buildings[id];
      const count = system.colony!.buildings[id];
      if (!def || def.credits === 0 || count <= 0) continue;
      const entry = earning.get(def.name) ?? { count: 0, credits: 0 };
      earning.set(def.name, { count: entry.count + count, credits: entry.credits + def.credits * count });
    }
  }
  for (const name of [...earning.keys()].sort()) {
    lines.push({ source: `${name} x${earning.get(name)!.count}`, kind: 'flat', value: earning.get(name)!.credits });
  }

  const trading = state.treaties.filter((t) => t.parties.includes(empireId) && t.type !== 'peace' && t.type !== 'nonAggression').length;
  if (trading > 0 && rules.perTreaty > 0) {
    lines.push({ source: `Trade under ${trading} ${trading === 1 ? 'treaty' : 'treaties'}`, kind: 'flat', value: trading * rules.perTreaty });
  }

  const idle =
    idleIndustry ??
    colonies
      .filter((s) => s.colony!.buildQueue.length === 0)
      .reduce((sum, s) => sum + computeColonyEconomy(state, s, content).outputs.industry.total, 0);
  const sold = Math.floor((idle * rules.idleIndustryPercent) / 100);
  if (sold > 0) lines.push({ source: 'Industry with nothing to build', kind: 'flat', value: sold });

  const faction = content.factions[state.empires[empireId]?.faction];
  if (faction && faction.traits.creditsPercent !== 0) {
    lines.push({ source: `${faction.name} commerce`, kind: 'percent', value: faction.traits.creditsPercent });
  }
  return { total: total(lines), lines };
}

/** Credits to finish the item at the front of a colony's build queue now, or null if there is nothing to buy. */
export function buyOutCost(system: StarSystem, content: Content): number | null {
  const item = system.colony?.buildQueue[0];
  if (!item) return null;
  const cost = itemCost(item, content);
  if (cost === null || item.progress >= cost) return null;
  return (cost - item.progress) * content.rules.credits.buyOutPerPoint;
}

/** Credits for a minor race's membership outright: dearer the less they like the buyer. */
export function membershipCost(state: GameState, system: StarSystem, empireId: EmpireId, content: Content): number {
  const attitude = system.minor?.attitude[empireId] ?? content.rules.minors.startAttitude;
  return Math.floor((content.rules.credits.membershipCost * (150 - attitude)) / 100);
}

/** Credits to hire a ship of this hull on the spot. */
export function mercenaryCost(hull: HullDef, content: Content): number {
  return Math.ceil((hull.cost * content.rules.credits.mercenaryCostPercent) / 100);
}
