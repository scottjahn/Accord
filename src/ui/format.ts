import type { BreakdownLine, BuildingDef, Content, Governor, OutputKind, TurnEvent, GameState } from '../sim';

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

export const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

export const turns = (n: number): string => (n === 1 ? '1 turn' : `${n} turns`);

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

export function eventText(event: TurnEvent, state: GameState, content: Content): string {
  const name = state.systems[event.system]?.name ?? event.system;
  switch (event.type) {
    case 'buildCompleted':
      return `${name}: ${content.buildings[event.building]?.name ?? event.building} completed`;
    case 'populationGrew':
      return `${name}: population grew to ${event.population}`;
    case 'starvation':
      return `${name}: starvation, ${event.lost} population lost`;
  }
}
