import { describe, expect, it } from 'vitest';
import {
  atWar,
  checkInvariants,
  coloniesOf,
  combatBonuses,
  deserialize,
  fleetsOf,
  garrisonStrength,
  getEmpireView,
  processTurn,
  sectorKey,
  serialize,
  submitCommand,
  troopStrength,
  validateContent,
  warKey,
  type BuildingId,
  type CombatReport,
  type Command,
  type Content,
  type Fleet,
  type GameState,
  type InvasionReport,
  type Sector,
  type TurnEvent,
} from '../src/sim';
import { ALPHA, BETA, addFleet, colonyOf, homeOf, newGame, rawFixture } from './fixture';

/**
 * Fixture combat numbers (rolls are fixed at 100% unless a test changes that):
 *   frigate   attack 10, defence 2, hull 30   -> a frigate does 8 to a frigate
 *   destroyer attack 20, defence 4, hull 50   -> 18 to a frigate; a frigate does 6 to it
 *   scout, colony ship, transport: unarmed, defence 0, hull 10 / 20 / 20
 *   battery   attack 12, hull 40
 */
function setup(seed = 5) {
  const { state, content } = newGame(seed);
  const home = homeOf(state, ALPHA);
  const taken = new Set(Object.values(state.systems).map((s) => sectorKey(s.sector)));
  // An empty sector next to Alpha's home: inside Alpha's supply, outside Beta's.
  const arena = [-1, 0, 1]
    .flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: home.sector.x + dx, y: home.sector.y + dy })))
    .find((s) => s.x >= 0 && s.y >= 0 && s.x < 8 && s.y < 6 && !taken.has(sectorKey(s)))!;
  const war = (s: GameState) => {
    s.wars[warKey(ALPHA, BETA)] = 0;
    return s;
  };
  const apply = (s: GameState, cmd: Command): GameState => {
    const r = submitCommand(s, cmd, content);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.value;
  };
  const codeOf = (s: GameState, cmd: Command) => {
    const r = submitCommand(s, cmd, content);
    return r.ok ? 'ok' : r.error.code;
  };
  return { state, content, home, arena, war, apply, codeOf };
}

const battles = (events: TurnEvent[]): CombatReport[] => events.flatMap((e) => (e.type === 'battle' ? [e.report] : []));
const invasions = (events: TurnEvent[]): InvasionReport[] => events.flatMap((e) => (e.type === 'invasion' ? [e.report] : []));
const hulls = (state: GameState, fleet: Fleet) => state.fleets[fleet.id]?.ships.map((s) => `${s.hull}:${s.hp}`) ?? [];

/** Beta's fleets fight outside Beta's supply range in these tests, which the invariants would flag. */
function place(state: GameState, content: Content, owner: typeof ALPHA, sector: Sector, ships: string[], stance: Fleet['stance'] = 'engage') {
  const fleet = addFleet(state, content, owner, sector, ships);
  fleet.stance = stance;
  return fleet;
}

describe('war and peace', () => {
  it('starts at peace, and fleets at peace do not fight', () => {
    const { state, content, arena } = setup();
    const a = place(state, content, ALPHA, arena, ['frigate']);
    const b = place(state, content, BETA, arena, ['frigate']);
    expect(atWar(state, ALPHA, BETA)).toBe(false);
    const { state: next, events } = processTurn(state, content);
    expect(battles(events)).toEqual([]);
    expect(hulls(next, a)).toEqual(['frigate:30']);
    expect(hulls(next, b)).toEqual(['frigate:30']);
  });

  it('declares war for both sides and announces it when the turn resolves', () => {
    const { state, content, apply, codeOf } = setup();
    const s = apply(state, { type: 'declareWar', empire: ALPHA, on: BETA });
    expect(atWar(s, ALPHA, BETA)).toBe(true);
    expect(atWar(s, BETA, ALPHA)).toBe(true);
    expect(atWar(state, ALPHA, BETA)).toBe(false);
    expect(codeOf(s, { type: 'declareWar', empire: BETA, on: ALPHA })).toBe('badWar');
    expect(codeOf(state, { type: 'declareWar', empire: ALPHA, on: ALPHA })).toBe('badWar');
    expect(codeOf(state, { type: 'declareWar', empire: ALPHA, on: 'emp-9' as never })).toBe('badWar');

    const first = processTurn(s, content);
    expect(first.events).toContainEqual({ type: 'warDeclared', by: ALPHA, on: BETA });
    expect(processTurn(first.state, content).events.some((e) => e.type === 'warDeclared')).toBe(false);
  });

  it('keeps wars through save and load', () => {
    const { state, apply } = setup();
    const loaded = deserialize(serialize(apply(state, { type: 'declareWar', empire: ALPHA, on: BETA })));
    expect(loaded.ok && atWar(loaded.value, ALPHA, BETA)).toBe(true);
  });
});

describe('battles', () => {
  it('trades simultaneous fire and keeps the damage', () => {
    const { state, content, arena, war } = setup();
    const a = place(war(state), content, ALPHA, arena, ['frigate']);
    const b = place(state, content, BETA, arena, ['frigate']);
    const { state: next, events } = processTurn(state, content);
    // 8 damage a round each way; both die in round 4 (30 hull).
    const [report] = battles(events);
    expect(report.rounds).toHaveLength(4);
    expect(report.rounds[0]).toEqual([
      { attacker: a.ships[0].id, target: b.ships[0].id, roll: 100, damage: 8, destroyed: false },
      { attacker: b.ships[0].id, target: a.ships[0].id, roll: 100, damage: 8, destroyed: false },
    ]);
    expect(report.rounds[3].every((shot) => shot.destroyed)).toBe(true);
    expect(report.sides).toEqual([
      { empire: ALPHA, before: 1, after: 0 },
      { empire: BETA, before: 1, after: 0 },
    ]);
    expect(report.outcome).toBe('decided');
    expect(next.fleets[a.id]).toBeUndefined();
    expect(next.fleets[b.id]).toBeUndefined();
  });

  it('carries an unfinished battle into the next turn', () => {
    const { state, content, arena, war } = setup();
    const a = place(war(state), content, ALPHA, arena, ['destroyer']);
    const b = place(state, content, BETA, arena, ['destroyer']);
    // Destroyers do 16 to each other, so a 50-hull ship lasts four rounds: two turns at two rounds a turn.
    content.rules.combat.maxRounds = 2;
    const first = processTurn(state, content);
    expect(battles(first.events)[0].outcome).toBe('ongoing');
    expect(hulls(first.state, a)).toEqual(['destroyer:18']);
    expect(hulls(first.state, b)).toEqual(['destroyer:18']);
    const second = processTurn(first.state, content);
    expect(battles(second.events)[0].outcome).toBe('decided');
    expect(second.state.fleets[a.id]).toBeUndefined();
  });

  it('stops as soon as one side is gone and leaves the winner damaged', () => {
    const { state, content, arena, war } = setup();
    const a = place(war(state), content, ALPHA, arena, ['destroyer']);
    const b = place(state, content, BETA, arena, ['frigate']);
    const { state: next, events } = processTurn(state, content);
    // Destroyer does 18 a round: the frigate (30) dies in round 2, having done 6 twice.
    const [report] = battles(events);
    expect(report.rounds).toHaveLength(2);
    expect(hulls(next, a)).toEqual(['destroyer:38']);
    expect(next.fleets[b.id]).toBeUndefined();
    expect(report.sides).toEqual([
      { empire: ALPHA, before: 1, after: 1 },
      { empire: BETA, before: 1, after: 0 },
    ]);
    expect(checkInvariants(next, content)).toEqual([]);
  });

  it('lists every unit that took part', () => {
    const { state, content, arena, war } = setup();
    place(war(state), content, ALPHA, arena, ['frigate', 'scout']);
    place(state, content, BETA, arena, ['frigate']);
    const [report] = battles(processTurn(state, content).events);
    expect(report.units.map((u) => `${u.empire}:${u.name}`).sort()).toEqual(['emp-1:Frigate', 'emp-1:Scout', 'emp-2:Frigate']);
  });

  it('needs someone able to shoot', () => {
    const { state, content, arena, war } = setup();
    place(war(state), content, ALPHA, arena, ['scout']);
    place(state, content, BETA, arena, ['colony_ship']);
    expect(battles(processTurn(state, content).events)).toEqual([]);
  });

  it('engage goes for armed ships first', () => {
    const { state, content, arena, war } = setup();
    content.rules.combat.maxRounds = 2;
    const engaging = structuredClone(war(state));
    place(engaging, content, ALPHA, arena, ['destroyer'], 'engage');
    const convoyA = place(engaging, content, BETA, arena, ['frigate', 'transport']);
    const afterEngage = processTurn(engaging, content).state;
    // Both rounds go into the frigate (18 a round against 30 hull); the transport is untouched.
    expect(hulls(afterEngage, convoyA)).toEqual(['transport:20']);
  });

  it('raiders destroy the transport while the warship is untouched', () => {
    const { state, content, arena, war } = setup();
    content.rules.combat.maxRounds = 1;
    place(war(state), content, ALPHA, arena, ['destroyer'], 'raid');
    const convoy = place(state, content, BETA, arena, ['frigate', 'transport']);
    const next = processTurn(state, content).state;
    expect(hulls(next, convoy)).toEqual(['frigate:30']); // 20 damage against 20 hull
  });

  it('an escort draws raiders onto itself', () => {
    const { state, content, arena, war } = setup();
    content.rules.combat.maxRounds = 1;
    place(war(state), content, ALPHA, arena, ['destroyer'], 'raid');
    const convoy = place(state, content, BETA, arena, ['frigate', 'transport'], 'escort');
    const next = processTurn(state, content).state;
    expect(hulls(next, convoy)).toEqual(['frigate:12', 'transport:20']);
  });

  it('an evading fleet takes one round at half damage, does not fire, and falls back toward home', () => {
    const { state, content, home, arena, war } = setup();
    const runner = place(war(state), content, ALPHA, arena, ['frigate'], 'evade');
    const hunter = place(state, content, BETA, arena, ['destroyer']);
    const { state: next, events } = processTurn(state, content);
    const [report] = battles(events);
    expect(report.rounds).toHaveLength(1);
    expect(report.rounds[0]).toEqual([{ attacker: hunter.ships[0].id, target: runner.ships[0].id, roll: 100, damage: 9, destroyed: false }]);
    expect(hulls(next, runner)).toEqual(['frigate:21']);
    expect(hulls(next, hunter)).toEqual(['destroyer:50']);
    expect(next.fleets[runner.id].sector).toEqual(home.sector);
    expect(report.outcome).toBe('decided');
  });

  it('applies research: weapons add attack, energy shields reduce damage', () => {
    const { state, content, arena, war } = setup();
    state.empires[ALPHA].research.levels.weapons = 5; // +50% attack -> 15
    state.empires[BETA].research.levels.energy = 5; // 50% shield
    expect(combatBonuses(state, ALPHA, content)).toEqual({ attack: 50, shield: 0 });
    expect(combatBonuses(state, BETA, content)).toEqual({ attack: 0, shield: 50 });
    content.rules.combat.maxRounds = 1;
    const a = place(war(state), content, ALPHA, arena, ['frigate']);
    const b = place(state, content, BETA, arena, ['frigate']);
    const next = processTurn(state, content).state;
    expect(hulls(next, b)).toEqual(['frigate:24']); // (15 - 2) halved = 6
    expect(hulls(next, a)).toEqual(['frigate:22']); // 10 - 2 = 8
  });

  it('uses seeded rolls: the same state gives the same battle, and rolls vary within range', () => {
    const { state, content, arena, war } = setup();
    content.rules.combat.minRollPercent = 50;
    place(war(state), content, ALPHA, arena, ['frigate', 'frigate', 'destroyer']);
    place(state, content, BETA, arena, ['frigate', 'frigate', 'destroyer']);
    const once = processTurn(state, content);
    const again = processTurn(state, content);
    expect(once.events).toEqual(again.events);
    expect(once.state).toEqual(again.state);
    const rolls = battles(once.events)[0].rounds.flat().map((s) => s.roll);
    expect(Math.min(...rolls)).toBeGreaterThanOrEqual(50);
    expect(Math.max(...rolls)).toBeLessThanOrEqual(100);
    expect(new Set(rolls).size).toBeGreaterThan(3);

    const other = structuredClone(state);
    other.rng = [9, 8, 7, 6];
    expect(processTurn(other, content).events).not.toEqual(once.events);
  });

  it('orbital batteries defend their colony and are restored each turn', () => {
    const { state, content, home, war } = setup();
    colonyOf(state, ALPHA).buildings['battery' as BuildingId] = 1;
    const raider = place(war(state), content, BETA, home.sector, ['destroyer']);
    const first = processTurn(state, content);
    const [report] = battles(first.events);
    expect(report.units.map((u) => u.name).sort()).toEqual(['Battery', 'Destroyer']);
    // Battery does 12 - 4 = 8 a round; the destroyer does 20 and kills it (40) in round 2.
    expect(report.rounds).toHaveLength(2);
    expect(hulls(first.state, raider)).toEqual(['destroyer:34']);
    // Next turn the battery is back.
    expect(battles(processTurn(first.state, content).events)[0].rounds[0]).toHaveLength(2);
  });

  it('repairs ships docked at a friendly shipyard, a quarter of the hull a turn', () => {
    const { state, content, home, arena } = setup();
    colonyOf(state, ALPHA).buildings['shipyard' as BuildingId] = 1;
    const docked = place(state, content, ALPHA, home.sector, ['destroyer']);
    const away = place(state, content, ALPHA, arena, ['destroyer']);
    docked.ships[0].hp = 10;
    away.ships[0].hp = 10;
    let s = processTurn(state, content).state;
    expect(hulls(s, docked)).toEqual(['destroyer:23']);
    expect(hulls(s, away)).toEqual(['destroyer:10']);
    for (let i = 0; i < 4; i++) s = processTurn(s, content).state;
    expect(hulls(s, docked)).toEqual(['destroyer:50']);
  });

  it('sets a stance by command, and split fleets keep it', () => {
    const { state, content, home, apply, codeOf } = setup();
    const fleet = place(state, content, ALPHA, home.sector, ['frigate', 'frigate']);
    let s = apply(state, { type: 'setStance', empire: ALPHA, fleet: fleet.id, stance: 'raid' });
    expect(s.fleets[fleet.id].stance).toBe('raid');
    s = apply(s, { type: 'splitFleet', empire: ALPHA, fleet: fleet.id, ships: [fleet.ships[0].id] });
    expect(fleetsOf(s, ALPHA).map((f) => f.stance)).toEqual(['raid', 'raid']);
    expect(codeOf(state, { type: 'setStance', empire: ALPHA, fleet: fleet.id, stance: 'charge' as never })).toBe('badStance');
    expect(codeOf(state, { type: 'setStance', empire: BETA, fleet: fleet.id, stance: 'raid' })).toBe('notOwner');
  });

  it('tells only the empires that fought', () => {
    const { state, content, arena, war } = setup();
    place(war(state), content, ALPHA, arena, ['frigate']);
    place(state, content, BETA, arena, ['frigate']);
    const event = processTurn(state, content).events.find((e) => e.type === 'battle')!;
    expect(event).toMatchObject({ empires: [ALPHA, BETA] });
  });
});

describe('invasion', () => {
  /** Alpha at war, with a fleet sitting on Beta's home. Alpha's supply is stretched to reach it. */
  function siege(ships: string[], prepare?: (s: GameState) => void) {
    const ctx = setup();
    ctx.content.rules.fleets.baseRange = 20;
    const target = homeOf(ctx.state, BETA);
    ctx.war(ctx.state);
    ctx.state.empires[ALPHA].knownSystems[target.id] = BETA;
    prepare?.(ctx.state);
    const fleet = place(ctx.state, ctx.content, ALPHA, target.sector, ships);
    const order: Command = { type: 'invadeSystem', empire: ALPHA, fleet: fleet.id, system: target.id };
    return { ...ctx, target, fleet, order };
  }

  it('shows garrison and troop strength as breakdowns', () => {
    const { state, content, target, fleet } = siege(['transport', 'transport']);
    colonyOf(state, BETA).buildings['barracks' as BuildingId] = 1;
    expect(garrisonStrength(target, content)).toEqual({
      total: 22,
      lines: [
        { source: 'Population 10', kind: 'base', value: 10 },
        { source: 'Barracks x1', kind: 'flat', value: 12 },
      ],
    });
    state.empires[ALPHA].research.levels.weapons = 2;
    expect(troopStrength(state, [fleet], content)).toEqual({
      total: 24,
      lines: [
        { source: '2 transports', kind: 'base', value: 20 },
        { source: 'Weapons research', kind: 'percent', value: 20 },
      ],
    });
  });

  it('captures an undefended colony when the troops outnumber the garrison', () => {
    const { state, content, apply, target, fleet, order } = siege(['transport', 'transport']);
    colonyOf(state, BETA).buildings = { farm: 2, reactor: 1, lab: 1 } as never;
    colonyOf(state, BETA).buildQueue = [{ kind: 'building', building: 'lab' as BuildingId, progress: 5 }];
    const { state: next, events } = processTurn(apply(state, order), content);

    const [report] = invasions(events);
    expect(report).toMatchObject({ system: target.id, attacker: ALPHA, defender: BETA, roll: 100, captured: true, populationLost: 3 });
    expect(report.attack.total).toBe(20);
    expect(report.defence.total).toBe(10);

    const colony = next.systems[target.id].colony!;
    expect(colony.owner).toBe(ALPHA);
    expect(colony.population).toBe(7); // a quarter lost, rounded up
    expect(colony.buildings).toEqual({ farm: 1 }); // half of each, rounded down
    expect(colony.buildQueue).toEqual([]);
    expect(colony.governor).toBe('balanced');
    expect(Object.values(colony.allocation).reduce((a, b) => a + b, 0)).toBe(7);
    expect(next.fleets[fleet.id]).toBeUndefined(); // the transports are spent
    expect(next.empires[ALPHA].knownSystems[target.id]).toBe(ALPHA);
  });

  it('fails against a stronger garrison, and the troops are still spent', () => {
    const { state, content, apply, target, fleet, order } = siege(['transport', 'frigate']);
    const { state: next, events } = processTurn(apply(state, order), content);
    expect(invasions(events)[0]).toMatchObject({ captured: false, populationLost: 0 });
    expect(next.systems[target.id].colony!.owner).toBe(BETA);
    expect(hulls(next, fleet)).toEqual(['frigate:30']);
    expect(next.fleets[fleet.id].order).toBe('none');
  });

  it('cannot land while defending warships hold the sector, and tries again', () => {
    const { state, content, apply, target, fleet, order } = siege(['transport', 'transport', 'transport'], (s) => {
      s.empires[ALPHA].research.levels.energy = 7; // heavy shields keep the transports alive
    });
    const guard = place(state, content, BETA, target.sector, ['destroyer'], 'engage');
    content.rules.combat.maxRounds = 1;
    const first = processTurn(apply(state, order), content);
    expect(invasions(first.events)).toEqual([]);
    expect(first.state.fleets[fleet.id].order).toBe('invade');
    expect(first.state.systems[target.id].colony!.owner).toBe(BETA);

    delete first.state.fleets[guard.id];
    const second = processTurn(first.state, content);
    expect(invasions(second.events)).toHaveLength(1);
  });

  it('must silence orbital batteries first; warships that do so open the way the same turn', () => {
    const blocked = siege(['transport', 'transport']);
    colonyOf(blocked.state, BETA).buildings['battery' as BuildingId] = 1;
    const lost = processTurn(blocked.apply(blocked.state, blocked.order), blocked.content);
    expect(invasions(lost.events)).toEqual([]);
    // 12 a round at unarmed transports with 20 hull: at least one is destroyed.
    expect(lost.state.fleets[blocked.fleet.id]?.ships.length ?? 0).toBeLessThan(2);

    const escorted = siege(['transport', 'transport', 'destroyer', 'destroyer']);
    colonyOf(escorted.state, BETA).buildings['battery' as BuildingId] = 1;
    const won = processTurn(escorted.apply(escorted.state, escorted.order), escorted.content);
    expect(battles(won.events)[0].sides).toContainEqual({ empire: BETA, before: 1, after: 0 });
    expect(invasions(won.events)[0].captured).toBe(true);
  });

  it('rejects invading without transports, at peace, your own colony, or a free system', () => {
    const { state, content, codeOf, home, target, fleet, order } = siege(['transport']);
    const warships = place(state, content, ALPHA, target.sector, ['frigate']);
    expect(codeOf(state, { ...order, fleet: warships.id } as Command)).toBe('cannotInvade');
    expect(codeOf(state, { ...order, system: home.id } as Command)).toBe('cannotInvade');
    const free = Object.values(state.systems).find((s) => !s.colony)!;
    state.empires[ALPHA].knownSystems[free.id] = null;
    expect(codeOf(state, { ...order, system: free.id } as Command)).toBe('cannotInvade');
    expect(codeOf(state, order)).toBe('ok');
    delete state.wars[warKey(ALPHA, BETA)];
    expect(codeOf(state, order)).toBe('cannotInvade');
    expect(fleet.order).toBe('none');
  });

  it('travels to the target before landing', () => {
    const { state, content, apply, home, target } = siege(['frigate']);
    const transports = place(state, content, ALPHA, home.sector, ['transport', 'transport']);
    let s = apply(state, { type: 'invadeSystem', empire: ALPHA, fleet: transports.id, system: target.id });
    expect(s.fleets[transports.id]).toMatchObject({ order: 'invade', destination: target.sector });
    let captured = false;
    for (let i = 0; i < 6 && !captured; i++) {
      const step = processTurn(s, content);
      s = step.state;
      captured = invasions(step.events).some((r) => r.captured);
    }
    expect(captured).toBe(true);
  });
});

describe('elimination and victory', () => {
  it('eliminates an empire that loses its last colony and declares the other the winner', () => {
    const ctx = setup();
    ctx.content.rules.fleets.baseRange = 20;
    const target = homeOf(ctx.state, BETA);
    ctx.war(ctx.state);
    ctx.state.empires[ALPHA].knownSystems[target.id] = BETA;
    const strays = place(ctx.state, ctx.content, BETA, { x: 0, y: 0 }, ['scout']);
    const fleet = place(ctx.state, ctx.content, ALPHA, target.sector, ['transport', 'transport']);
    const s = ctx.apply(ctx.state, { type: 'invadeSystem', empire: ALPHA, fleet: fleet.id, system: target.id });

    const { state: next, events } = processTurn(s, ctx.content);
    expect(events).toContainEqual({ type: 'empireEliminated', empire: BETA });
    expect(events).toContainEqual({ type: 'gameWon', empire: ALPHA });
    expect(next.empires[BETA].eliminated).toBe(true);
    expect(next.winner).toBe(ALPHA);
    expect(next.fleets[strays.id]).toBeUndefined(); // its fleets disband
    expect(coloniesOf(next, ALPHA)).toHaveLength(2);
    expect(checkInvariants(next, ctx.content)).toEqual([]);

    // The game is over: no more commands, and time stops.
    const home = homeOf(next, ALPHA).id;
    expect(ctx.codeOf(next, { type: 'setGovernor', empire: ALPHA, system: home, governor: 'growth' })).toBe('gameOver');
    const after = processTurn(next, ctx.content);
    expect(after.state.turn).toBe(next.turn);
    expect(after.events).toEqual([]);
  });

  it('spares an empire that still has a colony ship', () => {
    const { state, content } = setup();
    homeOf(state, BETA).colony = null;
    place(state, content, BETA, homeOf(state, BETA).sector, ['colony_ship']);
    const next = processTurn(state, content).state;
    expect(next.empires[BETA].eliminated).toBe(false);
    expect(next.winner).toBeNull();
  });

  it('does not end a game that only ever had one empire', () => {
    const { state, content } = setup();
    homeOf(state, BETA).colony = null;
    delete (state.empires as Record<string, unknown>)[BETA];
    expect(processTurn(state, content).state.winner).toBeNull();
  });
});

describe('combat content', () => {
  it('fills in peaceful defaults and rejects bad combat data', () => {
    const errorsFor = (mutate: (raw: any) => void) => {
      const raw = structuredClone(rawFixture);
      mutate(raw);
      const result = validateContent(raw);
      return result.ok ? [] : result.error;
    };
    const ok = validateContent(structuredClone(rawFixture));
    expect(ok.ok && ok.value.buildings['farm' as BuildingId].combat).toEqual({ attack: 0, hp: 0, garrison: 0 });
    expect(ok.ok && ok.value.fields.biology.combat).toEqual({ attackPercent: 0, shieldPercent: 0 });
    expect(errorsFor((r) => (r.rules.combat.maxRounds = 0)).join()).toMatch(/maxRounds/);
    expect(errorsFor((r) => (r.rules.combat.minRollPercent = 0)).join()).toMatch(/minRollPercent/);
    expect(errorsFor((r) => (r.buildings[4].combat = { attack: 5, hp: 0, garrison: 0 })).join()).toMatch(/combat/);
    expect(errorsFor((r) => (r.hulls[0].troops = -1)).join()).toMatch(/troops/);
  });

  it('shows rival fleets and their damage only when in sight', () => {
    const { state, content, arena, war } = setup();
    const enemy = place(war(state), content, BETA, arena, ['destroyer']);
    enemy.ships[0].hp = 7;
    expect(getEmpireView(state, ALPHA, content).fleets.find((f) => f.id === enemy.id)?.ships[0].hp).toBe(7);
    enemy.sector = { ...homeOf(state, BETA).sector };
    expect(getEmpireView(state, ALPHA, content).fleets.some((f) => f.id === enemy.id)).toBe(false);
  });
});
