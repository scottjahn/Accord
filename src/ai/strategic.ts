import { POSTURES, empireRange, opinionBreakdown, type Content, type EmpireId, type GameState, type Personality, type Posture } from '../sim';
import { fleetsOf } from '../sim';
import { shipsWithRole, threatDistance, type Picture } from './maps';
import { enemiesOf, fleetPower, knownColoniesOf } from './tactical/war';

/** Turns between strategic reviews. */
export const POSTURE_REVIEW_TURNS = 10;

/**
 * Scores each posture from the empire's picture of the galaxy. Higher wins.
 *
 * - expand: there are good free systems in reach.
 * - develop: nothing left to settle, or the colonies have lots of room to grow.
 * - fortify: a rival is close and the navy is below the personality's target.
 * - war: a rival's colonies are known and either war is already on, or there is
 *   nowhere left to settle and the navy outweighs what it can see of theirs.
 *   Being at war halves the appeal of quietly developing. A rival it resents
 *   (see `resentedRivals`) adds `ai.borders.warScore`.
 */
export function scorePostures(
  known: GameState,
  empireId: EmpireId,
  content: Content,
  picture: Picture,
  personality: Personality,
  /** Rivals this empire is free to attack; treaty partners are normally left out. Defaults to everyone. */
  targets?: EmpireId[],
): Record<Posture, number> {
  const free = picture.opportunities.length;
  const capacity = picture.colonies.reduce((sum, s) => sum + s.planets.reduce((n, p) => n + p.maxPopulation, 0), 0);
  const fill = capacity === 0 ? 100 : Math.floor((picture.population * 100) / capacity);

  const reach = empireRange(known, empireId, content) + 2;
  const threatened = picture.colonies.filter((c) => threatDistance(picture, c.sector) <= reach).length;
  const warships = shipsWithRole(known, empireId, content, 'warship');

  const fighting = enemiesOf(known, empireId).length > 0;
  const rivals = sortedRivals(known, empireId).filter((id) => !targets || targets.includes(id));
  const rivalColonies = knownColoniesOf(known, empireId, rivals).length;
  const myPower = fleetPower(fleetsOf(known, empireId), content);
  const theirPower = fleetPower(rivals.flatMap((id) => fleetsOf(known, id)), content);
  const strong = warships >= 3 && myPower * 2 >= theirPower * 3;
  const grievance = resentedRivals(known, empireId, content, rivals).length > 0 ? content.ai.borders.warScore : 0;
  const thin = warships * 100 < picture.colonies.length * personality.warshipsPerColony;

  const raw: Record<Posture, number> = {
    expand: free === 0 ? 0 : 50 + 20 * Math.min(free, 5),
    develop: Math.floor((50 + (free === 0 ? 40 : 0) + (fill < 50 ? 20 : 0)) / (fighting ? 2 : 1)),
    war: rivalColonies === 0 ? 0 : (fighting ? 80 : 0) + (free === 0 ? 60 : 0) + (strong ? 30 + personality.earlyWar : 0) + (known.turn >= 60 ? 10 : 0) + grievance,
    // Fortifying is for the weak: once the navy matches its target it stops being attractive.
    fortify: threatened === 0 ? 10 : thin ? 85 : 30,
  };
  const scores = {} as Record<Posture, number>;
  for (const posture of POSTURES) scores[posture] = Math.floor((raw[posture] * personality.posture[posture]) / 100);
  return scores;
}

/**
 * Rivals among `among` that this empire thinks of at `ai.borders.resentAt` or
 * worse and whose colonies it knows of, most resented first: neighbours whose
 * borders have long pressed on its own, or pushed into them.
 */
export function resentedRivals(known: GameState, empireId: EmpireId, content: Content, among: EmpireId[]): EmpireId[] {
  if (content.ai.borders.warScore === 0) return [];
  const owners = new Set(Object.values(known.empires[empireId].knownSystems));
  return among
    .filter((id) => owners.has(id))
    .map((id) => ({ id, opinion: opinionBreakdown(known, empireId, id, content).total }))
    .filter((r) => r.opinion <= content.ai.borders.resentAt)
    .sort((a, b) => a.opinion - b.opinion || (a.id < b.id ? -1 : 1))
    .map((r) => r.id);
}

function sortedRivals(known: GameState, empireId: EmpireId): EmpireId[] {
  return (Object.keys(known.empires) as EmpireId[]).sort().filter((id) => id !== empireId && !known.empires[id].eliminated);
}

/** The highest-scoring posture; ties go to the earlier one in POSTURES. */
export function choosePosture(scores: Record<Posture, number>): Posture {
  return POSTURES.reduce((best, p) => (scores[p] > scores[best] ? p : best), POSTURES[0]);
}
