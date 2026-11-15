import {
  buyOutCost,
  atWar,
  coloniesOf,
  hasMet,
  membershipCost,
  mercenaryCost,
  sortedKeys,
  type Content,
  type EmpireId,
  type Personality,
  type Posture,
} from '../sim';
import type { Planner } from './agent';
import type { Picture } from './maps';
import { conquestTargets } from './tactical/minors';
import { enemiesOf } from './tactical/war';

/** Ships hired in a single turn, so one windfall is not all spent at once. */
const HIRES_PER_TURN = 2;
/** With this many times the price in the bank, anything at the front of a queue is worth buying. */
const FLUSH_MULTIPLE = 3;
/** Turns between gifts to the same empire. */
export const GIFT_EVERY_TURNS = 20;

/**
 * Spends the treasury where it helps the current posture most:
 * 1. a power that can buy loyalty takes the friendliest minor it can afford;
 * 2. at war, a power that hires mercenaries hires its best affordable warship;
 * 3. it buys out the ship its posture is waiting for (a colony ship when
 *    expanding, a warship or transport when fighting), or anything at all once
 *    it has far more than the price;
 * 4. a power that gives gifts sends one, from what is left, to the largest
 *    power it is at peace with.
 */
export function spendCredits(
  plan: Planner,
  empireId: EmpireId,
  content: Content,
  posture: Posture,
  personality: Personality,
  picture: Picture,
): void {
  const traits = content.factions[plan.state.empires[empireId].faction].traits;
  const credits = () => plan.state.empires[empireId].credits;
  const fighting = posture === 'war' || enemiesOf(plan.state, empireId).length > 0;

  // A power saving for the wealth victory stops spending once it is within sight.
  const goal = content.rules.victory.wealthCredits;
  if (goal > 0 && personality.thrift > 0 && credits() * 100 >= goal * personality.thrift) return;

  if (traits.buysMinors) {
    const spared = new Set(conquestTargets(picture, empireId, content, personality).map((s) => s.id));
    const start = content.rules.minors.startAttitude;
    const best = picture.minors
      .filter((s) => !spared.has(s.id) && membershipCost(plan.state, s, empireId, content) <= credits())
      .sort((a, b) => (b.minor?.attitude[empireId] ?? start) - (a.minor?.attitude[empireId] ?? start) || (a.id < b.id ? -1 : 1))[0];
    if (best && plan.attempt({ type: 'buyMembership', empire: empireId, system: best.id })) {
      // They join when the turn resolves; there is nothing left to court.
      picture.minors = picture.minors.filter((s) => s.id !== best.id);
    }
  }

  if (traits.hiresMercenaries && fighting) {
    const hulls = sortedKeys(content.hulls)
      .filter((id) => content.hulls[id].role === 'warship')
      .sort((a, b) => mercenaryCost(content.hulls[b], content) - mercenaryCost(content.hulls[a], content) || (a < b ? -1 : 1));
    let hired = 0;
    for (const system of coloniesOf(plan.state, empireId)) {
      while (hired < HIRES_PER_TURN && hulls.some((hull) => plan.attempt({ type: 'hireMercenaries', empire: empireId, system: system.id, hull }))) {
        hired += 1;
      }
    }
  }

  for (const system of coloniesOf(plan.state, empireId)) {
    const item = system.colony!.buildQueue[0];
    const cost = buyOutCost(system, content);
    if (!item || cost === null || cost === 0 || cost > credits()) continue;
    const role = item.kind === 'ship' ? content.hulls[item.hull]?.role : null;
    const wanted = (role === 'colony' && posture === 'expand') || ((role === 'warship' || role === 'transport') && fighting);
    if (wanted || credits() >= cost * FLUSH_MULTIPLE) plan.attempt({ type: 'buyOut', empire: empireId, system: system.id });
  }

  giveGift(plan, empireId, content, personality);
}

/**
 * Sends one gift, of the smallest size that is remembered, to the power most
 * worth keeping friendly: the one with the most colonies this empire knows of,
 * among those it has met and is not fighting. It gives only from a full
 * treasury, and not again to the same empire while the last gift is recent.
 * Everything here is the empire's own knowledge: its map, and what others
 * remember it doing.
 */
export function giveGift(plan: Planner, empireId: EmpireId, content: Content, personality: Personality): boolean {
  const size = content.rules.credits.giftSize;
  const state = plan.state;
  if (personality.gifts <= 0 || state.empires[empireId].credits < size * personality.gifts) return false;

  const known = state.empires[empireId].knownSystems;
  const coloniesKnown = (other: EmpireId) => sortedKeys(known).filter((id) => known[id] === other).length;
  const lastGift = (other: EmpireId) =>
    (state.opinions[other]?.[empireId] ?? []).filter((entry) => entry.cause === 'gift').reduce((latest, entry) => Math.max(latest, entry.turn), -Infinity);
  const candidates = sortedKeys(state.empires)
    .filter((other) => other !== empireId && !state.empires[other].eliminated && hasMet(state, empireId, other) && !atWar(state, empireId, other))
    .filter((other) => state.turn - lastGift(other) >= GIFT_EVERY_TURNS)
    .sort((a, b) => coloniesKnown(b) - coloniesKnown(a) || (a < b ? -1 : 1));
  return candidates.length > 0 && plan.attempt({ type: 'giftCredits', empire: empireId, to: candidates[0], amount: size });
}

