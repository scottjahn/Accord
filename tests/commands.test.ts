import { describe, expect, it } from 'vitest';
import { submitCommand, type BuildingId, type Command, type EmpireId, type GameState, type SystemId } from '../src/sim';
import { ALPHA, BETA, colonyOf, homeOf, newGame } from './fixture';

const B = (id: string) => id as BuildingId;

function setup() {
  const { state, content } = newGame();
  const home = homeOf(state, ALPHA).id;
  const submit = (s: GameState, cmd: Command) => submitCommand(s, cmd, content);
  const mustApply = (s: GameState, cmd: Command): GameState => {
    const r = submit(s, cmd);
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  const codeOf = (s: GameState, cmd: Command) => {
    const r = submit(s, cmd);
    return r.ok ? 'ok' : r.error.code;
  };
  const enqueue = (building: string): Command => ({ type: 'enqueueBuild', empire: ALPHA, system: home, building: B(building) });
  return { state, content, home, submit, mustApply, codeOf, enqueue };
}

describe('commands', () => {
  it('sets an allocation without modifying the input state', () => {
    const { state, home, mustApply } = setup();
    const before = structuredClone(state);
    const allocation = { food: 5, industry: 3, energy: 1, intel: 1, research: 0 };
    const next = mustApply(state, { type: 'setAllocation', empire: ALPHA, system: home, allocation });
    expect(colonyOf(next, ALPHA).allocation).toEqual(allocation);
    expect(state).toEqual(before);
  });

  it('allows idle workers but not more workers than population', () => {
    const { state, home, codeOf } = setup();
    const set = (food: number): Command => ({
      type: 'setAllocation',
      empire: ALPHA,
      system: home,
      allocation: { food, industry: 0, energy: 0, intel: 0, research: 0 },
    });
    expect(codeOf(state, set(3))).toBe('ok');
    expect(codeOf(state, set(10))).toBe('ok');
    expect(codeOf(state, set(11))).toBe('invalidAllocation');
  });

  it('rejects negative, fractional and incomplete allocations', () => {
    const { state, home, codeOf } = setup();
    const set = (allocation: any): Command => ({ type: 'setAllocation', empire: ALPHA, system: home, allocation });
    expect(codeOf(state, set({ food: -1, industry: 0, energy: 0, intel: 0, research: 0 }))).toBe('invalidAllocation');
    expect(codeOf(state, set({ food: 1.5, industry: 0, energy: 0, intel: 0, research: 0 }))).toBe('invalidAllocation');
    expect(codeOf(state, set({ food: 1 }))).toBe('invalidAllocation');
    expect(codeOf(state, set({ food: 1, industry: 0, energy: 0, intel: 0, research: 0, credits: 1 }))).toBe('invalidAllocation');
  });

  it('rejects commands on systems the empire does not own', () => {
    const { state, home, codeOf, enqueue } = setup();
    const empty = Object.values(state.systems).find((s) => !s.colony)!.id;
    expect(codeOf(state, { ...enqueue('farm'), empire: BETA })).toBe('notOwner');
    expect(codeOf(state, { ...enqueue('farm'), system: empty })).toBe('notOwner');
    expect(codeOf(state, { ...enqueue('farm'), system: 'sys-999' as SystemId })).toBe('unknownSystem');
    expect(codeOf(state, { ...enqueue('farm'), empire: 'emp-9' as EmpireId })).toBe('unknownEmpire');
    expect(colonyOf(state, ALPHA).buildQueue).toEqual([]);
    expect(home).toBe(state.empires[ALPHA].homeSystem);
  });

  it('enqueues buildings at the back of the queue', () => {
    const { state, mustApply, enqueue } = setup();
    const next = mustApply(mustApply(state, enqueue('factory')), enqueue('lab'));
    expect(colonyOf(next, ALPHA).buildQueue).toEqual([
      { building: 'factory', progress: 0 },
      { building: 'lab', progress: 0 },
    ]);
  });

  it('rejects unknown buildings', () => {
    const { state, codeOf, enqueue } = setup();
    expect(codeOf(state, enqueue('death_star'))).toBe('unknownBuilding');
  });

  it('counts built and queued buildings against the per-system limit', () => {
    const { state, mustApply, codeOf, enqueue } = setup();
    // farm: 1 built, limit 3
    const two = mustApply(mustApply(state, enqueue('farm')), enqueue('farm'));
    expect(codeOf(two, enqueue('farm'))).toBe('buildLimit');
    expect(codeOf(two, enqueue('lab'))).toBe('ok');
  });

  it('rejects enqueueing into a full queue', () => {
    const { state, mustApply, codeOf, enqueue } = setup();
    let s = state;
    for (const b of ['farm', 'farm', 'factory', 'factory']) s = mustApply(s, enqueue(b));
    expect(codeOf(s, enqueue('reactor'))).toBe('queueFull');
  });

  it('removes a queued item, losing its progress', () => {
    const { state, home, mustApply, codeOf } = setup();
    colonyOf(state, ALPHA).buildQueue = [
      { building: B('factory'), progress: 30 },
      { building: B('lab'), progress: 0 },
    ];
    const next = mustApply(state, { type: 'dequeueBuild', empire: ALPHA, system: home, index: 0 });
    expect(colonyOf(next, ALPHA).buildQueue).toEqual([{ building: 'lab', progress: 0 }]);
    expect(codeOf(state, { type: 'dequeueBuild', empire: ALPHA, system: home, index: 2 })).toBe('badIndex');
    expect(codeOf(state, { type: 'dequeueBuild', empire: ALPHA, system: home, index: -1 })).toBe('badIndex');
  });

  it('reorders the queue and keeps progress with each item', () => {
    const { state, home, mustApply, codeOf } = setup();
    colonyOf(state, ALPHA).buildQueue = [
      { building: B('factory'), progress: 30 },
      { building: B('lab'), progress: 5 },
      { building: B('farm'), progress: 0 },
    ];
    const next = mustApply(state, { type: 'moveBuild', empire: ALPHA, system: home, from: 2, to: 0 });
    expect(colonyOf(next, ALPHA).buildQueue).toEqual([
      { building: 'farm', progress: 0 },
      { building: 'factory', progress: 30 },
      { building: 'lab', progress: 5 },
    ]);
    expect(codeOf(state, { type: 'moveBuild', empire: ALPHA, system: home, from: 0, to: 3 })).toBe('badIndex');
  });
});
