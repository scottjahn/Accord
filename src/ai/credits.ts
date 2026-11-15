import {
  buyOutCost,
  coloniesOf,
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

/**
 * Spends the treasury where it helps the current posture most:
 * 1. a power that can buy loyalty takes the friendliest minor it can afford;
 * 2. at war, a power that hires mercenaries hires its best affordable warship;
 * 3. it buys out the ship its posture is waiting for (a colony ship when
 *    expanding, a warship or transport when fighting), or anything at all once
 *    it has far more than the price.
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
}
