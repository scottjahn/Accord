import { describe, expect, it } from 'vitest';
import { createPlanner } from '../../src/ai/agent';
import { survey } from '../../src/ai/maps';
import { setTargets } from '../../src/ai/operational';
import { scoreBuilding } from '../../src/ai/tactical/colonies';
import { directFleets } from '../../src/ai/tactical/fleets';
import { conquerMinors, conquestTargets, courtMinors } from '../../src/ai/tactical/minors';
import { loadContent } from '../../src/data';
import { runGame } from '../../src/runner/runGame';
import {
  addColonyMorale,
  computeColonyEconomy,
  forecastColony,
  redactFor,
  sectorKey,
  sortedKeys,
  type BuildingId,
  type FactionId,
  type GameState,
  type MinorId,
  type StarSystem,
} from '../../src/sim';
import { ALPHA, BETA, addFleet, colonyOf, homeOf, newGame } from '../fixture';

const ALPHA_FACTION = 'alpha' as FactionId;
const BETA_FACTION = 'beta' as FactionId;

/** Two minors next to Alpha's home, both already met: the Wardens (want protection) and the Sages. */
function setup() {
  const { state, content } = newGame(5);
  const home = homeOf(state, ALPHA);
  const taken = new Set(Object.values(state.systems).map((s) => sectorKey(s.sector)));
  const spots = [-1, 0, 1]
    .flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: home.sector.x + dx, y: home.sector.y + dy })))
    .filter((s) => s.x >= 0 && s.y >= 0 && s.x < 8 && s.y < 6 && !taken.has(sectorKey(s)));
  const free = Object.values(state.systems).filter((s) => !s.colony && !(s.id in state.empires[ALPHA].knownSystems));
  const place = (system: StarSystem, i: number, race: string, attitude: number) => {
    system.sector = spots[i];
    system.planets = [{ type: 'terran', maxPopulation: 12, foodBonus: 10, energyBonus: 0 }];
    system.minor = { race: race as MinorId, population: 6, attitude: { [ALPHA]: attitude }, leader: null, leadTurns: 0 };
    state.empires[ALPHA].knownSystems[system.id] = null;
    return system;
  };
  const wardens = place(free[0], 0, 'wardens', 30);
  const sages = place(free[1], 1, 'sages', 60);
  state.empires[ALPHA].intelPool = 100;
  const look = (s: GameState = state) => survey(redactFor(s, ALPHA, content), ALPHA, content);
  const plan = () => createPlanner(redactFor(state, ALPHA, content), content);
  return { state, content, home, wardens, sages, look, plan };
}

describe('the AI and minor races', () => {
  it('sees the minors it has found, and does not mistake their homes for free systems', () => {
    const { wardens, sages, look } = setup();
    const picture = look();
    expect(picture.minors.map((s) => s.id).sort()).toEqual([wardens.id, sages.id].sort());
    expect(picture.opportunities.some((o) => o.system.id === wardens.id || o.system.id === sages.id)).toBe(false);
  });

  it('spends its influence on the minor closest to joining', () => {
    const { content, sages, look, plan } = setup();
    const p = plan();
    courtMinors(p, ALPHA, content, content.ai.personalities[ALPHA_FACTION], look());
    expect(p.issued).toEqual([{ type: 'courtMinor', empire: ALPHA, system: sages.id, points: 100 }]);
    expect(p.state.empires[ALPHA].intelPool).toBe(0);
  });

  it('spends only its personality share, and nothing when the pool is too small', () => {
    const { state, content, look, plan } = setup();
    const half = { ...content.ai.personalities[ALPHA_FACTION], minorInfluence: 50 };
    const p = plan();
    courtMinors(p, ALPHA, content, half, look());
    expect(p.issued).toMatchObject([{ points: 50 }]);

    state.empires[ALPHA].intelPool = 4;
    const broke = plan();
    courtMinors(broke, ALPHA, content, half, look());
    expect(broke.issued).toEqual([]);
  });

  it('posts a warship at a minor that wants protection once its colonies are guarded', () => {
    const { state, content, home, wardens, look, plan } = setup();
    addFleet(state, content, ALPHA, home.sector, ['frigate']);
    const second = addFleet(state, content, ALPHA, home.sector, ['frigate']);
    const p = plan();
    directFleets(p, ALPHA, content, 'develop', look());
    const moved = p.issued.filter((c) => c.type === 'moveFleet');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ to: wardens.sector });
    expect(second.owner).toBe(ALPHA);
  });

  it('a courting power marks nobody for conquest; a conquering power marks the minors cold to it', () => {
    const { state, content, wardens, look } = setup();
    for (const s of Object.values(state.systems).filter((x) => !x.colony && !x.minor).slice(0, 2)) {
      s.colony = { ...structuredClone(colonyOf(state, ALPHA)), population: 2 };
    }
    const picture = look();
    expect(picture.colonies).toHaveLength(3);
    const courting = content.ai.personalities[ALPHA_FACTION];
    const conquering = content.ai.personalities[BETA_FACTION];
    expect(conquestTargets(picture, ALPHA, content, courting)).toEqual([]);
    // Wardens at 30 are cold; Sages at 60 are worth courting.
    expect(conquestTargets(picture, ALPHA, content, conquering).map((s) => s.id)).toEqual([wardens.id]);
    expect(setTargets('develop', picture, conquering, 1).transports).toBe(3);
    expect(setTargets('develop', picture, courting, 0).transports).toBe(0);
  });

  it('a conquering power lands troops once it has enough, and does not court its victim', () => {
    const { state, content, home, wardens, sages, look, plan } = setup();
    for (const s of Object.values(state.systems).filter((x) => !x.colony && !x.minor).slice(0, 2)) {
      s.colony = { ...structuredClone(colonyOf(state, ALPHA)), population: 2 };
    }
    const conquering = content.ai.personalities[BETA_FACTION];
    const few = addFleet(state, content, ALPHA, home.sector, ['transport']); // 10 troops x 75% < garrison 16
    let p = plan();
    conquerMinors(p, ALPHA, content, conquering, look());
    expect(p.issued).toEqual([]);

    state.fleets[few.id].ships.push(...addFleet(state, content, ALPHA, home.sector, ['transport', 'transport']).ships);
    delete state.fleets[sortedKeys(state.fleets).filter((id) => id !== few.id)[0]];
    p = plan();
    conquerMinors(p, ALPHA, content, conquering, look());
    expect(p.issued).toEqual([{ type: 'invadeSystem', empire: ALPHA, fleet: few.id, system: wardens.id }]);

    const courting = plan();
    courtMinors(courting, ALPHA, content, conquering, look());
    expect(courting.issued).toMatchObject([{ type: 'courtMinor', system: sages.id }]);
  });

  it('values a morale building more when the colony is unhappy', () => {
    const { state, content } = setup();
    const home = homeOf(state, ALPHA);
    const score = () =>
      scoreBuilding(content.buildings['forum' as BuildingId], home, computeColonyEconomy(state, home, content), forecastColony(state, home, content), 'develop');
    const calm = score();
    addColonyMorale(state, home, 'colonyLost', content);
    expect(score()).toBeGreaterThan(calm);
  });

  it('sees only its own standing with a minor', () => {
    const { state, content, sages } = setup();
    sages.minor!.attitude[BETA] = 99;
    const known = redactFor(state, ALPHA, content);
    expect(known.systems[sages.id].minor!.attitude).toEqual({ [ALPHA]: 60 });
  });
});

/**
 * Milestone 6 exit test: absorbing minors is a viable path. On the shipped
 * content, the Concord AI (which only courts) must win minor races over by
 * diplomacy in most games.
 */
describe('absorbing minors is a viable path', () => {
  it('the Concord gains at least 2 minor races by turn 200 in at least 4 of 6 games', () => {
    const content = loadContent();
    let games = 0;
    let conquered = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const state = runGame({
        content,
        seed,
        turns: 200,
        preset: 'small',
        factions: ['concord', 'vashran'],
        onTurn: (_s, events) => (conquered += events.filter((e) => e.type === 'minorConquered').length),
      });
      const concord = Object.values(state.empires).find((e) => e.faction === 'concord')!;
      if (concord.members.length >= 2) games++;
      // Members really are held, and really do grant their bonus.
      for (const member of concord.members) {
        expect(Object.values(state.systems).some((s) => s.colony?.owner === concord.id && s.colony.minorRace === member)).toBe(true);
      }
    }
    expect(games).toBeGreaterThanOrEqual(4);
    expect(conquered).toBeGreaterThanOrEqual(0);
  }, 300_000);
});
