import { describe, expect, it } from 'vitest';
import {
  addColonyMorale,
  addEmpireMorale,
  getOutputs,
  inUnrest,
  moraleBreakdown,
  moraleEvent,
  processTurn,
  submitCommand,
  validateContent,
  warKey,
  type BuildingId,
  type FactionId,
  type GameState,
} from '../src/sim';
import { ALPHA, BETA, addFleet, colonyOf, homeOf, newGame, rawFixture } from './fixture';

const total = (state: GameState, content: ReturnType<typeof newGame>['content'], empire = ALPHA) =>
  moraleBreakdown(state, homeOf(state, empire), content).total;

describe('morale', () => {
  it('starts at 100 with nothing but the base', () => {
    const { state, content } = newGame();
    expect(moraleBreakdown(state, homeOf(state, ALPHA), content)).toEqual({
      total: 100,
      lines: [{ source: 'Base', kind: 'base', value: 100 }],
    });
    expect(colonyOf(state, ALPHA).morale).toBe(100);
    expect(colonyOf(state, ALPHA).moraleEffects).toEqual([]);
  });

  it('lists each timed event with the turns it has left', () => {
    const { state, content } = newGame();
    addColonyMorale(state, homeOf(state, ALPHA), 'starvation', content);
    expect(colonyOf(state, ALPHA).morale).toBe(90);
    expect(moraleBreakdown(state, homeOf(state, ALPHA), content).lines).toContainEqual({
      source: 'Starvation (5 turns left)',
      kind: 'flat',
      value: -10,
    });
  });

  it('replaces an event of the same kind instead of stacking it', () => {
    const { state, content } = newGame();
    const home = homeOf(state, ALPHA);
    addColonyMorale(state, home, 'battleWon', content);
    colonyOf(state, ALPHA).moraleEffects[0].turnsLeft = 1;
    addColonyMorale(state, home, 'battleWon', content);
    expect(colonyOf(state, ALPHA).moraleEffects).toEqual([{ source: 'battleWon', value: 5, turnsLeft: 5 }]);
    expect(colonyOf(state, ALPHA).morale).toBe(105);
    addColonyMorale(state, home, 'colonyFounded', content);
    expect(colonyOf(state, ALPHA).morale).toBe(107); // different kinds do add up
  });

  it('wears off as turns pass', () => {
    const { state, content } = newGame();
    addColonyMorale(state, homeOf(state, ALPHA), 'battleLost', content); // -5 for 5 turns
    let s = state;
    for (let i = 0; i < 4; i++) {
      s = processTurn(s, content).state;
      expect(colonyOf(s, ALPHA).morale).toBe(95);
    }
    s = processTurn(s, content).state;
    expect(colonyOf(s, ALPHA).morale).toBe(100);
    expect(colonyOf(s, ALPHA).moraleEffects).toEqual([]);
  });

  it('reaches every colony of the empire, and only that empire', () => {
    const { state, content } = newGame();
    addEmpireMorale(state, ALPHA, 'colonyLost', content);
    expect(colonyOf(state, ALPHA).morale).toBe(92);
    expect(colonyOf(state, BETA).morale).toBe(100);
  });

  it('never moves further from 100 than the allowed swing', () => {
    const { state, content } = newGame();
    const home = homeOf(state, ALPHA);
    for (const kind of ['conquered', 'colonyLost', 'starvation', 'battleLost', 'warDeclared', 'minorConquered'] as const) {
      addColonyMorale(state, home, kind, content);
    }
    expect(colonyOf(state, ALPHA).morale).toBe(40); // -68 held to -60
  });

  it('scales every output by its distance from 100, as a traceable line', () => {
    const { state, content } = newGame();
    const before = getOutputs(state, homeOf(state, ALPHA).id, content).food.total;
    addColonyMorale(state, homeOf(state, ALPHA), 'starvation', content); // morale 90
    const food = getOutputs(state, homeOf(state, ALPHA).id, content).food;
    expect(food.lines).toContainEqual({ source: 'Morale', kind: 'percent', value: -10 });
    expect(food.total).toBeLessThan(before);

    content.rules.morale.outputPercent = 50; // half strength, as the shipped game uses
    expect(getOutputs(state, homeOf(state, ALPHA).id, content).food.lines).toContainEqual({ source: 'Morale', kind: 'percent', value: -5 });
  });

  it('stops a colony in unrest from growing, though it is still fed', () => {
    const { state, content } = newGame();
    const colony = colonyOf(state, ALPHA);
    colony.growthProgress = 59; // one more point of surplus would add a person
    for (const kind of ['conquered', 'colonyLost', 'starvation'] as const) addColonyMorale(state, homeOf(state, ALPHA), kind, content);
    expect(colony.morale).toBe(52);
    expect(inUnrest(colony, content)).toBe(true);
    colony.allocation = { food: 10, industry: 0, energy: 0, intel: 0, research: 0 };
    const next = processTurn(state, content).state;
    expect(colonyOf(next, ALPHA).population).toBe(10);
    expect(colonyOf(next, ALPHA).foodStock).toBeGreaterThan(0);

    const calm = newGame().state;
    colonyOf(calm, ALPHA).growthProgress = 59;
    expect(colonyOf(processTurn(calm, content).state, ALPHA).population).toBe(11);
  });

  it('counts morale buildings and a warship on guard as standing causes', () => {
    const { state, content } = newGame();
    const home = homeOf(state, ALPHA);
    colonyOf(state, ALPHA).buildings['forum' as BuildingId] = 1;
    content.rules.morale.guard = 3;
    expect(total(state, content)).toBe(110);
    addFleet(state, content, ALPHA, home.sector, ['scout']); // unarmed: no comfort
    expect(total(state, content)).toBe(110);
    addFleet(state, content, ALPHA, home.sector, ['frigate']);
    const breakdown = moraleBreakdown(state, home, content);
    expect(breakdown.total).toBe(113);
    expect(breakdown.lines).toContainEqual({ source: 'Forum x1', kind: 'flat', value: 10 });
    expect(breakdown.lines).toContainEqual({ source: 'Warship on guard', kind: 'flat', value: 3 });
  });
});

describe('what moves morale', () => {
  it('starvation hits the colony that starved', () => {
    const { state, content } = newGame();
    colonyOf(state, ALPHA).allocation = { food: 0, industry: 10, energy: 0, intel: 0, research: 0 };
    const next = processTurn(state, content).state;
    expect(colonyOf(next, ALPHA).moraleEffects).toEqual([{ source: 'starvation', value: -10, turnsLeft: 4 }]);
    expect(colonyOf(next, ALPHA).morale).toBe(90);
    expect(colonyOf(next, BETA).morale).toBe(100);
  });

  it('declaring war costs the side that declares', () => {
    const { state, content } = newGame();
    const r = submitCommand(state, { type: 'declareWar', empire: ALPHA, on: BETA }, content);
    if (!r.ok) throw new Error(r.error.message);
    expect(colonyOf(r.value, ALPHA).morale).toBe(95);
    expect(colonyOf(r.value, BETA).morale).toBe(100);
  });

  it('winning a battle lifts the victor and losing one depresses the loser', () => {
    const { state, content } = newGame(5);
    state.wars[warKey(ALPHA, BETA)] = 0;
    const home = homeOf(state, ALPHA);
    addFleet(state, content, ALPHA, home.sector, ['destroyer']);
    addFleet(state, content, BETA, home.sector, ['frigate']);
    const next = processTurn(state, content).state;
    expect(colonyOf(next, ALPHA).morale).toBe(105);
    expect(colonyOf(next, BETA).morale).toBe(95);
  });

  it('a drawn battle moves nobody', () => {
    const { state, content } = newGame(5);
    state.wars[warKey(ALPHA, BETA)] = 0;
    const home = homeOf(state, ALPHA);
    addFleet(state, content, ALPHA, home.sector, ['frigate']);
    addFleet(state, content, BETA, home.sector, ['frigate']); // both destroyed in round 4
    const next = processTurn(state, content).state;
    expect(colonyOf(next, ALPHA).morale).toBe(100);
    expect(colonyOf(next, BETA).morale).toBe(100);
  });

  it('capturing a colony cheers the attacker, hurts the defender, and leaves the colony resentful', () => {
    const { state, content } = newGame(5);
    content.rules.fleets.baseRange = 20;
    state.wars[warKey(ALPHA, BETA)] = 0;
    const target = homeOf(state, BETA);
    // Beta needs a second colony to feel the loss.
    const spare = Object.values(state.systems).find((s) => !s.colony)!;
    spare.colony = { ...structuredClone(colonyOf(state, BETA)), population: 3 };
    state.empires[ALPHA].knownSystems[target.id] = BETA;
    const fleet = addFleet(state, content, ALPHA, target.sector, ['transport', 'transport']);
    const r = submitCommand(state, { type: 'invadeSystem', empire: ALPHA, fleet: fleet.id, system: target.id }, content);
    if (!r.ok) throw new Error(r.error.message);
    const next = processTurn(r.value, content).state;

    expect(colonyOf(next, ALPHA).morale).toBe(106);
    expect(next.systems[spare.id].colony!.morale).toBe(92);
    const taken = next.systems[target.id].colony!;
    expect(taken.owner).toBe(ALPHA);
    expect(taken.moraleEffects.map((e) => e.source).sort()).toEqual(['colonyCaptured', 'conquered']);
    expect(taken.morale).toBe(76); // 100 + 6 - 30
  });

  it('founding a colony gives a small lift', () => {
    const { state, content } = newGame(5);
    const home = homeOf(state, ALPHA);
    const target = Object.values(state.systems).find((s) => !s.colony)!;
    target.planets = [{ type: 'terran', maxPopulation: 12, foodBonus: 10, energyBonus: 0 }];
    state.empires[ALPHA].knownSystems[target.id] = null;
    content.rules.fleets.baseRange = 20;
    const fleet = addFleet(state, content, ALPHA, target.sector, ['colony_ship']);
    const r = submitCommand(state, { type: 'coloniseSystem', empire: ALPHA, fleet: fleet.id, system: target.id }, content);
    if (!r.ok) throw new Error(r.error.message);
    const next = processTurn(r.value, content).state;
    expect(colonyOf(next, ALPHA).morale).toBe(102);
    expect(home.id).toBe(next.empires[ALPHA].homeSystem);
  });
});

describe('each power reacts differently', () => {
  it('lets a faction override how much an event moves it', () => {
    const { state, content } = newGame();
    const beta = content.factions[state.empires[BETA].faction as FactionId];
    beta.morale.events = { warDeclared: 6, battleWon: 9 };
    expect(moraleEvent('warDeclared', state, ALPHA, content).value).toBe(-5);
    expect(moraleEvent('warDeclared', state, BETA, content).value).toBe(6);
    const r = submitCommand(state, { type: 'declareWar', empire: BETA, on: ALPHA }, content);
    expect(r.ok && colonyOf(r.value, BETA).morale).toBe(106);
  });

  it('erodes a warlike power in a long peace, up to a cap, and war resets it', () => {
    const { state, content } = newGame();
    content.factions[state.empires[BETA].faction as FactionId].morale.peacePerTenTurns = -4;
    state.turn = 25;
    expect(total(state, content, BETA)).toBe(92); // two full decades of peace
    expect(total(state, content, ALPHA)).toBe(100);
    expect(moraleBreakdown(state, homeOf(state, BETA), content).lines).toContainEqual({ source: 'Long peace', kind: 'flat', value: -8 });
    state.turn = 500;
    expect(total(state, content, BETA)).toBe(80); // capped at 20

    state.wars[warKey(ALPHA, BETA)] = 499;
    const next = processTurn(state, content).state;
    expect(next.empires[BETA].lastWarTurn).toBe(500);
    expect(moraleBreakdown(next, homeOf(next, BETA), content).lines.some((l) => l.source === 'Long peace')).toBe(false);
  });

  it('ships the Concord and Vashran profiles from DESIGN.md', async () => {
    const { loadContent } = await import('../src/data');
    const content = loadContent();
    const concord = content.factions['concord' as FactionId].morale;
    const vashran = content.factions['vashran' as FactionId].morale;
    expect(concord.events.warDeclared).toBeLessThan(-20); // attacking first crashes morale
    expect(vashran.events.colonyCaptured).toBeGreaterThan(content.rules.morale.events.colonyCaptured.value); // conquest fuels it
    expect(vashran.peacePerTenTurns).toBeLessThan(0); // peace erodes it
    expect(content.rules.morale.outputPercent).toBe(50);
  });

  it('rejects malformed morale content', () => {
    const errorsFor = (mutate: (raw: any) => void) => {
      const raw = structuredClone(rawFixture);
      mutate(raw);
      const result = validateContent(raw);
      return result.ok ? [] : result.error;
    };
    expect(errorsFor((r) => delete r.rules.morale.events.starvation).join()).toMatch(/events\.starvation/);
    expect(errorsFor((r) => (r.factions[0].morale = { events: { partying: 5 }, peacePerTenTurns: 0 })).join()).toMatch(/morale/);
    expect(errorsFor((r) => (r.buildings[0].morale = 1.5)).join()).toMatch(/morale/);
  });
});
