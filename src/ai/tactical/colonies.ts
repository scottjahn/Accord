import {
  coloniesOf,
  computeColonyEconomy,
  forecastColony,
  sortedKeys,
  type BuildingDef,
  type ColonyEconomy,
  type ColonyForecast,
  type Content,
  type EmpireId,
  type Governor,
  type HullRole,
  type OutputKind,
  type Posture,
  type StarSystem,
} from '../../sim';
import type { Planner } from '../agent';
import { shipsWithRole } from '../maps';
import type { Targets } from '../operational';

/** A colony below this population concentrates on growing. */
const YOUNG_POPULATION = 6;

export function chooseGovernor(system: StarSystem, economy: ColonyEconomy, posture: Posture, hasYard: boolean): Governor {
  const colony = system.colony!;
  if (colony.population < YOUNG_POPULATION && colony.population < economy.maxPopulation) return 'growth';
  if (posture === 'develop' && colony.population * 10 >= economy.maxPopulation * 6) return 'research';
  if (hasYard) return 'industry';
  return 'balanced';
}

/**
 * How much a building is worth here, 0-100. Each effect is valued by how much
 * the colony needs that output right now, per industry point of cost; a
 * building the colony cannot power is marked down.
 */
export function scoreBuilding(
  def: BuildingDef,
  system: StarSystem,
  economy: ColonyEconomy,
  forecast: ColonyForecast,
  posture: Posture,
): number {
  const colony = system.colony!;
  const headroom = economy.outputs.energy.total - economy.energyUsed;
  const growing = colony.population < economy.maxPopulation;
  const short = Object.keys(forecast.offline).length > 0 || headroom < 3;
  const need: Record<OutputKind, number> = {
    food: !growing ? 0.1 : forecast.foodSurplus * 3 < colony.population ? 1.3 : 0.8,
    industry: 1.2,
    energy: short ? 3 : 0.3,
    research: posture === 'develop' ? 1.5 : 1,
    intel: 0.3,
  };
  let value = 0;
  for (const effect of def.effects) {
    const amount = effect.kind === 'flat' ? effect.value : (economy.outputs[effect.output].total * effect.value) / 100;
    value += amount * need[effect.output];
  }
  const score = 30 + Math.min(50, (600 * value) / def.cost);
  return def.energyUpkeep > headroom ? score * 0.4 : score;
}

/** Sets governors and keeps every colony's build queue busy with the most useful legal item. */
export function manageColonies(
  plan: Planner,
  empireId: EmpireId,
  content: Content,
  posture: Posture,
  targets: Targets,
): void {
  const yard = content.rules.fleets.shipyardBuilding;
  const want: Record<HullRole, number> = { colony: targets.settlers, scout: targets.scouts, warship: targets.warships, transport: targets.transports };
  const shipScore: Record<HullRole, number> = {
    colony: posture === 'expand' ? 90 : 65,
    scout: plan.state.turn < 40 ? 70 : 45,
    warship: posture === 'war' ? 84 : posture === 'fortify' ? 85 : 50,
    transport: 90,
  };
  const hullsByRole = (role: HullRole) =>
    sortedKeys(content.hulls)
      .filter((id) => content.hulls[id].role === role)
      .sort((a, b) => content.hulls[b].tier - content.hulls[a].tier);

  for (const { id } of coloniesOf(plan.state, empireId)) {
    const system = plan.state.systems[id];
    const colony = system.colony!;
    const hasYard = (colony.buildings[yard] ?? 0) > 0;
    const economy = computeColonyEconomy(plan.state, system, content);

    const governor = chooseGovernor(system, economy, posture, hasYard);
    if (colony.governor !== governor) plan.attempt({ type: 'setGovernor', empire: empireId, system: id, governor });
    if (plan.state.systems[id].colony!.buildQueue.length > 0) continue;

    const forecast = forecastColony(plan.state, system, content);
    const options: { score: number; build: () => boolean }[] = [];

    if (hasYard) {
      // Order matters only for equal scores: transports are listed before warships so they win ties.
      for (const role of ['colony', 'scout', 'transport', 'warship'] as const) {
        const short = want[role] - shipsWithRole(plan.state, empireId, content, role);
        if (short <= 0) continue;
        options.push({
          // The further behind target, the more urgent, so a shortfall cannot be put off forever.
          score: Math.min(95, shipScore[role] + (role === 'warship' || role === 'transport' ? 3 : 12) * (short - 1)),
          build: () => hullsByRole(role).some((hull) => plan.attempt({ type: 'enqueueShip', empire: empireId, system: id, hull })),
        });
      }
    } else {
      // One shipyard for every three colonies, in colonies big enough to use it.
      const colonies = coloniesOf(plan.state, empireId);
      const yards = colonies.filter((c) => (c.colony!.buildings[yard] ?? 0) > 0 || c.colony!.buildQueue.some((i) => i.kind === 'building' && i.building === yard)).length;
      if (colony.population >= YOUNG_POPULATION && yards * 3 < colonies.length) {
        options.push({ score: 60, build: () => plan.attempt({ type: 'enqueueBuild', empire: empireId, system: id, building: yard }) });
      }
    }

    for (const building of sortedKeys(content.buildings)) {
      if (building === yard) continue;
      options.push({
        score: scoreBuilding(content.buildings[building], system, economy, forecast, posture),
        build: () => plan.attempt({ type: 'enqueueBuild', empire: empireId, system: id, building }),
      });
    }

    // Stable sort keeps building-id order among equal scores, so the choice is deterministic.
    options.sort((a, b) => b.score - a.score);
    options.some((option) => option.build());
  }
}
