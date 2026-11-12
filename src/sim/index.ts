/**
 * Public API of the simulation core. Clients (UI, AI, headless runner) import
 * from here and nowhere else inside sim/.
 */
import type { Content } from './content';
import { computeColonyEconomy, type ColonyEconomy } from './economy/outputs';
import type { SystemId } from './ids';
import type { GameState, OutputBreakdown, OutputKind } from './types';

export * from './ids';
export * from './types';
export type { RngState } from './rng';
export * from './content';
export * from './commands';
export { createGame, sectorDistance } from './galaxy/generate';
export { computeColonyEconomy, maxPopulationOf, totalOf, type ColonyEconomy } from './economy/outputs';
export { growthCost } from './economy/growth';
export { governorAllocation } from './economy/governor';
export { forecastColony, type ColonyForecast } from './economy/forecast';
export { processTurn } from './turn/processTurn';
export * from './save';
export { checkInvariants } from './invariants';

/** Outputs, power and food needs of a colonised system. */
export function getColonyEconomy(state: GameState, systemId: SystemId, content: Content): ColonyEconomy {
  const system = state.systems[systemId];
  if (!system) throw new Error(`getColonyEconomy: no system ${systemId}`);
  return computeColonyEconomy(state, system, content);
}

/** The five outputs of a colonised system, each with the causes behind its total. */
export function getOutputs(state: GameState, systemId: SystemId, content: Content): Record<OutputKind, OutputBreakdown> {
  return getColonyEconomy(state, systemId, content).outputs;
}
