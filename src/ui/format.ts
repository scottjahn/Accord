import {
  systemAt,
  type BreakdownLine,
  type BuildingDef,
  type Content,
  type EmpireId,
  type GameState,
  type Governor,
  type HullRole,
  type MinorDef,
  type OutputKind,
  type Sector,
  type TurnEvent,
} from '../sim';

export const OUTPUT_LABELS: Record<OutputKind, string> = {
  food: 'Food',
  industry: 'Industry',
  energy: 'Energy',
  intel: 'Intel',
  research: 'Research',
};

export const GOVERNOR_LABELS: Record<Governor, string> = {
  manual: 'Manual',
  balanced: 'Balanced',
  growth: 'Growth',
  industry: 'Industry',
  research: 'Research',
};

export const ROLE_LABELS: Record<HullRole, string> = {
  scout: 'Scout',
  colony: 'Colony ship',
  warship: 'Warship',
  transport: 'Troop transport',
};

/** What a minor race gives the empire it joins, in words. */
export function bonusText(def: MinorDef, content: Content): string {
  const { kind, value, output } = def.bonus;
  switch (kind) {
    case 'output':
      return `${signed(value)}% ${OUTPUT_LABELS[output!].toLowerCase()} in every colony`;
    case 'morale':
      return `${signed(value)} morale in every colony`;
    case 'range':
      return `${signed(value)} supply range`;
    case 'garrison':
      return `${signed(value)}% garrison strength`;
    case 'attack':
      return `${signed(value)}% attack in battle`;
  }
  return content.minors[def.id]?.name ?? '';
}

export const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

export const turns = (n: number): string => (n === 1 ? '1 turn' : `${n} turns`);

export const sectors = (n: number): string => (n === 1 ? '1 sector' : `${n} sectors`);

export const ships = (n: number): string => (n === 1 ? '1 ship' : `${n} ships`);

export const sectorLabel = (sector: Sector): string => `${sector.x + 1}, ${sector.y + 1}`;

/** The system's name if there is one in the sector, otherwise the sector coordinates. */
export function placeName(state: GameState, sector: Sector): string {
  return systemAt(state, sector)?.name ?? `sector ${sectorLabel(sector)}`;
}

export function lineValue(line: BreakdownLine): string {
  return line.kind === 'percent' ? `${signed(line.value)}%` : signed(line.value);
}

export function effectsText(def: BuildingDef): string {
  return def.effects
    .map((e) => `${signed(e.value)}${e.kind === 'percent' ? '%' : ''} ${OUTPUT_LABELS[e.output].toLowerCase()}`)
    .join(', ');
}

export function modifiersText(modifiers: Partial<Record<OutputKind, number>>): string {
  const parts = (Object.keys(modifiers) as OutputKind[]).map(
    (kind) => `${signed(modifiers[kind]!)}% ${OUTPUT_LABELS[kind].toLowerCase()}`,
  );
  return parts.length > 0 ? parts.join(', ') : 'No modifiers';
}

/** Whether an event belongs in this player's turn report. */
export function eventIsMine(event: TurnEvent, state: GameState, player: EmpireId): boolean {
  if (event.type === 'warDeclared' || event.type === 'empireEliminated' || event.type === 'gameWon') return true;
  if ('empires' in event) return event.empires.includes(player);
  if ('empire' in event) return event.empire === player;
  return state.systems[event.system]?.colony?.owner === player;
}

export function eventText(event: TurnEvent, state: GameState, content: Content): string {
  const treatyLabel = (type: keyof typeof content.rules.diplomacy.treaties) => content.rules.diplomacy.treaties[type].label;
  const factionName = (id: EmpireId) => content.factions[state.empires[id]?.faction]?.name ?? id;
  const systemName = (id: string | null) => (id && state.systems[id as keyof typeof state.systems]?.name) || 'a system';
  switch (event.type) {
    case 'buildCompleted':
      return `${systemName(event.system)}: ${content.buildings[event.building]?.name ?? event.building} completed`;
    case 'shipBuilt':
      return `${systemName(event.system)}: ${content.hulls[event.hull]?.name ?? event.hull} launched`;
    case 'refitCompleted':
      return `${systemName(event.system)}: refit to ${content.hulls[event.hull]?.name ?? event.hull} complete`;
    case 'populationGrew':
      return `${systemName(event.system)}: population grew to ${event.population}`;
    case 'starvation':
      return `${systemName(event.system)}: starvation, ${event.lost} population lost`;
    case 'researchCompleted':
      return `${content.fields[event.field].name} reached level ${event.level}`;
    case 'fleetArrived':
      return `Fleet arrived at ${placeName(state, event.sector)}`;
    case 'fleetBlocked':
      return 'A fleet lost its route and stopped';
    case 'colonyFounded':
      return `Colony founded at ${systemName(event.system)}`;
    case 'coloniseFailed':
      return `Could not colonise ${systemName(event.system)}`;
    case 'warDeclared':
      return `${factionName(event.by)} declared war on ${factionName(event.on)}`;
    case 'battle': {
      const lost = event.report.sides.map((s) => `${factionName(s.empire)} lost ${s.before - s.after} of ${s.before}`).join(', ');
      return `Battle at ${placeName(state, event.report.sector)}: ${lost}`;
    }
    case 'invasion':
      if (event.report.minor) {
        const people = content.minors[event.report.minor]?.name ?? event.report.minor;
        return event.report.captured
          ? `Invasion of ${systemName(event.report.system)}: the ${people} were overrun`
          : `Invasion of ${systemName(event.report.system)}: the ${people} held`;
      }
      return event.report.captured
        ? `${factionName(event.report.attacker)} captured ${systemName(event.report.system)}`
        : `${factionName(event.report.attacker)} failed to take ${systemName(event.report.system)}`;
    case 'empireEliminated':
      return `${factionName(event.empire)} has been eliminated`;
    case 'gameWon':
      return `${factionName(event.empire)} has won the game`;
    case 'treatySigned':
      return `${treatyLabel(event.treaty.type)} signed between ${factionName(event.treaty.parties[0])} and ${factionName(event.treaty.parties[1])}`;
    case 'treatyBroken': {
      const other = event.treaty.parties[0] === event.by ? event.treaty.parties[1] : event.treaty.parties[0];
      return `${factionName(event.by)} broke the ${treatyLabel(event.treaty.type).toLowerCase()} with ${factionName(other)}`;
    }
    case 'treatyExpired':
      return `The ${treatyLabel(event.treaty.type).toLowerCase()} between ${factionName(event.treaty.parties[0])} and ${factionName(event.treaty.parties[1])} has lapsed`;
    case 'offerMade':
      return `${factionName(event.offer.from)} proposes a ${treatyLabel(event.offer.type).toLowerCase()} to ${factionName(event.offer.to)}`;
    case 'offerRefused':
      return `${factionName(event.offer.to)} refused the ${treatyLabel(event.offer.type).toLowerCase()}${event.note ? `: ${event.note}` : ''}`;
    case 'operation': {
      const r = event.report;
      const label = content.rules.intel.operations[r.kind].label;
      const result = r.outcome === 'success' ? `succeeded${r.effect ? `: ${r.effect}` : ''}` : r.outcome === 'caught' ? 'failed and our agents were caught' : 'failed';
      return `${label} against ${factionName(r.target)} ${result} (rolled ${r.roll}, needed ${r.chance} or less)`;
    }
    case 'covertAction':
      return `Enemy agents: ${content.rules.intel.operations[event.kind].label.toLowerCase()}${event.system ? ` at ${systemName(event.system)}` : ''}`;
    case 'spyCaught':
      return `We caught agents of ${factionName(event.by)} attempting to ${content.rules.intel.operations[event.kind].label.toLowerCase()}`;
    case 'revolt':
      return `${systemName(event.system)} has declared independence`;
    case 'minorJoined':
      return `The ${content.minors[event.race]?.name ?? event.race} of ${systemName(event.system)} have joined ${factionName(event.empire)}`;
    case 'minorConquered':
      return `${factionName(event.empire)} conquered the ${content.minors[event.race]?.name ?? event.race} of ${systemName(event.system)}`;
  }
}
