import {
  fleetsOf,
  minorGarrison,
  sectorDistance,
  type Content,
  type EmpireId,
  type Personality,
  type StarSystem,
} from '../../sim';
import type { Planner } from '../agent';
import type { Picture } from '../maps';

/** Share of landed troops assumed to count, to leave a margin over the garrison. */
const TROOP_MARGIN_PERCENT = 75;
/** A power that conquers minors gives up on courting one below this attitude. */
const COLD_ATTITUDE = 50;

const attitudeOf = (system: StarSystem, empireId: EmpireId, fallback: number): number =>
  system.minor?.attitude[empireId] ?? fallback;

/** Minor races this power would rather take by force: it conquers, and they have not warmed to it. */
export function conquestTargets(picture: Picture, empireId: EmpireId, content: Content, personality: Personality): StarSystem[] {
  if (personality.conquersMinors === 0 || picture.colonies.length < 3) return [];
  return picture.minors.filter((s) => attitudeOf(s, empireId, content.rules.minors.startAttitude) < COLD_ATTITUDE);
}

/**
 * Spends this turn's share of the intel pool on the minor race closest to
 * joining, so influence is concentrated rather than spread thin. Minors the
 * power means to conquer get nothing.
 */
export function courtMinors(plan: Planner, empireId: EmpireId, content: Content, personality: Personality, picture: Picture): void {
  const rules = content.rules.minors;
  const spared = new Set(conquestTargets(picture, empireId, content, personality).map((s) => s.id));
  const budget = Math.floor((plan.state.empires[empireId].intelPool * personality.minorInfluence) / 100);
  const points = budget - (budget % rules.influenceCost);
  if (points < rules.influenceCost) return;

  const best = picture.minors
    .filter((s) => !spared.has(s.id) && attitudeOf(s, empireId, rules.startAttitude) < 100)
    .sort((a, b) => attitudeOf(b, empireId, rules.startAttitude) - attitudeOf(a, empireId, rules.startAttitude) || (a.id < b.id ? -1 : 1))[0];
  if (best) plan.attempt({ type: 'courtMinor', empire: empireId, system: best.id, points });
}

/** Sends idle transports against the nearest minor race marked for conquest, once there are enough troops to win. */
export function conquerMinors(plan: Planner, empireId: EmpireId, content: Content, personality: Personality, picture: Picture): void {
  const targets = conquestTargets(picture, empireId, content, personality);
  if (targets.length === 0) return;
  const idle = fleetsOf(plan.state, empireId).filter(
    (f) => !f.destination && f.order === 'none' && f.ships.some((s) => (content.hulls[s.hull]?.troops ?? 0) > 0),
  );
  for (const fleet of idle) {
    const troops = fleet.ships.reduce((sum, s) => sum + (content.hulls[s.hull]?.troops ?? 0), 0);
    const target = [...targets]
      .sort((a, b) => sectorDistance(a.sector, fleet.sector) - sectorDistance(b.sector, fleet.sector) || (a.id < b.id ? -1 : 1))
      .find((s) => Math.floor((troops * TROOP_MARGIN_PERCENT) / 100) > minorGarrison(s, content).total);
    if (target) plan.attempt({ type: 'invadeSystem', empire: empireId, fleet: fleet.id, system: target.id });
  }
}
