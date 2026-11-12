import { FIELDS, POSTURES, treatiesBetween, type Json, type Posture } from '../sim';
import { createPlanner, type Agent } from './agent';
import { answerOffers, attackable, guardAccord, proposeTreaties } from './diplomacy';
import { runEspionage } from './intel';
import { survey } from './maps';
import { setTargets } from './operational';
import { POSTURE_REVIEW_TURNS, choosePosture, scorePostures } from './strategic';
import { manageColonies } from './tactical/colonies';
import { directFleets } from './tactical/fleets';
import { conquerMinors, conquestTargets, courtMinors } from './tactical/minors';
import { enemiesOf, knownColoniesOf, wageWar } from './tactical/war';

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
 * 1. strategic: every few turns, pick a posture (expand, develop, fortify or war);
 * 2. operational: every turn, turn the posture into targets (settlers, scouts,
 *    warships, research split);
 * 3. tactical: per colony choose what to build and who governs; per fleet
 *    choose where to go; and court or conquer the minor races it has found.
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
  // First see how tempting war is against everyone; treaty partners then count only if honour gives way.
  const open = scorePostures(plan.state, empireId, content, picture, personality);
  const foes = attackable(plan.state, empireId, personality, open.war - Math.max(open.develop, open.expand));
  const next: StandardMemory = review
    ? { posture: choosePosture(scorePostures(plan.state, empireId, content, picture, personality, foes)), postureTurn: known.turn }
    : previous;

  // An empire for which war looks at least as good as peace keeps its hands free.
  const ambitious = open.war > 0 && open.war >= Math.max(open.develop, open.expand);
  guardAccord(plan, empireId, content);
  answerOffers(plan, empireId, content, next.posture, ambitious);
  if (review) proposeTreaties(plan, empireId, content, next.posture, ambitious);

  const targets = setTargets(next.posture, picture, personality, conquestTargets(picture, empireId, content, personality).length);
  const current = known.empires[empireId].research.allocation;
  if (FIELDS.some((f) => current[f] !== targets.research[f])) {
    plan.attempt({ type: 'setResearchAllocation', empire: empireId, allocation: targets.research });
  }

  // Going to war means declaring it on whoever owns the nearest rival colony.
  if (next.posture === 'war' && enemiesOf(plan.state, empireId).length === 0) {
    const nearest = knownColoniesOf(plan.state, empireId, foes)[0];
    const owner = nearest ? plan.state.empires[empireId].knownSystems[nearest.id] : null;
    if (owner) {
      // A treaty in the way has to be broken first, and that has its price.
      for (const treaty of treatiesBetween(plan.state, empireId, owner)) {
        plan.attempt({ type: 'breakTreaty', empire: empireId, with: owner, treaty: treaty.type });
      }
      plan.attempt({ type: 'declareWar', empire: empireId, on: owner });
    }
  }

  manageColonies(plan, empireId, content, next.posture, targets);
  directFleets(plan, empireId, content, next.posture, picture);
  if (next.posture === 'war') wageWar(plan, empireId, content, targets.strikeSize);
  else conquerMinors(plan, empireId, content, personality, picture);
  runEspionage(plan, empireId, content, personality);
  courtMinors(plan, empireId, content, personality, picture);

  return { commands: plan.issued, memory: { posture: next.posture, postureTurn: next.postureTurn } };
};
