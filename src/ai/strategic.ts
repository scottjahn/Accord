import { POSTURES, empireRange, type Content, type EmpireId, type GameState, type Personality, type Posture } from '../sim';
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
 *   Being at war halves the appeal of quietly developing.
 */
export function scorePostures(
  known: GameState,
  empireId: EmpireId,
  content: Content,
  picture: Picture,
  personality: Personality,
): Record<Posture, number> {
  const free = picture.opportunities.length;
  const capacity = picture.colonies.reduce((sum, s) => sum + s.planets.reduce((n, p) => n + p.maxPopulation, 0), 0);
  const fill = capacity === 0 ? 100 : Math.floor((picture.population * 100) / capacity);

  const reach = empireRange(known, empireId, content) + 2;
  const threatened = picture.colonies.filter((c) => threatDistance(picture, c.sector) <= reach).length;
  const warships = shipsWithRole(known, empireId, content, 'warship');

  const fighting = enemiesOf(known, empireId).length > 0;
  const rivals = sortedRivals(known, empireId);
  const rivalColonies = knownColoniesOf(known, empireId, rivals).length;
  const myPower = fleetPower(fleetsOf(known, empireId), content);
  const theirPower = fleetPower(rivals.flatMap((id) => fleetsOf(known, id)), content);
  const strong = warships >= 3 && myPower * 2 >= theirPower * 3;
  const thin = warships * 100 < picture.colonies.length * personality.warshipsPerColony;

  const raw: Record<Posture, number> = {
    expand: free === 0 ? 0 : 50 + 20 * Math.min(free, 5),
    develop: Math.floor((50 + (free === 0 ? 40 : 0) + (fill < 50 ? 20 : 0)) / (fighting ? 2 : 1)),
    war: rivalColonies === 0 ? 0 : (fighting ? 80 : 0) + (free === 0 ? 60 : 0) + (strong ? 30 : 0) + (known.turn >= 60 ? 10 : 0),
    // Fortifying is for the weak: once the navy matches its target it stops being attractive.
    fortify: threatened === 0 ? 10 : thin ? 85 : 30,
  };
  const scores = {} as Record<Posture, number>;
  for (const posture of POSTURES) scores[posture] = Math.floor((raw[posture] * personality.posture[posture]) / 100);
  return scores;
}

function sortedRivals(known: GameState, empireId: EmpireId): EmpireId[] {
  return (Object.keys(known.empires) as EmpireId[]).sort().filter((id) => id !== empireId && !known.empires[id].eliminated);
}

/** The highest-scoring posture; ties go to the earlier one in POSTURES. */
export function choosePosture(scores: Record<Posture, number>): Posture {
  return POSTURES.reduce((best, p) => (scores[p] > scores[best] ? p : best), POSTURES[0]);
}
