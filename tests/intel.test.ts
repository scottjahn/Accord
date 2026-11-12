import { describe, expect, it } from 'vitest';
import { createPlanner } from '../src/ai/agent';
import { runEspionage } from '../src/ai/intel';
import {
  addColonyMorale,
  addOpinion,
  checkInvariants,
  coloniesOf,
  getEmpireView,
  operationOdds,
  opinionBreakdown,
  processTurn,
  redactFor,
  submitCommand,
  warKey,
  type BuildingId,
  type Command,
  type FactionId,
  type GameState,
  type MinorId,
  type OperationKind,
  type OperationReport,
  type SystemId,
  type TurnEvent,
} from '../src/sim';
import { ALPHA, BETA, colonyOf, homeOf, introduce, newGame } from './fixture';

/**
 * Fixture intel: steal research 40, sabotage 30, incite unrest 50, gather
 * intel 20. Success 70% against no defence, less 1% per 4 counter-intel;
 * caught 15% plus the same. Tests force the outcome by changing those rules.
 */
function setup() {
  const { state, content } = newGame(5);
  introduce(state, ALPHA, BETA);
  state.empires[ALPHA].intelPool = 200;
  const target = homeOf(state, BETA);
  const apply = (s: GameState, cmd: Command): GameState => {
    const r = submitCommand(s, cmd, content);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.value;
  };
  const why = (s: GameState, cmd: Command) => {
    const r = submitCommand(s, cmd, content);
    return r.ok ? 'ok' : r.error.message;
  };
  const op = (kind: OperationKind, system: SystemId | null = null): Command => ({ type: 'runOperation', empire: ALPHA, target: BETA, kind, system });
  const always = (outcome: 'success' | 'failed' | 'caught') => {
    content.rules.intel.baseChance = outcome === 'success' ? 100 : 0;
    content.rules.intel.catchBase = outcome === 'caught' ? 100 : 0;
  };
  /** Orders one operation and resolves the turn. */
  const run = (s: GameState, kind: OperationKind, system: SystemId | null = null) => {
    const step = processTurn(apply(s, op(kind, system)), content);
    const report = step.events.flatMap((e) => (e.type === 'operation' ? [e.report] : []))[0] as OperationReport;
    return { ...step, report };
  };
  return { state, content, target, apply, why, op, always, run };
}

describe('the intel split', () => {
  it('sends a share of each turn’s intel to counter-intel and the rest to the pool', () => {
    const { state, content, apply } = setup();
    state.empires[ALPHA].intelPool = 0;
    colonyOf(state, ALPHA).allocation = { food: 6, industry: 0, energy: 0, intel: 4, research: 0 };
    const split = apply(state, { type: 'setIntelSplit', empire: ALPHA, percent: 25 });
    const next = processTurn(split, content).state;
    expect(next.empires[ALPHA].counterIntel).toBe(1); // a quarter of 4
    expect(next.empires[ALPHA].intelPool).toBe(3);
    expect(next.empires[BETA].counterIntel).toBe(0);
  });

  it('lets counter-intel decay when it is not kept up', () => {
    const { state, content } = setup();
    state.empires[ALPHA].counterIntel = 100;
    let s = state;
    s = processTurn(s, content).state;
    expect(s.empires[ALPHA].counterIntel).toBe(95);
    s = processTurn(s, content).state;
    expect(s.empires[ALPHA].counterIntel).toBe(90); // 95% of 95, rounded down
  });

  it('accepts only a whole percent from 0 to 100', () => {
    const { state, why } = setup();
    expect(why(state, { type: 'setIntelSplit', empire: ALPHA, percent: 100 })).toBe('ok');
    expect(why(state, { type: 'setIntelSplit', empire: ALPHA, percent: 101 })).toMatch(/whole percent/);
    expect(why(state, { type: 'setIntelSplit', empire: ALPHA, percent: 12.5 })).toMatch(/whole percent/);
  });
});

describe('odds', () => {
  it('fall with the target’s counter-intel while the chance of being caught rises', () => {
    const { content } = setup();
    expect(operationOdds(0, content)).toEqual({ chance: 70, caught: 15 });
    expect(operationOdds(40, content)).toEqual({ chance: 60, caught: 25 });
    expect(operationOdds(400, content)).toEqual({ chance: 0, caught: 100 });
  });
});

describe('ordering an operation', () => {
  it('is paid for at once and resolves with the turn', () => {
    const { state, content, apply, op } = setup();
    const ordered = apply(state, op('gatherIntel'));
    expect(ordered.empires[ALPHA].intelPool).toBe(180);
    expect(ordered.operations).toEqual([{ by: ALPHA, target: BETA, kind: 'gatherIntel', system: null }]);
    expect(processTurn(ordered, content).state.operations).toEqual([]);
  });

  it('is refused without contact, without the intel, twice in a turn, or aimed wrongly', () => {
    const { state, apply, why, op, target } = setup();
    expect(why(apply(state, op('gatherIntel')), op('gatherIntel'))).toBe('That operation is already under way this turn');
    expect(why(state, op('sabotage'))).toBe('Choose one of their colonies that you know of');
    expect(why(state, op('sabotage', homeOf(state, ALPHA).id))).toBe('Choose one of their colonies that you know of');
    expect(why(state, op('sabotage', target.id))).toBe('ok');
    expect(why(state, op('stealResearch', target.id))).toBe('Steal research is not aimed at a colony');
    expect(why(state, { ...op('gatherIntel'), target: ALPHA } as Command)).toBe('Choose another empire');

    state.empires[ALPHA].intelPool = 10;
    expect(why(state, op('gatherIntel'))).toBe('Gather intel costs 20 intel; you have 10');

    const strangers = newGame(5).state;
    strangers.empires[ALPHA].intelPool = 200;
    const r = submitCommand(strangers, op('gatherIntel'), setup().content);
    expect(!r.ok && r.error.message).toBe('You have not made contact with them yet');
  });
});

describe('what operations do', () => {
  it('steal research: progress in the field where the target is furthest ahead', () => {
    const { state, always, run } = setup();
    always('success');
    state.empires[BETA].research.levels.weapons = 3;
    state.empires[BETA].research.levels.energy = 1;
    const { state: next, report, events } = run(state, 'stealResearch');
    expect(report).toMatchObject({ outcome: 'success', chance: 100, effect: '40 research in Weapons' });
    // 40 points: level 1 costs 10 and level 2 costs 20, leaving 10 (plus Alpha's own research that turn).
    expect(next.empires[ALPHA].research.progress.weapons).toBeGreaterThanOrEqual(40);
    expect(events).toContainEqual({ type: 'covertAction', empire: BETA, kind: 'stealResearch', system: null });
  });

  it('steal research: with nothing to learn from them, the points go to the weakest field', () => {
    const { state, always, run } = setup();
    always('success');
    state.empires[ALPHA].research.levels = { biology: 2, construction: 2, energy: 2, propulsion: 1, computing: 2, weapons: 2 };
    expect(run(state, 'stealResearch').report.effect).toBe('40 research in Propulsion');
  });

  it('sabotage: wipes progress on the current build, or destroys a building if nothing is under way', () => {
    const { state, always, run, target } = setup();
    always('success');
    const building = structuredClone(state);
    colonyOf(building, BETA).buildQueue = [{ kind: 'building', building: 'lab' as BuildingId, progress: 60 }];
    colonyOf(building, BETA).allocation = { food: 10, industry: 0, energy: 0, intel: 0, research: 0 };
    const first = run(building, 'sabotage', target.id);
    expect(first.report.effect).toBe(`work on Lab at ${target.name} was lost`);
    expect(colonyOf(first.state, BETA).buildQueue[0].progress).toBe(0);

    const second = run(state, 'sabotage', target.id); // nothing queued: a farm and a reactor stand
    expect(second.report.effect).toBe(`a Farm at ${target.name} was destroyed`);
    expect(colonyOf(second.state, BETA).buildings).toEqual({ reactor: 1 });
  });

  it('incite unrest: a morale hit on the colony for ten turns', () => {
    const { state, always, run, target } = setup();
    always('success');
    const { state: next } = run(state, 'inciteUnrest', target.id);
    expect(colonyOf(next, BETA).moraleEffects).toContainEqual({ source: 'incited', value: -25, turnsLeft: 9 });
    expect(colonyOf(next, BETA).morale).toBe(75);
  });

  it('gather intel: the target’s colonies and counter-intel are in view for ten turns', () => {
    const { state, content, always, run, target } = setup();
    always('success');
    state.empires[BETA].counterIntel = 77;
    expect(getEmpireView(state, ALPHA, content).systems[target.id].visible).toBe(false);
    expect(redactFor(state, ALPHA, content).empires[BETA].counterIntel).toBe(0);

    const { state: next, events } = run(state, 'gatherIntel');
    expect(next.empires[ALPHA].revealedUntil[BETA]).toBe(11);
    expect(getEmpireView(next, ALPHA, content).systems[target.id]).toMatchObject({ visible: true, owner: BETA });
    expect(redactFor(next, ALPHA, content).empires[BETA].counterIntel).toBeGreaterThan(0);
    // Watching does no harm, so the target is told nothing.
    expect(events.some((e) => e.type === 'covertAction')).toBe(false);

    let later = next;
    for (let i = 0; i < 10; i++) later = processTurn(later, content).state;
    expect(getEmpireView(later, ALPHA, content).systems[target.id].visible).toBe(false);
  });
});

describe('failure and capture', () => {
  it('a quiet failure costs the intel and nothing else', () => {
    const { state, always, run } = setup();
    always('failed');
    const { state: next, report, events } = run(state, 'stealResearch');
    expect(report).toMatchObject({ outcome: 'failed', effect: '' });
    expect(next.empires[ALPHA].intelPool).toBe(160);
    expect(events.filter((e) => e.type === 'covertAction' || e.type === 'spyCaught')).toEqual([]);
  });

  it('being caught tells the target who it was, and they remember', () => {
    const { state, content, always, run } = setup();
    always('caught');
    const { state: next, report, events } = run(state, 'stealResearch');
    expect(report.outcome).toBe('caught');
    expect(events).toContainEqual({ type: 'spyCaught', empire: BETA, by: ALPHA, kind: 'stealResearch' });
    expect(opinionBreakdown(next, BETA, ALPHA, content).lines).toContainEqual({ source: 'We caught their spies', kind: 'flat', value: -20 });
  });

  it('uses one seeded roll per operation, the same every time for the same state', () => {
    const { state, content, apply, op } = setup();
    const ordered = apply(state, op('gatherIntel'));
    const reportOf = (events: TurnEvent[]) => events.flatMap((e) => (e.type === 'operation' ? [e.report] : []))[0];
    const first = reportOf(processTurn(ordered, content).events);
    expect(first).toEqual(reportOf(processTurn(ordered, content).events));
    expect(first.roll).toBeGreaterThanOrEqual(1);
    expect(first.roll).toBeLessThanOrEqual(100);
    expect(first.outcome).toBe(first.roll <= 70 ? 'success' : first.roll > 85 ? 'caught' : 'failed');
  });

  it('reports only to the one who ordered it', () => {
    const { state, content, always, apply, op } = setup();
    always('success');
    const events = processTurn(apply(state, op('gatherIntel')), content).events;
    expect(events.find((e) => e.type === 'operation')).toMatchObject({ empires: [ALPHA] });
  });
});

describe('revolts', () => {
  /** Gives Alpha a second colony with enough grievances to stay in unrest. */
  function restless() {
    const ctx = setup();
    const outpost = Object.values(ctx.state.systems).find((s) => !s.colony)!;
    outpost.colony = { ...structuredClone(colonyOf(ctx.state, ALPHA)), population: 4, allocation: { food: 4, industry: 0, energy: 0, intel: 0, research: 0 }, buildings: {} };
    for (const kind of ['conquered', 'incited'] as const) addColonyMorale(ctx.state, outpost, kind, ctx.content); // 100 - 55 = 45
    return { ...ctx, outpost };
  }

  it('a colony in unrest for three turns declares independence', () => {
    const { state, content, outpost } = restless();
    let s = state;
    const events: TurnEvent[] = [];
    for (let i = 0; i < 2; i++) {
      s = processTurn(s, content).state;
      expect(s.systems[outpost.id].colony!.unrestTurns).toBe(i + 1);
    }
    const step = processTurn(s, content);
    s = step.state;
    events.push(...step.events);

    expect(events).toContainEqual({ type: 'revolt', empire: ALPHA, system: outpost.id });
    expect(s.systems[outpost.id].colony).toBeNull();
    expect(s.systems[outpost.id].minor).toEqual({ race: 'rebels', population: 4, attitude: { [ALPHA]: 0 }, leader: null, leadTurns: 0 });
    expect(coloniesOf(s, ALPHA)).toHaveLength(1);
    expect(colonyOf(s, ALPHA).moraleEffects.some((e) => e.source === 'colonyLost')).toBe(true);
    expect(checkInvariants(s, content)).toEqual([]);
  });

  it('a calm turn resets the count', () => {
    const { state, content, outpost } = restless();
    let s = processTurn(state, content).state;
    s.systems[outpost.id].colony!.moraleEffects = [];
    s = processTurn(s, content).state;
    expect(s.systems[outpost.id].colony!.unrestTurns).toBe(0);
  });

  it('a member race that revolts becomes itself again, and its bonus is lost', () => {
    const { state, content, outpost } = restless();
    state.systems[outpost.id].colony!.minorRace = 'sages' as MinorId;
    state.empires[ALPHA].members = ['sages'] as MinorId[];
    let s = state;
    for (let i = 0; i < 3; i++) s = processTurn(s, content).state;
    expect(s.systems[outpost.id].minor!.race).toBe('sages');
    expect(s.empires[ALPHA].members).toEqual([]);
  });

  it('never takes an empire’s home system or its last colony', () => {
    const { state, content } = setup();
    for (const kind of ['conquered', 'incited'] as const) addColonyMorale(state, homeOf(state, ALPHA), kind, content);
    let s = state;
    for (let i = 0; i < 6; i++) s = processTurn(s, content).state;
    expect(colonyOf(s, ALPHA).unrestTurns).toBeGreaterThanOrEqual(3);
    expect(coloniesOf(s, ALPHA)).toHaveLength(1);
  });

  it('can be turned off', () => {
    const { state, content, outpost } = restless();
    content.rules.morale.revoltTurns = 0;
    let s = state;
    for (let i = 0; i < 5; i++) s = processTurn(s, content).state;
    expect(s.systems[outpost.id].colony).not.toBeNull();
  });
});

describe('the AI and espionage', () => {
  /** Beta is the AI, with intel to spend and a personality that spies. */
  function spy() {
    const ctx = setup();
    ctx.state.empires[BETA].intelPool = 200;
    const personality = { ...ctx.content.ai.personalities[ctx.state.empires[BETA].faction as FactionId], espionage: 50, counterIntel: 20 };
    const plan = (s: GameState = ctx.state) => createPlanner(redactFor(s, BETA, ctx.content), ctx.content);
    return { ...ctx, personality, plan };
  }

  it('sets its counter-intel share and leaves alone a rival it has no quarrel with', () => {
    const { content, personality, plan } = spy();
    const p = plan();
    runEspionage(p, BETA, content, personality);
    expect(p.issued).toEqual([{ type: 'setIntelSplit', empire: BETA, percent: 20 }]);
  });

  it('steals research from a rival it dislikes', () => {
    const { state, content, personality, plan } = spy();
    addOpinion(state, BETA, ALPHA, 'spyCaught');
    const p = plan();
    runEspionage(p, BETA, content, personality);
    expect(p.issued).toContainEqual({ type: 'runOperation', empire: BETA, target: ALPHA, kind: 'stealResearch', system: null });
    expect(p.state.empires[BETA].intelPool).toBe(160);
  });

  it('at war, stirs up the nearest enemy colony', () => {
    const { state, content, personality, plan } = spy();
    state.wars[warKey(ALPHA, BETA)] = 1;
    const p = plan();
    runEspionage(p, BETA, content, personality);
    expect(p.issued).toContainEqual({ type: 'runOperation', empire: BETA, target: ALPHA, kind: 'inciteUnrest', system: homeOf(state, ALPHA).id });
  });

  it('spends only its budget, and nothing if its personality does not spy', () => {
    const { state, content, personality, plan } = spy();
    addOpinion(state, BETA, ALPHA, 'spyCaught');
    state.empires[BETA].intelPool = 50; // budget 25: only surveillance is affordable
    const cheap = plan();
    runEspionage(cheap, BETA, content, personality);
    expect(cheap.issued).toContainEqual({ type: 'runOperation', empire: BETA, target: ALPHA, kind: 'gatherIntel', system: null });

    const honest = plan();
    runEspionage(honest, BETA, content, { ...personality, espionage: 0 });
    expect(honest.issued.some((c) => c.type === 'runOperation')).toBe(false);
  });
});
