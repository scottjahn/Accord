import { FIELDS, POSTURES, type Json, type Posture } from '../sim';
import { createPlanner, type Agent } from './agent';
import { survey } from './maps';
import { setTargets } from './operational';
import { POSTURE_REVIEW_TURNS, choosePosture, scorePostures } from './strategic';
import { manageColonies } from './tactical/colonies';
import { directFleets } from './tactical/fleets';

/** What the standard AI carries from turn to turn. */
export interface StandardMemory {
  posture: Posture;
  /** The turn the posture was last reviewed. */
  postureTurn: number;
}

export function readMemory(memory: Json | null): StandardMemory | null {
  if (typeof memory !== 'object' || memory === null || Array.isArray(memory)) return null;
  const { posture, postureTurn } = memory;
  if (!POSTURES.includes(posture as Posture) || typeof postureTurn !== 'number') return null;
  return { posture: posture as Posture, postureTurn };
}

/**
 * The game's AI player, in three layers:
 * 1. strategic: every few turns, pick a posture (expand, develop or fortify);
 * 2. operational: every turn, turn the posture into targets (settlers, scouts,
 *    warships, research split);
 * 3. tactical: per colony choose what to build and who governs; per fleet
 *    choose where to go.
 *
 * It sees only its redacted state, acts only through commands, and is
 * deterministic: the same known state and memory give the same commands.
 */
export const standardAgent: Agent = (known, empireId, content, memory) => {
  const plan = createPlanner(known, content);
  const personality = content.ai.personalities[known.empires[empireId].faction];
  const picture = survey(plan.state, empireId, content);

  const previous = readMemory(memory);
  const review = !previous || known.turn - previous.postureTurn >= POSTURE_REVIEW_TURNS;
  const next: StandardMemory = review
    ? { posture: choosePosture(scorePostures(plan.state, empireId, content, picture, personality)), postureTurn: known.turn }
    : previous;

  const targets = setTargets(next.posture, picture, personality);
  const current = known.empires[empireId].research.allocation;
  if (FIELDS.some((f) => current[f] !== targets.research[f])) {
    plan.attempt({ type: 'setResearchAllocation', empire: empireId, allocation: targets.research });
  }

  manageColonies(plan, empireId, content, next.posture, targets);
  directFleets(plan, empireId, content, next.posture, picture);

  return { commands: plan.issued, memory: { posture: next.posture, postureTurn: next.postureTurn } };
};
