import {
  systemAt,
  type BreakdownLine,
  type BuildingDef,
  type Content,
  type EmpireId,
  type GameState,
  type Governor,
  type HullRole,
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
      return event.report.captured
        ? `${factionName(event.report.attacker)} captured ${systemName(event.report.system)}`
        : `${factionName(event.report.attacker)} failed to take ${systemName(event.report.system)}`;
    case 'empireEliminated':
      return `${factionName(event.empire)} has been eliminated`;
    case 'gameWon':
      return `${factionName(event.empire)} has won the game`;
  }
}
