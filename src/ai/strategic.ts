import { POSTURES, empireRange, type Content, type EmpireId, type GameState, type Personality, type Posture } from '../sim';
import { shipsWithRole, threatDistance, type Picture } from './maps';

/** Turns between strategic reviews. */
export const POSTURE_REVIEW_TURNS = 10;

/**
 * Scores each posture from the empire's picture of the galaxy. Higher wins.
 *
 * - expand: there are good free systems in reach.
 * - develop: nothing left to settle, or the colonies have lots of room to grow.
 * - fortify: a rival is close and the navy is thin.
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

  const raw: Record<Posture, number> = {
    expand: free === 0 ? 0 : 50 + 20 * Math.min(free, 5),
    develop: 50 + (free === 0 ? 40 : 0) + (fill < 50 ? 20 : 0),
    fortify: threatened === 0 ? 10 : 55 + 10 * Math.min(threatened, 3) + (warships < picture.colonies.length ? 20 : 0),
  };
  const scores = {} as Record<Posture, number>;
  for (const posture of POSTURES) scores[posture] = Math.floor((raw[posture] * personality.posture[posture]) / 100);
  return scores;
}

/** The highest-scoring posture; ties go to the earlier one in POSTURES. */
export function choosePosture(scores: Record<Posture, number>): Posture {
  return POSTURES.reduce((best, p) => (scores[p] > scores[best] ? p : best), POSTURES[0]);
}
