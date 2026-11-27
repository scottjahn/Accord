import {
  boundToPeace,
  coloniesOf,
  dominationShareOf,
  sectorDistance,
  fleetsOf,
  hasTreaty,
  opinionBreakdown,
  sortedKeys,
  treatiesBetween,
  treatyBlocker,
  type Content,
  type EmpireId,
  type GameState,
  type PeaceTerms,
  type Personality,
  type Posture,
  type TreatyType,
} from '../sim';
import type { Planner } from './agent';
import { enemiesOf, fleetPower, knownColoniesOf } from './tactical/war';

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

const peaceRules = (content: Content) => content.ai.peace;

/** Fleet power of `a` as a percent of `b`'s, as far as `known` shows them; 1000 if `b` has none. */
function edgePercent(known: GameState, a: EmpireId, b: EmpireId, content: Content): number {
  const mine = fleetPower(fleetsOf(known, a), content);
  const theirs = fleetPower(fleetsOf(known, b), content);
  return theirs === 0 ? 1000 : Math.floor((mine * 100) / theirs);
}

/**
 * What `winner` would want, in credits, to stop a war with `loser`: the value
 * of the share of the loser's colonies it expects to take (`takePercent`),
 * growing with its edge in fleet power and weighted by its appetite for war.
 * 0 when the fight is even or worse.
 * `colonies` is how many of the loser's colonies the winner knows of.
 */
export function peacePrice(edge: number, colonies: number, personality: Personality, content: Content): number {
  const rules = peaceRules(content);
  const factor = Math.max(0, Math.min(100, edge - rules.freeBelowEdgePercent));
  return Math.floor((colonies * rules.colonyValue * rules.takePercent * factor * personality.posture.war) / 1000000);
}

/** What terms are worth to the empire receiving them, in credits. */
export function termsValue(known: GameState, terms: PeaceTerms | null, content: Content): number {
  if (!terms) return 0;
  const rules = peaceRules(content);
  return terms.credits + terms.systems.reduce((sum, id) => sum + rules.colonyValue + (known.systems[id]?.colony?.population ?? 0) * rules.perPopulation, 0);
}

/**
 * True if this empire holds so much of the colony share that domination needs
 * that it will not be bought off; never with `nearVictoryPercent` at 0. It
 * counts only the rival colonies it knows of, so with much unexplored it
 * overrates its share.
 */
function nearDomination(known: GameState, empireId: EmpireId, content: Content): boolean {
  const mine = coloniesOf(known, empireId).length;
  const theirs = Object.values(known.empires[empireId].knownSystems).filter((owner) => owner !== null && owner !== empireId).length;
  const share = dominationShareOf(Object.keys(known.empires).length, content);
  const near = peaceRules(content).nearVictoryPercent;
  return near > 0 && share > 0 && mine * 10000 >= (mine + theirs) * share * peaceRules(content).nearVictoryPercent;
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
  /** What the proposer pays, for a peace. */
  terms: PeaceTerms | null = null,
): { accept: boolean; note: string } {
  const label = content.rules.diplomacy.treaties[type].label.toLowerCase();
  if (type === 'peace') {
    if (wantsPeace(known, empireId, from, content)) return { accept: true, note: '' };
    if (peaceRules(content).colonyValue === 0) return { accept: false, note: 'They believe they are winning the war.' };
    if (nearDomination(known, empireId, content)) return { accept: false, note: 'Victory is in their sight; they will not stop now.' };
    const personality = content.ai.personalities[known.empires[empireId].faction];
    const price = peacePrice(edgePercent(known, empireId, from, content), coloniesKnown(known, empireId, from), personality, content);
    const offered = termsValue(known, terms, content);
    return offered >= price
      ? { accept: true, note: '' }
      : { accept: false, note: `They want at least ${price} credits' worth for peace (offered ${offered}).` };
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
    const verdict = judgeOffer(plan.state, empireId, offer.from, offer.type, content, posture, ambitious, offer.terms);
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
    if (!wantsPeace(known, empireId, enemy, content)) continue;
    const terms = peaceTerms(known, empireId, enemy, content);
    if (terms && plan.attempt({ type: 'proposeTreaty', empire: empireId, to: enemy, treaty: 'peace', terms })) return;
    if (propose(enemy, 'peace')) return;
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
 * What a losing empire offers for peace: its guess at the enemy's price, from
 * the enemy's edge as it sees it and the enemy's appetite for war (powers'
 * temperaments are no secret), paid first in credits up to `treasuryPercent`
 * of the treasury, then with its colonies nearest the enemy, never its home.
 * Null if it guesses the enemy wants nothing, or if it has nothing to give.
 */
export function peaceTerms(known: GameState, empireId: EmpireId, enemy: EmpireId, content: Content): PeaceTerms | null {
  const rules = peaceRules(content);
  if (rules.colonyValue === 0) return null;
  const theirs = content.ai.personalities[known.empires[enemy].faction];
  const mine = coloniesOf(known, empireId);
  const price = peacePrice(edgePercent(known, enemy, empireId, content), mine.length, theirs, content);
  if (price === 0) return null;
  const credits = Math.min(price, Math.floor((known.empires[empireId].credits * rules.treasuryPercent) / 100));
  const terms: PeaceTerms = { credits, systems: [] };
  const enemyColonies = knownColoniesOf(known, empireId, [enemy]);
  const exposure = (sector: GameState['systems'][keyof GameState['systems']]['sector']) =>
    enemyColonies.reduce((best, s) => Math.min(best, sectorDistance(s.sector, sector)), Infinity);
  const spare = mine
    .filter((s) => s.id !== known.empires[empireId].homeSystem)
    .sort((a, b) => exposure(a.sector) - exposure(b.sector) || (a.id < b.id ? -1 : 1));
  for (const system of spare) {
    if (termsValue(known, terms, content) >= price || terms.systems.length >= rules.maxColonies) break;
    terms.systems.push(system.id);
  }
  return terms.credits === 0 && terms.systems.length === 0 ? null : terms;
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
