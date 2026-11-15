import { describe, expect, it } from 'vitest';
import {
  buyOutCost,
  checkInvariants,
  creditIncome,
  fleetsOf,
  garrisonStrength,
  getEmpireView,
  membershipCost,
  mercenaryCost,
  moraleBreakdown,
  opinionBreakdown,
  processTurn,
  redactFor,
  submitCommand,
  type Command,
  type Content,
  type GameState,
  type BuildingId,
  type FactionId,
  type HullId,
  type MinorId,
} from '../src/sim';
import { ALPHA, BETA, addFleet, colonyOf, homeOf, introduce, newGame } from './fixture';

const B = (id: string) => id as BuildingId;
const H = (id: string) => id as HullId;
const F = (id: string) => id as FactionId;

/**
 * Fixture credit rules: 30 credits per 100 people, idle industry sold 1 for 1,
 * 3 per trading treaty, buy-out 2 credits a point, gifts remembered from 50,
 * membership 400 before attitude, mercenaries at 300% of hull cost.
 */
function play(content: Content) {
  const apply = (s: GameState, cmd: Command): GameState => {
    const r = submitCommand(s, cmd, content);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.value;
  };
  const codeOf = (s: GameState, cmd: Command) => {
    const r = submitCommand(s, cmd, content);
    return r.ok ? 'ok' : r.error.code;
  };
  return { apply, codeOf };
}

describe('credit income', () => {
  it('lists tax, earning buildings, idle industry and the faction trait, one line each', () => {
    const { state, content } = newGame();
    content.buildings[B('vault')].credits = 5;
    colonyOf(state, ALPHA).buildings[B('vault')] = 1;
    content.factions[F('alpha')].traits.creditsPercent = 50;
    const income = creditIncome(state, ALPHA, content, 4);
    expect(income.lines).toEqual([
      { source: 'Tax on 10 people', kind: 'base', value: 3 },
      { source: 'Vault x1', kind: 'flat', value: 5 },
      { source: 'Industry with nothing to build', kind: 'flat', value: 4 },
      { source: 'Alpha commerce', kind: 'percent', value: 50 },
    ]);
    expect(income.total).toBe(18);
  });

  it('counts treaties that carry trade, but not peace or non-aggression', () => {
    const { state, content } = newGame();
    const treaty = (type: string) => ({ ...structuredClone(base), type });
    introduce(state, ALPHA, BETA);
    const { apply } = play(content);
    let s = apply(state, { type: 'proposeTreaty', empire: ALPHA, to: BETA, treaty: 'nonAggression' });
    s = apply(s, { type: 'answerOffer', empire: BETA, offer: s.offers[0].id, accept: true });
    const base = s.treaties[0];
    expect(creditIncome(s, ALPHA, content, 0).total).toBe(3);
    s.treaties.push(treaty('openBorders') as typeof base);
    expect(creditIncome(s, ALPHA, content, 0).lines).toContainEqual({ source: 'Trade under 1 treaty', kind: 'flat', value: 3 });
  });

  it('is banked each turn, with only the industry that had nothing to build sold', () => {
    const { state, content } = newGame();
    const { apply } = play(content);
    // A busy colony sells nothing: tax only.
    const busy = processTurn(apply(state, { type: 'enqueueBuild', empire: ALPHA, system: homeOf(state, ALPHA).id, building: B('factory') }), content).state;
    expect(busy.empires[ALPHA].credits).toBe(3);
    // An idle one sells all of it.
    const idle = processTurn(state, content).state;
    expect(idle.empires[ALPHA].credits).toBe(creditIncome(state, ALPHA, content).total);
    expect(idle.empires[ALPHA].credits).toBeGreaterThan(3);
    expect(checkInvariants(idle, content)).toEqual([]);
  });

  it('hides a rival treasury from the AI', () => {
    const { state, content } = newGame();
    state.empires[BETA].credits = 777;
    expect(redactFor(state, ALPHA, content).empires[BETA].credits).toBe(0);
  });
});

describe('buying out a build', () => {
  it('pays for the rest of the front item, which then completes without any industry', () => {
    const { state, content } = newGame();
    const { apply, codeOf } = play(content);
    const home = homeOf(state, ALPHA).id;
    const buy: Command = { type: 'buyOut', empire: ALPHA, system: home };
    expect(codeOf(state, buy)).toBe('notAllowed');

    let s = apply(state, { type: 'enqueueBuild', empire: ALPHA, system: home, building: B('factory') });
    expect(buyOutCost(s.systems[home], content)).toBe(120);
    expect(codeOf(s, buy)).toBe('cannotAfford');

    s.empires[ALPHA].credits = 150;
    s = apply(s, { type: 'setAllocation', empire: ALPHA, system: home, allocation: { food: 10, industry: 0, energy: 0, intel: 0, research: 0 } });
    s = apply(s, buy);
    expect(s.empires[ALPHA].credits).toBe(30);
    expect(buyOutCost(s.systems[home], content)).toBeNull();
    expect(codeOf(s, buy)).toBe('notAllowed');

    const before = s.systems[home].colony!.buildings[B('factory')] ?? 0;
    const after = processTurn(s, content).state;
    expect(after.systems[home].colony!.buildings[B('factory')]).toBe(before + 1);
    expect(after.systems[home].colony!.buildQueue).toEqual([]);
  });

  it('costs less for an item already partly built', () => {
    const { state, content } = newGame();
    const home = homeOf(state, ALPHA);
    home.colony!.buildQueue = [{ kind: 'building', building: B('factory'), progress: 45 }];
    expect(buyOutCost(home, content)).toBe(30);
  });
});

describe('gifts', () => {
  it('move credits, and a large enough one is remembered', () => {
    const { state, content } = newGame();
    const { apply, codeOf } = play(content);
    state.empires[ALPHA].credits = 100;
    const gift = (amount: number): Command => ({ type: 'giftCredits', empire: ALPHA, to: BETA, amount });
    expect(codeOf(state, gift(50))).toBe('notAllowed'); // not met yet
    introduce(state, ALPHA, BETA);
    expect(codeOf(state, gift(101))).toBe('cannotAfford');
    expect(codeOf(state, gift(0))).toBe('notAllowed');
    expect(codeOf(state, { type: 'giftCredits', empire: ALPHA, to: ALPHA, amount: 5 })).toBe('notAllowed');

    const small = apply(state, gift(10));
    expect(small.empires[BETA].credits).toBe(10);
    expect(opinionBreakdown(small, BETA, ALPHA, content).lines.some((l) => l.source === 'They sent us a gift')).toBe(false);

    const large = apply(state, gift(50));
    expect(large.empires[ALPHA].credits).toBe(50);
    expect(large.empires[BETA].credits).toBe(50);
    expect(opinionBreakdown(large, BETA, ALPHA, content).lines).toContainEqual({ source: 'They sent us a gift', kind: 'flat', value: 10 });
  });
});

describe('powers that buy loyalty and hire ships', () => {
  function withMinor() {
    const { state, content } = newGame(5);
    const system = Object.values(state.systems).find((s) => !s.colony && !(s.id in state.empires[ALPHA].knownSystems))!;
    system.planets = [{ type: 'terran', maxPopulation: 12, foodBonus: 10, energyBonus: 0 }];
    system.minor = { race: 'sages' as MinorId, population: 8, attitude: { [ALPHA]: 30 }, leader: null, leadTurns: 0 };
    state.empires[ALPHA].knownSystems[system.id] = null;
    return { state, content, system };
  }

  it('buy a minor race outright, dearer the less it likes them', () => {
    const { state, content, system } = withMinor();
    const { apply, codeOf } = play(content);
    const buy: Command = { type: 'buyMembership', empire: ALPHA, system: system.id };
    state.empires[ALPHA].credits = 1000;
    expect(codeOf(state, buy)).toBe('notAllowed'); // no such trait

    content.factions[F('alpha')].traits.buysMinors = true;
    expect(membershipCost(state, system, ALPHA, content)).toBe(480);
    system.minor!.attitude[ALPHA] = 70;
    expect(membershipCost(state, system, ALPHA, content)).toBe(320);
    state.empires[ALPHA].credits = 319;
    expect(codeOf(state, buy)).toBe('cannotAfford');
    expect(codeOf(state, { ...buy, system: homeOf(state, ALPHA).id })).toBe('notAllowed');

    state.empires[ALPHA].credits = 400;
    const paid = apply(state, buy);
    expect(paid.empires[ALPHA].credits).toBe(80);
    // Paid now, joined when the turn resolves; nobody can buy them twice.
    expect(paid.systems[system.id].minor).not.toBeNull();
    expect(codeOf(paid, buy)).toBe('notAllowed');
    const turn = processTurn(paid, content);
    const s = turn.state;
    expect(s.pledges).toEqual([]);
    expect(s.systems[system.id].colony!.owner).toBe(ALPHA);
    expect(s.systems[system.id].minor).toBeNull();
    expect(s.empires[ALPHA].members).toContain('sages');
    expect(turn.events.some((e) => e.type === 'minorJoined')).toBe(true);
    expect(checkInvariants(s, content)).toEqual([]);
  });

  it('hire a warship on the spot at a shipyard, within the support cap', () => {
    const { state, content } = newGame();
    const { apply, codeOf } = play(content);
    const home = homeOf(state, ALPHA);
    const hire = (hull: string): Command => ({ type: 'hireMercenaries', empire: ALPHA, system: home.id, hull: hull as never });
    state.empires[ALPHA].credits = 500;
    expect(codeOf(state, hire('frigate'))).toBe('notAllowed'); // no such trait

    content.factions[F('alpha')].traits.hiresMercenaries = true;
    expect(codeOf(state, hire('frigate'))).toBe('noShipyard');
    home.colony!.buildings[B('shipyard')] = 1;
    expect(codeOf(state, hire('transport'))).toBe('notAllowed');
    expect(codeOf(state, hire('destroyer'))).toBe('locked');
    expect(mercenaryCost(content.hulls[H('frigate')], content)).toBe(90);

    const ships = (s: GameState) => fleetsOf(s, ALPHA).reduce((sum, f) => sum + f.ships.length, 0);
    const s = apply(state, hire('frigate'));
    expect(s.empires[ALPHA].credits).toBe(410);
    expect(ships(s)).toBe(ships(state) + 1);

    state.empires[ALPHA].credits = 89;
    expect(codeOf(state, hire('frigate'))).toBe('cannotAfford');
    state.empires[ALPHA].credits = 100000;
    let full = state;
    while (codeOf(full, hire('frigate')) === 'ok') full = apply(full, hire('frigate'));
    expect(codeOf(full, hire('frigate'))).toBe('supportCap');
  });
});

describe('content only one power can build', () => {
  it('rejects another power, with a message naming the owner', () => {
    const { state, content } = newGame();
    const home = homeOf(state, ALPHA);
    home.colony!.buildings[B('shipyard')] = 1;
    content.buildings[B('forum')].faction = 'beta' as never;
    content.hulls[H('frigate')].faction = 'beta' as never;
    const building = submitCommand(state, { type: 'enqueueBuild', empire: ALPHA, system: home.id, building: B('forum') }, content);
    expect(building.ok ? null : [building.error.code, building.error.message]).toEqual(['locked', 'Only Beta can build the Forum']);
    const ship = submitCommand(state, { type: 'enqueueShip', empire: ALPHA, system: home.id, hull: 'frigate' as never }, content);
    expect(ship.ok ? null : [ship.error.code, ship.error.message]).toEqual(['locked', 'Only Beta can build the Frigate']);

    const theirs = homeOf(state, BETA);
    theirs.colony!.buildings[B('shipyard')] = 1;
    expect(submitCommand(state, { type: 'enqueueBuild', empire: BETA, system: theirs.id, building: B('forum') }, content).ok).toBe(true);
    expect(submitCommand(state, { type: 'enqueueShip', empire: BETA, system: theirs.id, hull: 'frigate' as never }, content).ok).toBe(true);
  });
});

describe('faction traits', () => {
  it('a morale ceiling caps how content a colony can be', () => {
    const { state, content } = newGame();
    const home = homeOf(state, ALPHA);
    home.colony!.buildings[B('forum')] = 1;
    expect(moraleBreakdown(state, home, content).total).toBe(110);
    content.factions[F('alpha')].traits.moraleCeiling = 104;
    expect(moraleBreakdown(state, home, content).total).toBe(104);
    // The lid does not touch a rival, or lift an unhappy colony.
    homeOf(state, BETA).colony!.buildings[B('forum')] = 1;
    expect(moraleBreakdown(state, homeOf(state, BETA), content).total).toBe(110);
  });

  it('a garrison trait adds its own line', () => {
    const { state, content } = newGame();
    const home = homeOf(state, ALPHA);
    const plain = garrisonStrength(home, content, state);
    content.factions[F('alpha')].traits.garrisonPercent = 50;
    const drilled = garrisonStrength(home, content, state);
    expect(drilled.lines).toContainEqual({ source: 'Alpha discipline', kind: 'percent', value: 50 });
    expect(drilled.total).toBe(Math.floor((plain.total * 150) / 100));
  });
});

describe('cloaking', () => {
  function setup() {
    const { state, content } = newGame();
    content.hulls[H('frigate')].cloaked = true;
    content.factions[F('beta')].traits.cloakFromEra = 1;
    const home = homeOf(state, ALPHA).sector;
    const near = { x: home.x + (home.x + 1 < 8 ? 1 : -1), y: home.y };
    const seen = (s: GameState, id: string) => getEmpireView(s, ALPHA, content).fleets.some((f) => f.id === id);
    return { state, content, home, near, seen };
  }

  it('hides a fleet of cloaked hulls from a rival who would otherwise see it', () => {
    const { state, content, near, seen } = setup();
    const fleet = addFleet(state, content, BETA, near, ['frigate', 'frigate']);
    expect(seen(state, fleet.id)).toBe(false);
    expect(redactFor(state, ALPHA, content).fleets[fleet.id]).toBeUndefined();
    // Its owner still sees it.
    expect(getEmpireView(state, BETA, content).fleets.some((f) => f.id === fleet.id)).toBe(true);
  });

  it("does not hide a fleet from its owner's allies", () => {
    const { state, content, near, seen } = setup();
    const fleet = addFleet(state, content, BETA, near, ['frigate']);
    expect(seen(state, fleet.id)).toBe(false);
    state.treaties.push({ type: 'alliance', parties: [ALPHA, BETA], startTurn: 1, since: 1, endTurn: null });
    expect(seen(state, fleet.id)).toBe(true);
    expect(redactFor(state, ALPHA, content).fleets[fleet.id]).toBeDefined();
  });

  it('does not hide a mixed fleet, or one whose owner has not reached the era', () => {
    const { state, content, near, seen } = setup();
    const mixed = addFleet(state, content, BETA, near, ['frigate', 'transport']);
    expect(seen(state, mixed.id)).toBe(true);
    const pure = addFleet(state, content, BETA, near, ['frigate']);
    content.factions[F('beta')].traits.cloakFromEra = 3;
    expect(seen(state, pure.id)).toBe(true);
    content.factions[F('beta')].traits.cloakFromEra = 0;
    expect(seen(state, pure.id)).toBe(true);
  });

  it('is seen through at a colony, by a fleet in the same sector and by a scout in range', () => {
    const { state, content, home, near, seen } = setup();
    const overhead = addFleet(state, content, BETA, home, ['frigate']);
    expect(seen(state, overhead.id)).toBe(true);

    const lurking = addFleet(state, content, BETA, near, ['frigate']);
    expect(seen(state, lurking.id)).toBe(false);
    const escort = addFleet(state, content, ALPHA, near, ['transport']);
    expect(seen(state, lurking.id)).toBe(true);
    delete state.fleets[escort.id];
    expect(seen(state, lurking.id)).toBe(false);
    addFleet(state, content, ALPHA, home, ['scout']);
    expect(seen(state, lurking.id)).toBe(true);
  });
});
