import { describe, expect, it } from 'vitest';
import {
  battlesAhead,
  createTacticalBattle,
  orderTactical,
  practiceSetup,
  processTurn,
  runTactical,
  sectorKey,
  stepTactical,
  tacticalOptionsFor,
  tacticalOutcome,
  tacticalResult,
  tacticalTally,
  warKey,
  type CombatReport,
  type Content,
  type EmpireId,
  type Fleet,
  type GameState,
  type Sector,
  type TacticalBattle,
  type TurnEvent,
} from '../src/sim';
import { ALPHA, BETA, addFleet, fixtureContent, homeOf, newGame } from './fixture';

const content = fixtureContent();
const options = (player: EmpireId | null = null, seed = 7) => ({ wars: [[ALPHA, BETA]] as [EmpireId, EmpireId][], player, seed });

function practice(a: string[], b: string[], batteries = 0, player: EmpireId | null = null): TacticalBattle {
  return createTacticalBattle(
    practiceSetup(content, [
      { empire: ALPHA, hulls: a, batteries },
      { empire: BETA, hulls: b, batteries: 0 },
    ]),
    content,
    options(player),
  );
}

const unitsOf = (battle: TacticalBattle, empire: EmpireId) => battle.units.filter((u) => u.empire === empire);
const ids = (battle: TacticalBattle, empire: EmpireId) => unitsOf(battle, empire).map((u) => u.id);

describe('a commanded battle on its own', () => {
  it('draws each side up at its own edge, warships in front', () => {
    const battle = practice(['scout', 'frigate'], ['frigate']);
    const scout = unitsOf(battle, ALPHA).find((u) => u.role === 'scout')!;
    const frigate = unitsOf(battle, ALPHA).find((u) => u.role === 'warship')!;
    expect(battle.sides.map((s) => s.edge)).toEqual(['left', 'right']);
    expect(frigate.x).toBeGreaterThan(scout.x);
    expect(unitsOf(battle, BETA)[0].x).toBeGreaterThan(battle.width / 2);
  });

  it('fights until one side has nothing left, hitting as hard as an auto-resolved round', () => {
    const battle = practice(['frigate', 'frigate', 'frigate'], ['frigate']);
    battle.sides[1].commander = 'player'; // a player who gives no orders: nobody withdraws for it
    const hits: number[] = [];
    while (!battle.over) {
      stepTactical(battle, content);
      hits.push(...battle.shots.map((s) => s.damage));
    }
    // Frigate attack 10 against defence 2 at the fixture's fixed full roll.
    expect(new Set(hits)).toEqual(new Set([8]));
    expect(battle.finished).toBe(true);
    const [alpha, beta] = tacticalTally(battle);
    expect(beta).toMatchObject({ active: 0, destroyed: 1 });
    expect(alpha.active).toBeGreaterThan(0);
    expect(tacticalResult(battle, ALPHA)).toBe('won');
    expect(tacticalResult(battle, BETA)).toBe('lost');
  });

  it('plays out the same way from the same seed, and survives a JSON round trip midway', () => {
    const a = practice(['frigate', 'destroyer'], ['frigate', 'frigate', 'frigate']);
    const b = practice(['frigate', 'destroyer'], ['frigate', 'frigate', 'frigate']);
    for (let i = 0; i < 100; i++) stepTactical(b, content);
    const copy = JSON.parse(JSON.stringify(b)) as TacticalBattle;
    runTactical(a, content);
    runTactical(copy, content);
    expect(tacticalOutcome(copy)).toEqual(tacticalOutcome(a));
    expect(copy.tick).toBe(a.tick);
  });

  it('lets a side withdraw through its own edge, which ends the battle', () => {
    const battle = practice(['frigate', 'frigate'], ['destroyer', 'destroyer'], 0, ALPHA);
    expect(orderTactical(battle, ALPHA, ids(battle, ALPHA), { kind: 'withdraw' })).toBe(2);
    runTactical(battle, content);
    const outcome = tacticalOutcome(battle);
    const mine = outcome.units.filter((u) => ids(battle, ALPHA).includes(u.id));
    expect(mine.every((u) => u.withdrawn || u.hp === 0)).toBe(true);
    expect(mine.some((u) => u.withdrawn)).toBe(true);
    expect(battle.finished).toBe(true);
    expect(tacticalResult(battle, ALPHA)).toBe('withdrew');
  });

  it('has a computer-led side withdraw once it is badly outgunned', () => {
    const battle = practice(['destroyer', 'destroyer', 'destroyer', 'destroyer'], ['frigate']);
    runTactical(battle, content);
    expect(unitsOf(battle, BETA)[0].status).toBe('withdrawn');
  });

  it('takes orders only for the empire’s own active units, and attacks only on enemies', () => {
    const battle = practice(['frigate'], ['frigate'], 0, ALPHA);
    const [mine] = ids(battle, ALPHA);
    const [theirs] = ids(battle, BETA);
    expect(orderTactical(battle, ALPHA, [theirs], { kind: 'hold' })).toBe(0);
    expect(orderTactical(battle, ALPHA, [mine], { kind: 'attack', target: mine })).toBe(0);
    expect(orderTactical(battle, ALPHA, [mine], { kind: 'attack', target: theirs })).toBe(1);
    expect(orderTactical(battle, ALPHA, [mine], { kind: 'move', x: -500, y: 300 })).toBe(1);
    expect(unitsOf(battle, ALPHA)[0].order).toEqual({ kind: 'move', x: 0, y: 300 });
  });

  it('flies to a point and holds there', () => {
    const battle = practice(['frigate'], ['frigate'], 0, ALPHA);
    const [mine] = unitsOf(battle, ALPHA);
    orderTactical(battle, ALPHA, [mine.id], { kind: 'move', x: mine.x, y: mine.y + 100 });
    for (let i = 0; i < 200 && mine.order.kind === 'move'; i++) stepTactical(battle, content);
    expect(mine.order).toEqual({ kind: 'hold' });
  });

  it('places batteries around the defender’s planet; they never move', () => {
    const battle = practice(['frigate'], ['destroyer', 'destroyer'], 2);
    const batteries = battle.units.filter((u) => u.role === 'battery');
    expect(battle.planet).not.toBeNull();
    expect(batteries).toHaveLength(2);
    const at = batteries.map((b) => [b.x, b.y]);
    for (let i = 0; i < 60; i++) stepTactical(battle, content);
    expect(batteries.map((b) => [b.x, b.y])).toEqual(at);
    expect(orderTactical(battle, ALPHA, batteries.map((b) => b.id), { kind: 'withdraw' })).toBe(0);
  });

  it('stops at the time limit if nobody closes, and says the battle is not finished', () => {
    const quick = structuredClone(content) as Content;
    quick.rules.combat.tactical.maxSeconds = 2;
    const battle = createTacticalBattle(
      practiceSetup(quick, [
        { empire: ALPHA, hulls: ['frigate'], batteries: 0 },
        { empire: BETA, hulls: ['frigate'], batteries: 0 },
      ]),
      quick,
      options(ALPHA),
    );
    battle.sides[1].commander = 'player';
    orderTactical(battle, ALPHA, ids(battle, ALPHA), { kind: 'hold' });
    orderTactical(battle, BETA, ids(battle, BETA), { kind: 'hold' });
    runTactical(battle, quick);
    expect(battle.tick).toBe(2 * battle.ticksPerSecond);
    expect(battle.finished).toBe(false);
    expect(tacticalResult(battle, ALPHA)).toBe('unfinished');
  });
});

/** Two fleets at war in an empty sector next to Alpha's home. */
function atWarIn(seed = 5) {
  const { state, content } = newGame(seed);
  const home = homeOf(state, ALPHA);
  const taken = new Set(Object.values(state.systems).map((s) => sectorKey(s.sector)));
  const arena: Sector = [-1, 0, 1]
    .flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: home.sector.x + dx, y: home.sector.y + dy })))
    .find((s) => s.x >= 0 && s.y >= 0 && s.x < 8 && s.y < 6 && !taken.has(sectorKey(s)))!;
  state.wars[warKey(ALPHA, BETA)] = 0;
  const a = addFleet(state, content, ALPHA, arena, ['frigate', 'frigate']);
  const b = addFleet(state, content, BETA, arena, ['frigate']);
  return { state, content, arena, a, b };
}

const battleReports = (events: TurnEvent[]): CombatReport[] => events.flatMap((e) => (e.type === 'battle' ? [e.report] : []));
const hulls = (state: GameState, fleet: Fleet) => state.fleets[fleet.id]?.ships.map((s) => s.hp) ?? null;

describe('battles ahead and commanded results', () => {
  it('lists the coming battle without changing the state', () => {
    const { state, content, arena, a, b } = atWarIn();
    const before = JSON.stringify(state);
    const [setup, ...rest] = battlesAhead(state, content);
    expect(JSON.stringify(state)).toBe(before);
    expect(rest).toEqual([]);
    expect(setup.key).toBe(sectorKey(arena));
    expect(setup.units.map((u) => u.id).sort()).toEqual([...a.ships, ...b.ships].map((s) => s.id).sort());
  });

  it('takes a commanded result in place of rolling, and marks the report as commanded', () => {
    const { state, content, a, b } = atWarIn();
    const [setup] = battlesAhead(state, content);
    const battle = createTacticalBattle(setup, content, tacticalOptionsFor(state, setup, ALPHA));
    runTactical(battle, content);
    const outcome = tacticalOutcome(battle);
    const { state: next, events } = processTurn(state, content, { commandedBattles: { [setup.key]: outcome } });
    const [report] = battleReports(events);
    expect(report.commanded).toBe(true);
    expect(report.rounds).toEqual([]);
    const left = (fleet: Fleet) => fleet.ships.map((s) => outcome.units.find((u) => u.id === s.id)!.hp).filter((hp) => hp > 0);
    expect(hulls(next, a) ?? []).toEqual(left(a));
    expect(hulls(next, b)).toBeNull(); // Beta's lone frigate is lost
  });

  it('can never raise a hull, and ignores a result that does not match the battle', () => {
    const { state, content, a, b } = atWarIn();
    const [setup] = battlesAhead(state, content);
    const everyone = setup.units.map((u) => ({ id: u.id, hp: 999, withdrawn: false }));
    const healed = processTurn(state, content, { commandedBattles: { [setup.key]: { units: everyone, finished: true } } });
    expect(hulls(healed.state, a)).toEqual([30, 30]);
    expect(battleReports(healed.events)[0].commanded).toBe(true);

    const short = processTurn(state, content, { commandedBattles: { [setup.key]: { units: everyone.slice(1), finished: true } } });
    expect(battleReports(short.events)[0].commanded).toBe(false);
    expect(battleReports(short.events)[0].rounds.length).toBeGreaterThan(0);
    expect(b.ships).toHaveLength(1);
  });

  it('sends the fleets of a side that withdrew back towards home', () => {
    const { state, content, arena, a } = atWarIn();
    const [setup] = battlesAhead(state, content);
    const units = setup.units.map((u) => ({ id: u.id, hp: u.hp, withdrawn: u.empire === ALPHA }));
    const { state: next, events } = processTurn(state, content, { commandedBattles: { [setup.key]: { units, finished: true } } });
    expect(next.fleets[a.id].sector).not.toEqual(arena);
    expect(next.fleets[a.id].ships.map((s) => s.hp)).toEqual([30, 30]);
    expect(battleReports(events)[0].sides.find((s) => s.empire === ALPHA)!.after).toBe(2);
  });
});
