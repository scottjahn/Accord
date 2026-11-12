import type { Content, MinorDef } from './content';
import type { EmpireId } from './ids';
import type { BreakdownLine, GameState } from './types';

/**
 * Percent bonuses of one kind that an empire's member races give it, as
 * breakdown lines. For 'output' bonuses, pass which output is being computed.
 */
export function memberBonuses(
  state: GameState,
  empireId: EmpireId,
  content: Content,
  kind: MinorDef['bonus']['kind'],
  output?: string,
): BreakdownLine[] {
  const lines: BreakdownLine[] = [];
  for (const member of state.empires[empireId]?.members ?? []) {
    const def = content.minors[member];
    if (!def || def.bonus.kind !== kind) continue;
    if (kind === 'output' && def.bonus.output !== output) continue;
    lines.push({ source: `${def.name} membership`, kind: 'percent', value: def.bonus.value });
  }
  return lines;
}
