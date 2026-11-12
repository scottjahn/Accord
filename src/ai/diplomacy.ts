import {
  boundToPeace,
  coloniesOf,
  fleetsOf,
  hasTreaty,
  opinionBreakdown,
  sortedKeys,
  treatiesBetween,
  treatyBlocker,
  type Content,
  type EmpireId,
  type GameState,
  type Personality,
  type Posture,
  type TreatyType,
} from '../sim';
import type { Planner } from './agent';
import { enemiesOf, fleetPower } from './tactical/war';

/** Opinion a proposer needs for each treaty to be accepted in ordinary times. */
const NEEDED: Record<Exclude<TreatyType, 'peace'>, number> = {
  nonAggression: -10,
  openBorders: 0,
  researchPact: 5,
  alliance: 35,
};

const averageMorale = (known: GameState, empireId: EmpireId): number => {
  const colonies = coloniesOf(known, empireId);
  return colonies.length === 0 ? 100 : Math.floor(colonies.reduce((sum, s) => sum + s.colony!.morale, 0) / colonies.length);
};

/** How many colonies of a rival this empire knows of. */
function coloniesKnown(known: GameState, empireId: EmpireId, rival: EmpireId): number {
  return Object.values(known.empires[empireId].knownSystems).filter((owner) => owner === rival).length;
}

/** True if the rival is so much the greater (half as many colonies again, as far as is known) that this empire accepts its lead. */
export function concedesTo(known: GameState, empireId: EmpireId, rival: EmpireId): boolean {
  return coloniesKnown(known, empireId, rival) * 2 >= coloniesOf(known, empireId).length * 3;
}

/**
 * Leaves an alliance whose other party is one minor race away from leading the
 * Accord, unless this empire concedes to it. Better a broken word than a lost game.
 */
export function guardAccord(plan: Planner, empireId: EmpireId, content: Content): void {
  const known = plan.state;
  if (known.minorsPlaced === 0) return;
  for (const ally of sortedKeys(known.empires)) {
    if (ally === empireId || !hasTreaty(known, empireId, ally, 'alliance')) continue;
    const theirs = known.empires[ally].members.length;
    const close = (theirs + 1) * 100 >= known.minorsPlaced * content.rules.diplomacy.accordMemberPercent;
    if (close && theirs >= known.empires[empireId].members.length && !concedesTo(known, empireId, ally)) {
      plan.attempt({ type: 'breakTreaty', empire: empireId, with: ally, treaty: 'alliance' });
    }
  }
}

/** True if this empire would rather stop fighting: its people are weary, or the enemy it can see outguns it. */
export function wantsPeace(known: GameState, empireId: EmpireId, enemy: EmpireId, content: Content): boolean {
  const mine = fleetPower(fleetsOf(known, empireId), content);
  const theirs = fleetPower(fleetsOf(known, enemy), content);
  const outgunned = theirs > 0 && mine * 5 < theirs * 4;
  const weary = averageMorale(known, empireId) < 85;
  return outgunned || weary;
}

/**
 * Whether this empire accepts a treaty proposed by another, and why not if it
 * does not. Opinion decides most of it; an alliance is refused if it would
 * hand the proposer the Accord victory.
 */
export function judgeOffer(
  known: GameState,
  empireId: EmpireId,
  from: EmpireId,
  type: TreatyType,
  content: Content,
  posture: Posture,
  /** True if war looks at least as good to this empire as peace does: it will not tie its hands. */
  ambitious = false,
): { accept: boolean; note: string } {
  const label = content.rules.diplomacy.treaties[type].label.toLowerCase();
  if (type === 'peace') {
    return wantsPeace(known, empireId, from, content)
      ? { accept: true, note: '' }
      : { accept: false, note: 'They believe they are winning the war.' };
  }
  if (posture === 'war' && type !== 'researchPact') return { accept: false, note: 'They are preparing for war.' };
  if (ambitious && (type === 'nonAggression' || type === 'alliance')) return { accept: false, note: 'They see no reason to tie their hands.' };

  const opinion = opinionBreakdown(known, empireId, from, content).total;
  if (opinion < NEEDED[type]) {
    return { accept: false, note: `They do not think well enough of you for a ${label} (opinion ${opinion}, needs ${NEEDED[type]}).` };
  }
  if (type === 'alliance') {
    // An ally that gathers half the minor races leads the Accord and wins. So an alliance with a power
    // that has more members is conceding the game, and that is done only for one clearly the greater.
    if (known.minorsPlaced > 0 && known.empires[from].members.length > known.empires[empireId].members.length && !concedesTo(known, empireId, from)) {
      return { accept: false, note: 'They will not accept your leadership of the Accord while they are your equal.' };
    }
    if (treatiesBetween(known, empireId, from).length === 0) {
      return { accept: false, note: 'They want a lesser treaty to prove itself first.' };
    }
  }
  return { accept: true, note: '' };
}

/** Answers every offer waiting for this empire. */
export function answerOffers(plan: Planner, empireId: EmpireId, content: Content, posture: Posture, ambitious = false): void {
  for (const offer of plan.state.offers.filter((o) => o.to === empireId)) {
    const verdict = judgeOffer(plan.state, empireId, offer.from, offer.type, content, posture, ambitious);
    if (!plan.attempt({ type: 'answerOffer', empire: empireId, offer: offer.id, accept: verdict.accept, note: verdict.note })) {
      plan.attempt({ type: 'answerOffer', empire: empireId, offer: offer.id, accept: false, note: 'It is no longer possible.' });
    }
  }
}

/**
 * Makes at most one proposal: peace if the war is going badly, otherwise the
 * next treaty up the ladder with the rival it likes best.
 */
export function proposeTreaties(plan: Planner, empireId: EmpireId, content: Content, posture: Posture, ambitious = false): void {
  const known = plan.state;
  const propose = (to: EmpireId, treaty: TreatyType) => plan.attempt({ type: 'proposeTreaty', empire: empireId, to, treaty });

  for (const enemy of enemiesOf(known, empireId)) {
    if (wantsPeace(known, empireId, enemy, content) && propose(enemy, 'peace')) return;
  }
  if (posture === 'war') return;

  const rivals = sortedKeys(known.empires)
    .filter((id) => id !== empireId && !known.empires[id].eliminated && !enemiesOf(known, empireId).includes(id))
    .map((id) => ({ id, opinion: opinionBreakdown(known, empireId, id, content).total }))
    .sort((a, b) => b.opinion - a.opinion || (a.id < b.id ? -1 : 1));
  const ladder: Exclude<TreatyType, 'peace'>[] = ['nonAggression', 'researchPact', 'openBorders', 'alliance'];
  for (const rival of rivals) {
    for (const type of ladder) {
      if (hasTreaty(known, empireId, rival.id, type) || treatyBlocker(known, empireId, rival.id, type, content)) continue;
      // It only proposes what it would itself accept.
      if (!judgeOffer(known, empireId, rival.id, type, content, posture, ambitious).accept) break;
      if (propose(rival.id, type)) return;
    }
  }
}

/**
 * Rivals this empire is free to attack. A treaty partner is off limits unless
 * the power's honour is low enough that a clearly winning war tempts it.
 */
export function attackable(known: GameState, empireId: EmpireId, personality: Personality, temptation: number): EmpireId[] {
  return sortedKeys(known.empires).filter(
    (id) => id !== empireId && !known.empires[id].eliminated && (!boundToPeace(known, empireId, id) || temptation > personality.honour),
  );
}
