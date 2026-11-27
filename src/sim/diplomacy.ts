import type { Content } from './content';
import { applyGovernor } from './economy/governor';
import { sortedKeys, type EmpireId } from './ids';
import { addEmpireMorale } from './morale';
import {
  TREATY_TYPES,
  type BreakdownLine,
  type GameState,
  type Offer,
  type OpinionCause,
  type PeaceTerms,
  type OutputBreakdown,
  type Treaty,
  type TreatyType,
  type TurnEvent,
} from './types';

export { TREATY_TYPES };

/** Key for a pair of empires, the same whichever way round they are given. */
const pairKey = (a: EmpireId, b: EmpireId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
const isWar = (state: GameState, a: EmpireId, b: EmpireId): boolean => a !== b && pairKey(a, b) in state.wars;

/** A lapsed treaty renewed within this many turns counts as never having lapsed. */
const RENEWAL_GRACE = 12;

/**
 * Two empires have met once either has found a colony of the other. Until
 * then there is nobody to talk to.
 */
export function hasMet(state: GameState, a: EmpireId, b: EmpireId): boolean {
  const knows = (x: EmpireId, y: EmpireId) => Object.values(state.empires[x]?.knownSystems ?? {}).includes(y);
  return knows(a, b) || knows(b, a);
}

/** Treaties that make war between their parties impossible while they last. */
const BINDING: TreatyType[] = ['peace', 'nonAggression', 'alliance'];

export function treatiesBetween(state: GameState, a: EmpireId, b: EmpireId): Treaty[] {
  return state.treaties.filter((t) => t.parties.includes(a) && t.parties.includes(b) && a !== b);
}

export function hasTreaty(state: GameState, a: EmpireId, b: EmpireId, type: TreatyType): boolean {
  return treatiesBetween(state, a, b).some((t) => t.type === type);
}

/** True if a treaty in force stops these two going to war; it would have to be broken first. */
export function boundToPeace(state: GameState, a: EmpireId, b: EmpireId): boolean {
  return treatiesBetween(state, a, b).some((t) => BINDING.includes(t.type));
}

/** Empires whose colonies extend this empire's supply range: open borders or an alliance. */
export function borderPartners(state: GameState, empireId: EmpireId): EmpireId[] {
  return sortedKeys(state.empires).filter(
    (id) => id !== empireId && (hasTreaty(state, empireId, id, 'openBorders') || hasTreaty(state, empireId, id, 'alliance')),
  );
}

/** Empires this one shares sight with: allies. */
export function allies(state: GameState, empireId: EmpireId): EmpireId[] {
  return sortedKeys(state.empires).filter((id) => id !== empireId && !state.empires[id].eliminated && hasTreaty(state, empireId, id, 'alliance'));
}

/** Records something `about` did that `of` will remember. Mutates the state. */
export function addOpinion(state: GameState, of: EmpireId, about: EmpireId, cause: OpinionCause): void {
  if (of === about || !state.empires[of] || !state.empires[about]) return;
  state.opinions[of] ??= {};
  (state.opinions[of][about] ??= []).push({ cause, turn: state.turn });
}

/**
 * What one empire thinks of another, from -100 to 100, with every cause.
 * Remembered events fade with age (more slowly for a power that bears grudges);
 * treaties in force, a long friendship and being at war are standing causes.
 */
export function opinionBreakdown(state: GameState, of: EmpireId, about: EmpireId, content: Content): OutputBreakdown {
  const rules = content.rules.diplomacy;
  const grudge = content.factions[state.empires[of]?.faction]?.grudgePercent ?? 100;
  const lines: BreakdownLine[] = [];

  for (const entry of state.opinions[of]?.[about] ?? []) {
    const def = rules.causes[entry.cause];
    const decades = Math.floor((state.turn - entry.turn) / 10);
    // A grudge of 200 fades half as fast; the value moves toward zero and stops there.
    const faded = Math.floor((decades * def.fadePerTenTurns * 100) / Math.max(1, grudge));
    const value = def.value < 0 ? Math.min(0, def.value + faded) : Math.max(0, def.value - faded);
    if (value !== 0) lines.push({ source: def.label, kind: 'flat', value });
  }

  const treaties = treatiesBetween(state, of, about);
  for (const treaty of treaties) {
    lines.push({ source: `${rules.treaties[treaty.type].label} in force`, kind: 'flat', value: rules.treaties[treaty.type].opinion });
  }
  if (treaties.length > 0) {
    const oldest = Math.min(...treaties.map((t) => t.since));
    const friendship = Math.min(rules.maxFriendship, Math.floor((state.turn - oldest) / 10) * rules.friendshipPerTenTurns);
    if (friendship > 0) lines.push({ source: 'Long friendship', kind: 'flat', value: friendship });
  }
  if (isWar(state, of, about)) lines.push({ source: 'At war', kind: 'flat', value: rules.warOpinion });

  const sum = lines.reduce((n, line) => n + line.value, 0);
  return { total: Math.max(-100, Math.min(100, sum)), lines };
}

/** Drops remembered events that have faded to nothing. Mutates the state. */
export function pruneOpinions(state: GameState, content: Content): void {
  for (const of of sortedKeys(state.opinions)) {
    const grudge = content.factions[state.empires[of]?.faction]?.grudgePercent ?? 100;
    for (const about of sortedKeys(state.opinions[of])) {
      state.opinions[of][about] = state.opinions[of][about].filter((entry) => {
        const def = content.rules.diplomacy.causes[entry.cause];
        const faded = Math.floor((Math.floor((state.turn - entry.turn) / 10) * def.fadePerTenTurns * 100) / Math.max(1, grudge));
        return faded < Math.abs(def.value);
      });
    }
  }
}

/** Why this treaty cannot be proposed (or signed) between these two right now, or null if it can. */
export function treatyBlocker(state: GameState, a: EmpireId, b: EmpireId, type: TreatyType, content: Content): string | null {
  const other = state.empires[b];
  if (!other || a === b) return 'Choose another empire';
  if (other.eliminated || state.empires[a].eliminated) return 'That empire has been eliminated';
  if (!hasMet(state, a, b)) return 'You have not made contact with them yet';
  const label = content.rules.diplomacy.treaties[type].label;
  if (hasTreaty(state, a, b, type)) return `${label} is already in force`;
  const war = isWar(state, a, b);
  if (type === 'peace') return war ? null : 'You are not at war';
  if (war) return 'Make peace first';
  return null;
}

/**
 * The first turn on which a peace treaty may be broken, if that is still to
 * come; null if it may be broken now or the treaty is not a peace. A truce of
 * `rules.diplomacy.truceTurns` follows every peace, so a war cannot restart
 * the moment it ends.
 */
export function truceUntil(state: GameState, a: EmpireId, b: EmpireId, type: TreatyType, content: Content): number | null {
  if (type !== 'peace') return null;
  const treaty = treatiesBetween(state, a, b).find((t) => t.type === 'peace');
  if (!treaty) return null;
  const until = treaty.startTurn + content.rules.diplomacy.truceTurns;
  return state.turn < until ? until : null;
}

/**
 * Removes the offers that match, handing back any credits held for their
 * terms. Mutates the state.
 */
export function withdrawOffers(state: GameState, matches: (offer: Offer) => boolean): void {
  for (const offer of state.offers.filter(matches)) {
    if (offer.terms && !state.empires[offer.from].eliminated) state.empires[offer.from].credits += offer.terms.credits;
  }
  state.offers = state.offers.filter((o) => !matches(o));
}

/**
 * Why `from` cannot offer these terms, or null if it can. Only a peace can be
 * bought; its colonies must be the proposer's own and not its home. Whether
 * the credits can be afforded is checked when the offer is made, since they
 * are held from then on.
 */
export function termsBlocker(state: GameState, from: EmpireId, type: TreatyType, terms: PeaceTerms | null): string | null {
  if (terms === null) return null;
  if (type !== 'peace') return 'Only a peace can be paid for';
  if (!Number.isInteger(terms.credits) || terms.credits < 0) return 'Credits must be a whole number';
  if (!Array.isArray(terms.systems)) return 'Choose the colonies to offer';
  if (terms.credits === 0 && terms.systems.length === 0) return 'Offer credits or a colony, or propose a plain peace';
  if (new Set(terms.systems).size !== terms.systems.length) return 'A colony is offered twice';
  for (const id of terms.systems) {
    const system = state.systems[id];
    if (!system || system.colony?.owner !== from) return `${system?.name ?? 'That system'} is not yours to give`;
    if (state.empires[from].homeSystem === id) return `${system.name} is your home system and cannot be given away`;
    if (state.cessions.some((c) => c.system === id)) return `${system.name} has already been given up`;
  }
  return null;
}

/**
 * Pays what an accepted peace was bought with: the credits held for it now,
 * and each colony when the turn resolves (`resolveCessions`), so neither side
 * learns anything new mid-turn. The payer's people take it hard. Mutates the state.
 */
export function payTerms(state: GameState, offer: Offer, content: Content): void {
  const terms = offer.terms;
  if (!terms) return;
  state.empires[offer.to].credits += terms.credits;
  for (const id of terms.systems) state.cessions.push({ system: id, from: offer.from, to: offer.to });
  addEmpireMorale(state, offer.from, 'peaceBought', content);
  state.pendingEvents.push({ type: 'peaceBought', empires: [offer.from, offer.to], by: offer.from, credits: terms.credits, systems: [...terms.systems] });
}

/**
 * Hands over the colonies given up for peace, each as it stands (people,
 * buildings and any member race included), if the giver still holds it.
 * Mutates the state.
 */
export function resolveCessions(state: GameState, content: Content): void {
  for (const { system: id, from, to } of state.cessions) {
    const system = state.systems[id];
    const colony = system?.colony;
    if (!colony || colony.owner !== from || state.empires[to].eliminated) continue;
    colony.owner = to;
    const race = colony.minorRace;
    if (race) {
      const giver = state.empires[from];
      giver.members = giver.members.filter((m) => m !== race);
      const taker = state.empires[to];
      if (!taker.members.includes(race)) taker.members = [...taker.members, race].sort();
    }
    // Orders and limits were the old owner's; the new owner's governor takes over.
    colony.pinned = { food: 0, industry: 0, energy: 0, intel: 0, research: 0 };
    colony.capped = { food: null, industry: null, energy: null, intel: null, research: null };
    colony.buildQueue = [];
    colony.governor = 'balanced';
    applyGovernor(state, system, content);
    state.empires[to].knownSystems[id] = to;
    state.empires[from].knownSystems[id] = to;
  }
  state.cessions = [];
}

/** Puts a treaty into force. A peace treaty ends the war. Mutates the state. */
export function signTreaty(state: GameState, a: EmpireId, b: EmpireId, type: TreatyType, content: Content): Treaty {
  const duration = content.rules.diplomacy.treaties[type].duration;
  const parties = (a < b ? [a, b] : [b, a]) as [EmpireId, EmpireId];
  const past = state.treatyHistory[`${pairKey(a, b)}:${type}`];
  const since = past && state.turn - past.ended <= RENEWAL_GRACE ? past.since : state.turn;
  const treaty: Treaty = { type, parties, startTurn: state.turn, since, endTurn: duration === null ? null : state.turn + duration };
  if (type === 'peace') {
    delete state.wars[pairKey(a, b)];
    // Orders against the former enemy no longer make sense.
    for (const id of sortedKeys(state.fleets)) {
      const fleet = state.fleets[id];
      if (fleet.order === 'invade' && parties.includes(fleet.owner)) fleet.order = 'none';
    }
  }
  state.treaties.push(treaty);
  withdrawOffers(state, (o) => o.type === type && parties.includes(o.from) && parties.includes(o.to));
  state.pendingEvents.push({ type: 'treatySigned', empires: parties, treaty });
  return treaty;
}

/**
 * Breaks a treaty. The breaker's own people lose heart, the other party
 * remembers it for a long time, every other empire takes note, and every minor
 * race that knows the breaker thinks less of it. Mutates the state.
 */
export function breakTreaty(state: GameState, breaker: EmpireId, other: EmpireId, type: TreatyType, content: Content): void {
  const treaty = treatiesBetween(state, breaker, other).find((t) => t.type === type);
  if (!treaty) return;
  state.treaties = state.treaties.filter((t) => t !== treaty);
  addEmpireMorale(state, breaker, 'treatyBroken', content);
  for (const id of sortedKeys(state.empires)) {
    if (id === breaker || state.empires[id].eliminated) continue;
    addOpinion(state, id, breaker, id === other ? 'treatyBroken' : 'treatyBrokenWitness');
  }
  for (const id of sortedKeys(state.systems)) {
    const minor = state.systems[id].minor;
    if (minor && breaker in minor.attitude) {
      minor.attitude[breaker] = Math.max(0, minor.attitude[breaker] - content.rules.diplomacy.breakMinorPenalty);
    }
  }
  state.pendingEvents.push({ type: 'treatyBroken', empires: treaty.parties, by: breaker, treaty });
}

/** Ends treaties and offers that have run their course. Mutates the state. */
export function expireDiplomacy(state: GameState, content: Content, events: TurnEvent[]): void {
  // Judged as of the turn about to begin, so a 40-turn treaty signed on turn 1 covers turns 1 to 40.
  const now = state.turn + 1;
  const kept: Treaty[] = [];
  for (const treaty of state.treaties) {
    const gone = treaty.parties.some((p) => state.empires[p].eliminated);
    if (gone || (treaty.endTurn !== null && now >= treaty.endTurn)) {
      if (!gone) {
        events.push({ type: 'treatyExpired', empires: treaty.parties, treaty });
        state.treatyHistory[`${pairKey(treaty.parties[0], treaty.parties[1])}:${treaty.type}`] = { since: treaty.since, ended: state.turn };
      }
    } else {
      kept.push(treaty);
    }
  }
  state.treaties = kept;
  withdrawOffers(
    state,
    (o) => now - o.turn >= content.rules.diplomacy.offerTurns || state.empires[o.from].eliminated || state.empires[o.to].eliminated,
  );
}

/**
 * The Accord victory: allied with every surviving rival, and holding at least
 * half of all the minor races the galaxy began with. If several empires
 * qualify, the one with the most members leads the Accord; a tie goes to the
 * one with more research, and a tie there too leaves the game going.
 */
export function accordWinner(state: GameState, content: Content): EmpireId | null {
  if (state.minorsPlaced === 0 || content.rules.diplomacy.accordMemberPercent === 0) return null;
  const standing = sortedKeys(state.empires).filter((id) => !state.empires[id].eliminated);
  if (standing.length < 2) return null;
  // Colonies that revolted and came back do not count; only the peoples the galaxy began with.
  const members = (id: EmpireId) => state.empires[id].members.filter((m) => m !== content.rules.morale.rebelRace).length;
  const qualified = standing.filter(
    (id) =>
      standing.every((other) => other === id || hasTreaty(state, id, other, 'alliance')) &&
      members(id) * 100 >= state.minorsPlaced * content.rules.diplomacy.accordMemberPercent,
  );
  if (qualified.length === 0) return null;
  const learning = (id: EmpireId) => Object.values(state.empires[id].research.levels).reduce((sum, n) => sum + n, 0);
  const most = Math.max(...qualified.map(members));
  let leaders = qualified.filter((id) => members(id) === most);
  if (leaders.length > 1) {
    const best = Math.max(...leaders.map(learning));
    leaders = leaders.filter((id) => learning(id) === best);
  }
  return leaders.length === 1 ? leaders[0] : null;
}
