import { describe, expect, it } from 'vitest';
import {
  attitudeChange,
  checkInvariants,
  combatBonuses,
  coloniesOf,
  empireRange,
  garrisonStrength,
  getOutputs,
  minorGarrison,
  minorStanding,
  moraleBreakdown,
  processTurn,
  redactFor,
  sectorKey,
  submitCommand,
  type Command,
  type GameState,
  type MinorId,
  type StarSystem,
} from '../src/sim';
import { ALPHA, BETA, addFleet, colonyOf, homeOf, newGame } from './fixture';

/**
 * Fixture minors: Sages (technology + influence; +20% research), Wardens
 * (protection + neighbours; +50% garrison), Pilots (+1 range), Bards (+6 morale),
 * Blades (+20% attack). Start attitude 30, join at 80 after 3 turns ahead.
 * Protection +4, technology +3, neighbours +2 a turn; influence 5 intel a point.
 */
function setup(race = 'sages') {
  const { state, content } = newGame(5);
  const home = homeOf(state, ALPHA);
  const taken = new Set(Object.values(state.systems).map((s) => sectorKey(s.sector)));
  const sector = [-1, 0, 1]
    .flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: home.sector.x + dx, y: home.sector.y + dy })))
    .find((s) => s.x >= 0 && s.y >= 0 && s.x < 8 && s.y < 6 && !taken.has(sectorKey(s)))!;
  // Put the minor on an unclaimed system right next to Alpha's home, already met by Alpha.
  const system = Object.values(state.systems).find((s) => !s.colony && !(s.id in state.empires[ALPHA].knownSystems))!;
  system.sector = sector;
  system.planets = [{ type: 'terran', maxPopulation: 12, foodBonus: 10, energyBonus: 0 }];
  system.minor = { race: race as MinorId, population: 8, attitude: { [ALPHA]: 30 }, leader: null, leadTurns: 0 };
  state.empires[ALPHA].knownSystems[system.id] = null;
  state.empires[ALPHA].intelPool = 200;

  const apply = (s: GameState, cmd: Command): GameState => {
    const r = submitCommand(s, cmd, content);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.value;
  };
  const codeOf = (s: GameState, cmd: Command) => {
    const r = submitCommand(s, cmd, content);
    return r.ok ? 'ok' : r.error.code;
  };
  const court = (points: number): Command => ({ type: 'courtMinor', empire: ALPHA, system: system.id, points });
  const at = (s: GameState): StarSystem => s.systems[system.id];
  return { state, content, home, system, apply, codeOf, court, at };
}

describe('placing minor races', () => {
  it('places the preset number on roomy unclaimed systems, the same way for the same seed', () => {
    const { state, content } = newGame(3, 'peopled');
    const minors = Object.values(state.systems).filter((s) => s.minor);
    expect(minors).toHaveLength(2);
    for (const s of minors) {
      expect(s.colony).toBeNull();
      expect(content.minors[s.minor!.race]).toBeDefined();
      expect(s.minor!.population).toBeGreaterThan(0);
      expect(s.minor).toMatchObject({ attitude: {}, leader: null, leadTurns: 0 });
    }
    expect(new Set(minors.map((s) => s.minor!.race)).size).toBe(2);
    expect(newGame(3, 'peopled').state).toEqual(state);
    expect(checkInvariants(state, content)).toEqual([]);
  });

  it('places none, and uses no rolls, when the preset asks for none', () => {
    const plain = newGame(3).state;
    expect(Object.values(plain.systems).some((s) => s.minor)).toBe(false);
  });

  it('cannot be colonised', () => {
    const { state, content, codeOf, system } = setup();
    const fleet = addFleet(state, content, ALPHA, system.sector, ['colony_ship']);
    expect(codeOf(state, { type: 'coloniseSystem', empire: ALPHA, fleet: fleet.id, system: system.id })).toBe('cannotColonise');
  });
});

describe('attitude', () => {
  it('begins at the starting attitude when an empire first finds the minor', () => {
    const { state, content, at } = setup();
    expect(at(state).minor!.attitude[BETA]).toBeUndefined();
    state.empires[BETA].knownSystems[at(state).id] = null;
    const next = processTurn(state, content).state;
    expect(at(next).minor!.attitude[BETA]).toBe(30);
  });

  it('rises each turn for each want that is met, and only for wants the minor has', () => {
    const { state, content, home, system } = setup('wardens'); // protection + neighbours
    // Alpha's home is next door: neighbours +2.
    expect(attitudeChange(state, system, ALPHA, content)).toEqual({
      total: 2,
      lines: [{ source: 'Neighbours: you have a colony close by', kind: 'flat', value: 2 }],
    });
    addFleet(state, content, ALPHA, system.sector, ['frigate']);
    expect(attitudeChange(state, system, ALPHA, content).total).toBe(6);
    // Technology means nothing to the Wardens.
    state.empires[ALPHA].research.levels.weapons = 5;
    expect(attitudeChange(state, system, ALPHA, content).total).toBe(6);
    expect(processTurn(state, content).state.systems[system.id].minor!.attitude[ALPHA]).toBe(36);
    expect(home.colony).not.toBeNull();
  });

  it('counts only an armed ship as protection', () => {
    const { state, content, system } = setup('wardens');
    addFleet(state, content, ALPHA, system.sector, ['scout']);
    expect(attitudeChange(state, system, ALPHA, content).total).toBe(2);
  });

  it('rewards the favoured technology at the level that impresses', () => {
    const { state, content, system } = setup('sages'); // computing 1
    expect(attitudeChange(state, system, ALPHA, content).total).toBe(0);
    state.empires[ALPHA].research.levels.computing = 1;
    expect(attitudeChange(state, system, ALPHA, content).lines).toEqual([
      { source: 'Technology: Computing level 1 or better', kind: 'flat', value: 3 },
    ]);
  });

  it('fades back toward the starting attitude without attention', () => {
    const { state, content, system, at } = setup('sages');
    system.minor!.attitude[ALPHA] = 50;
    expect(attitudeChange(state, system, ALPHA, content).lines).toContainEqual({ source: 'Interest fades without attention', kind: 'flat', value: -1 });
    expect(at(processTurn(state, content).state).minor!.attitude[ALPHA]).toBe(49);
    system.minor!.attitude[ALPHA] = 30;
    expect(attitudeChange(state, system, ALPHA, content).total).toBe(0);
  });

  it('stays within 0 and 100', () => {
    const { state, content, system, at, apply, court } = setup('sages');
    system.minor!.attitude[ALPHA] = 98;
    expect(at(apply(state, court(50))).minor!.attitude[ALPHA]).toBe(100);
    expect(checkInvariants(apply(state, court(50)), content).filter((p) => p.includes('attitude'))).toEqual([]);
  });
});

describe('courting with influence', () => {
  it('spends intel for attitude, twice as well with a minor that wants influence', () => {
    const { state, apply, court, at } = setup('sages'); // wants influence
    const next = apply(state, court(25));
    expect(next.empires[ALPHA].intelPool).toBe(175);
    expect(at(next).minor!.attitude[ALPHA]).toBe(40); // 5 steps x 2
    expect(at(state).minor!.attitude[ALPHA]).toBe(30);

    const wardens = setup('wardens'); // does not want influence
    expect(wardens.at(wardens.apply(wardens.state, wardens.court(25))).minor!.attitude[ALPHA]).toBe(35);
  });

  it('rejects courting with too little, more than the pool, or no minor to court', () => {
    const { state, codeOf, court, home } = setup();
    expect(codeOf(state, court(4))).toBe('cannotCourt');
    expect(codeOf(state, court(2.5))).toBe('cannotCourt');
    expect(codeOf(state, court(205))).toBe('cannotCourt');
    expect(codeOf(state, { type: 'courtMinor', empire: ALPHA, system: home.id, points: 10 })).toBe('cannotCourt');
    expect(codeOf(state, { ...court(10), empire: BETA } as Command)).toBe('unknownSystem'); // Beta has not found it
  });
});

describe('joining', () => {
  it('joins the empire that stays over the threshold and ahead for three turns', () => {
    const { state, content, system, at } = setup('sages');
    system.minor!.attitude[ALPHA] = 85;
    state.empires[ALPHA].research.levels.computing = 1; // +3 a turn keeps it there
    let s = state;
    const events = [];
    for (let i = 0; i < 2; i++) {
      s = processTurn(s, content).state;
      expect(at(s).minor).toMatchObject({ leader: ALPHA, leadTurns: i + 1 });
      expect(at(s).colony).toBeNull();
    }
    const step = processTurn(s, content);
    s = step.state;
    events.push(...step.events);

    expect(events).toContainEqual({ type: 'minorJoined', empire: ALPHA, system: system.id, race: 'sages' });
    expect(at(s).minor).toBeNull();
    expect(at(s).colony).toMatchObject({ owner: ALPHA, population: 8, minorRace: 'sages', governor: 'balanced' });
    expect(s.empires[ALPHA].members).toEqual(['sages']);
    expect(coloniesOf(s, ALPHA)).toHaveLength(2);
    expect(colonyOf(s, ALPHA).moraleEffects).toContainEqual({ source: 'minorJoined', value: 8, turnsLeft: 14 });
    expect(s.empires[ALPHA].knownSystems[system.id]).toBe(ALPHA);
    expect(checkInvariants(s, content)).toEqual([]);
  });

  it('does not join while a rival is level or ahead', () => {
    const { state, content, system, at } = setup('sages');
    system.minor!.attitude = { [ALPHA]: 90, [BETA]: 90 };
    state.empires[BETA].knownSystems[system.id] = null;
    let s = state;
    for (let i = 0; i < 5; i++) s = processTurn(s, content).state;
    expect(at(s).minor).not.toBeNull();

    expect(minorStanding(at(s), ALPHA)).toBe('level');
    at(s).minor!.attitude[BETA] = 95;
    expect(minorStanding(at(s), ALPHA)).toBe('behind');
    expect(minorStanding(at(s), BETA)).toBe('ahead');
    for (let i = 0; i < 4; i++) s = processTurn(s, content).state;
    expect(at(s).colony?.owner).toBe(BETA);
  });

  it('starts the count again if the lead changes hands', () => {
    const { state, content, system, at } = setup('sages');
    system.minor!.attitude = { [ALPHA]: 90, [BETA]: 60 };
    state.empires[BETA].knownSystems[system.id] = null;
    let s = processTurn(state, content).state;
    s = processTurn(s, content).state;
    expect(at(s).minor!.leadTurns).toBe(2);
    at(s).minor!.attitude[BETA] = 100;
    s = processTurn(s, content).state;
    expect(at(s).minor).toMatchObject({ leader: BETA, leadTurns: 1 });
    expect(minorStanding(at(s), ALPHA)).toBe('behind');
  });
});

describe('membership bonuses', () => {
  const joined = (race: string) => {
    const ctx = setup(race);
    ctx.system.minor!.attitude[ALPHA] = 100;
    ctx.system.minor!.leader = ALPHA;
    ctx.system.minor!.leadTurns = 2;
    const state = processTurn(ctx.state, ctx.content).state;
    return { ...ctx, state };
  };

  it('output: a percent line in every colony of the empire', () => {
    const { state, content } = joined('sages');
    const research = getOutputs(state, homeOf(state, ALPHA).id, content).research;
    expect(research.lines).toContainEqual({ source: 'Sages membership', kind: 'percent', value: 20 });
    expect(getOutputs(state, homeOf(state, BETA).id, content).research.lines.some((l) => l.source.includes('membership'))).toBe(false);
  });

  it('morale: points in every colony', () => {
    const { state, content } = joined('bards');
    expect(moraleBreakdown(state, homeOf(state, ALPHA), content).lines).toContainEqual({ source: 'Bards membership', kind: 'flat', value: 6 });
  });

  it('range, attack and garrison', () => {
    const pilots = joined('pilots');
    expect(empireRange(pilots.state, ALPHA, pilots.content)).toBe(3);
    expect(empireRange(pilots.state, BETA, pilots.content)).toBe(2);

    const blades = joined('blades');
    expect(combatBonuses(blades.state, ALPHA, blades.content).attack).toBe(20);

    const wardens = joined('wardens');
    const garrison = garrisonStrength(homeOf(wardens.state, ALPHA), wardens.content, wardens.state);
    expect(garrison.lines).toContainEqual({ source: 'Wardens membership', kind: 'percent', value: 50 });
    expect(garrison.total).toBe(15); // 10 population + 50%
  });

  it('is lost by everyone if the member world is captured', () => {
    const { state, content, system } = joined('sages');
    content.rules.fleets.baseRange = 20;
    state.wars[`${ALPHA}|${BETA}`] = 0;
    state.empires[BETA].knownSystems[system.id] = ALPHA;
    const fleet = addFleet(state, content, BETA, system.sector, ['transport', 'transport', 'transport']);
    const order = submitCommand(state, { type: 'invadeSystem', empire: BETA, fleet: fleet.id, system: system.id }, content);
    if (!order.ok) throw new Error(order.error.message);
    const next = processTurn(order.value, content).state;
    expect(next.systems[system.id].colony).toMatchObject({ owner: BETA, minorRace: null });
    expect(next.empires[ALPHA].members).toEqual([]);
    expect(next.empires[BETA].members).toEqual([]);
    expect(checkInvariants(next, content).filter((p) => p.includes('member'))).toEqual([]);
  });
});

describe('conquering a minor race', () => {
  it('shows its garrison: population plus its militia', () => {
    const { state, content, system } = setup('wardens');
    expect(minorGarrison(state.systems[system.id], content)).toEqual({
      total: 18,
      lines: [
        { source: 'Population 8', kind: 'base', value: 8 },
        { source: 'Wardens militia', kind: 'flat', value: 10 },
      ],
    });
  });

  it('takes the world without a declaration of war, but gains no bonus and pays in morale and reputation', () => {
    const { state, content, system, apply } = setup('sages'); // garrison 8 + 4 = 12
    const other = Object.values(state.systems).find((s) => !s.colony && !s.minor)!;
    other.minor = { race: 'bards' as MinorId, population: 6, attitude: { [ALPHA]: 50 }, leader: null, leadTurns: 0 };
    const fleet = addFleet(state, content, ALPHA, system.sector, ['transport', 'transport']); // 20 troops
    const { state: next, events } = processTurn(apply(state, { type: 'invadeSystem', empire: ALPHA, fleet: fleet.id, system: system.id }), content);

    expect(events).toContainEqual({ type: 'minorConquered', empire: ALPHA, system: system.id, race: 'sages' });
    const report = events.flatMap((e) => (e.type === 'invasion' ? [e.report] : []))[0];
    expect(report).toMatchObject({ attacker: ALPHA, defender: null, minor: 'sages', captured: true, populationLost: 2 });
    expect(next.systems[system.id]).toMatchObject({ minor: null, colony: { owner: ALPHA, population: 6, minorRace: null } });
    expect(next.empires[ALPHA].members).toEqual([]);
    expect(next.fleets[fleet.id]).toBeUndefined();

    // Morale: the empire is ashamed, the conquered world resentful.
    expect(colonyOf(next, ALPHA).moraleEffects).toContainEqual({ source: 'minorConquered', value: -10, turnsLeft: 14 });
    expect(next.systems[system.id].colony!.morale).toBe(60); // 100 - 10 - 30
    // Reputation: other minors think less of the conqueror.
    expect(next.systems[other.id].minor!.attitude[ALPHA]).toBeLessThan(40);
  });

  it('fails against a strong militia, and the troops are still spent', () => {
    const { state, content, system, apply } = setup('wardens'); // garrison 18
    const fleet = addFleet(state, content, ALPHA, system.sector, ['transport']); // 10 troops
    const { state: next, events } = processTurn(apply(state, { type: 'invadeSystem', empire: ALPHA, fleet: fleet.id, system: system.id }), content);
    expect(events.some((e) => e.type === 'minorConquered')).toBe(false);
    expect(next.systems[system.id].minor).not.toBeNull();
    expect(next.fleets[fleet.id]).toBeUndefined();
  });
});

describe('fog of war', () => {
  it('shows an empire its own standing with a minor but not its rivals', () => {
    const { state, content, system } = setup('sages');
    system.minor!.attitude = { [ALPHA]: 40, [BETA]: 95 };
    system.minor!.leader = BETA;
    system.minor!.leadTurns = 2;
    const known = redactFor(state, ALPHA, content).systems[system.id].minor!;
    expect(known).toEqual({ race: 'sages', population: 8, attitude: { [ALPHA]: 40 }, leader: null, leadTurns: 0 });
    // Beta has not scanned the system, so it does not know the minor exists.
    expect(redactFor(state, BETA, content).systems[system.id].minor).toBeNull();
  });
});
