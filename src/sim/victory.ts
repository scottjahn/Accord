import type { Content } from './content';
import { totalOf } from './economy/outputs';
import { coloniesOf } from './fleets';
import { sortedKeys, type EmpireId } from './ids';
import { FIELDS, type BreakdownLine, type GameState, type OutputBreakdown } from './types';

const standingOf = (state: GameState): EmpireId[] => sortedKeys(state.empires).filter((id) => !state.empires[id].eliminated);

/** Sum of an empire's levels in every research field. */
export function researchTotal(state: GameState, empireId: EmpireId): number {
  return FIELDS.reduce((sum, f) => sum + state.empires[empireId].research.levels[f], 0);
}

/**
 * An empire's score, one line per cause: its people, colonies, learning,
 * member races and treasury. It decides the game if nobody has won by the
 * last turn, and breaks ties between empires that win on the same turn.
 */
export function empireScore(state: GameState, empireId: EmpireId, content: Content): OutputBreakdown {
  const rules = content.rules.victory.score;
  const empire = state.empires[empireId];
  const colonies = coloniesOf(state, empireId);
  const people = colonies.reduce((sum, s) => sum + s.colony!.population, 0);
  const levels = researchTotal(state, empireId);
  const members = empire.members.filter((m) => m !== content.rules.morale.rebelRace).length;
  const lines: BreakdownLine[] = [];
  const add = (source: string, value: number) => {
    if (value > 0) lines.push({ source, kind: 'flat', value });
  };
  add(`${people} people`, people * rules.perPopulation);
  add(`${colonies.length} ${colonies.length === 1 ? 'colony' : 'colonies'}`, colonies.length * rules.perColony);
  add(`${levels} research levels`, levels * rules.perResearchLevel);
  add(`${members} member ${members === 1 ? 'race' : 'races'}`, members * rules.perMember);
  if (rules.creditsPerPoint > 0) add(`${empire.credits} credits`, Math.floor(empire.credits / rules.creditsPerPoint));
  return { total: totalOf(lines), lines };
}

/** The one with the highest score among these, or null if the best score is shared. */
function bestByScore(state: GameState, ids: EmpireId[], content: Content): EmpireId | null {
  const scores = ids.map((id) => empireScore(state, id, content).total);
  const best = Math.max(...scores);
  const leaders = ids.filter((_, i) => scores[i] === best);
  return leaders.length === 1 ? leaders[0] : null;
}

/** The research victory: the first empire whose field levels add up to the set total. 0 turns it off. */
export function researchWinner(state: GameState, content: Content): EmpireId | null {
  const needed = content.rules.victory.researchLevels;
  if (needed === 0) return null;
  const done = standingOf(state).filter((id) => researchTotal(state, id) >= needed);
  return done.length === 0 ? null : bestByScore(state, done, content);
}

/** The wealth victory: a treasury of the set size; if several have one, the richest. 0 turns it off. */
export function wealthWinner(state: GameState, content: Content): EmpireId | null {
  const needed = content.rules.victory.wealthCredits;
  if (needed === 0) return null;
  const rich = standingOf(state).filter((id) => state.empires[id].credits >= needed);
  if (rich.length === 0) return null;
  const most = Math.max(...rich.map((id) => state.empires[id].credits));
  const richest = rich.filter((id) => state.empires[id].credits === most);
  return richest.length === 1 ? richest[0] : bestByScore(state, richest, content);
}

/**
 * The safety net: once the set turn has been played, the highest score wins,
 * so no game runs for ever. A tie goes to the earlier seat. 0 turns it off.
 */
export function scoreWinner(state: GameState, content: Content): EmpireId | null {
  const last = content.rules.victory.scoreTurn;
  if (last === 0 || state.turn < last) return null;
  const standing = standingOf(state);
  if (standing.length === 0) return null;
  return bestByScore(state, standing, content) ?? standing.reduce((best, id) => (empireScore(state, id, content).total > empireScore(state, best, content).total ? id : best));
}

/** One way to win, and how far along it this empire is. */
export interface VictoryPath {
  kind: 'research' | 'wealth' | 'domination' | 'score';
  label: string;
  have: number;
  need: number;
  /** The rule in a sentence. */
  note: string;
}

/**
 * The ways to win that are switched on, with this empire's own progress on
 * each. It uses nothing about rivals that fog would hide: domination counts
 * only the rival homes this empire holds.
 */
export function victoryPaths(state: GameState, empireId: EmpireId, content: Content): VictoryPath[] {
  const rules = content.rules.victory;
  const paths: VictoryPath[] = [];
  if (rules.researchLevels > 0) {
    paths.push({
      kind: 'research',
      label: 'Research',
      have: researchTotal(state, empireId),
      need: rules.researchLevels,
      note: `Reach ${rules.researchLevels} research levels in all, across every field.`,
    });
  }
  if (rules.wealthCredits > 0) {
    paths.push({
      kind: 'wealth',
      label: 'Wealth',
      have: state.empires[empireId].credits,
      need: rules.wealthCredits,
      note: `Hold ${rules.wealthCredits} credits in the treasury.`,
    });
  }
  const empires = sortedKeys(state.empires);
  const share = dominationShareOf(empires.length, content);
  if (share > 0 && empires.length > 1) {
    const homes = Math.ceil(((empires.length - 1) * content.rules.combat.dominationHomesPercent) / 100);
    paths.push({
      kind: 'domination',
      label: 'Domination',
      have: empires.filter((id) => id !== empireId && state.systems[state.empires[id].homeSystem]?.colony?.owner === empireId).length,
      need: homes,
      note: `Hold ${homes} rival home ${homes === 1 ? 'system' : 'systems'} and ${share}% of all colonies.`,
    });
  }
  if (rules.scoreTurn > 0) {
    paths.push({
      kind: 'score',
      label: 'Score',
      have: empireScore(state, empireId, content).total,
      need: 0,
      note: `If nobody has won after turn ${rules.scoreTurn}, the highest score wins.`,
    });
  }
  return paths;
}

/**
 * Percent of all colonies an empire must hold to dominate. The rule number is
 * for a duel; with more empires the bar drops in proportion, since nobody
 * needs two thirds of a galaxy shared five ways to have plainly won it.
 */
export function dominationShareOf(empires: number, content: Content): number {
  const duel = content.rules.combat.dominationPercent;
  return empires <= 2 ? duel : Math.ceil((duel * 2) / empires);
}
