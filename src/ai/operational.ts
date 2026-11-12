import { FIELDS, type FieldId, type Personality, type Posture } from '../sim';
import type { Picture } from './maps';

/** What the empire is aiming to have this turn. The tactical layer works toward it. */
export interface Targets {
  settlers: number;
  scouts: number;
  warships: number;
  transports: number;
  /** Warships that must gather before a strike is launched. */
  strikeSize: number;
  research: Record<FieldId, number>;
}

/** How each posture leans the personality's research weights (percent). */
const RESEARCH_FOCUS: Record<Posture, Partial<Record<FieldId, number>>> = {
  expand: { propulsion: 200, biology: 150 },
  develop: { computing: 200, construction: 150, energy: 120 },
  fortify: { weapons: 200, construction: 150 },
  war: { weapons: 200, energy: 150, propulsion: 150 },
};

/** Scales weights to whole percents that sum to exactly 100. */
export function toPercents(weights: Record<FieldId, number>): Record<FieldId, number> {
  const total = FIELDS.reduce((sum, f) => sum + weights[f], 0);
  const out = {} as Record<FieldId, number>;
  let assigned = 0;
  for (const field of FIELDS) {
    out[field] = total === 0 ? 0 : Math.floor((weights[field] * 100) / total);
    assigned += out[field];
  }
  const byRemainder = [...FIELDS].sort((a, b) => ((weights[b] * 100) % (total || 1)) - ((weights[a] * 100) % (total || 1)));
  for (let i = 0; assigned < 100; i = (i + 1) % FIELDS.length, assigned++) out[byRemainder[i]] += 1;
  return out;
}

/** Turns a posture into this turn's targets. */
export function setTargets(posture: Posture, picture: Picture, personality: Personality): Targets {
  const colonies = picture.colonies.length;
  const free = picture.opportunities.length;

  const settlers = posture === 'expand' ? Math.min(free, 2 + Math.floor(colonies / 2)) : Math.min(free, 1);
  const scouts = picture.unexplored.length > 0 ? personality.scouts : 0;
  const navy = posture === 'fortify' ? 150 : posture === 'expand' ? 60 : 100;
  const garrison = colonies < 2 ? 0 : Math.max(1, Math.ceil((colonies * personality.warshipsPerColony * navy) / 10000));
  // At war the navy is at least a strike force, and troops come first: ships win battles, transports win colonies.
  const warships = posture === 'war' ? Math.max(6, garrison) : garrison;
  const transports = posture === 'war' ? Math.min(10, 3 + Math.floor(colonies / 4)) : 0;
  // Big enough to win a fight, small enough that losses do not stop it ever forming again.
  const strikeSize = Math.min(8, Math.max(3, Math.floor(warships / 2)));

  const weights = {} as Record<FieldId, number>;
  for (const field of FIELDS) weights[field] = personality.research[field] * (RESEARCH_FOCUS[posture][field] ?? 100);

  return { settlers, scouts, warships, transports, strikeSize, research: toPercents(weights) };
}
