import { FIELDS, type FieldId } from '../sim';

/**
 * Sets one field's share and scales the other fields so the total stays 100.
 * The others keep their proportions; if they were all zero they share evenly.
 */
export function rebalance(allocation: Record<FieldId, number>, field: FieldId, value: number): Record<FieldId, number> {
  const share = Math.max(0, Math.min(100, Math.round(value)));
  const others = FIELDS.filter((f) => f !== field);
  const rest = 100 - share;
  const otherTotal = others.reduce((sum, f) => sum + allocation[f], 0);

  const next = { ...allocation, [field]: share };
  let assigned = 0;
  for (const f of others) {
    next[f] = otherTotal === 0 ? Math.floor(rest / others.length) : Math.floor((allocation[f] * rest) / otherTotal);
    assigned += next[f];
  }
  // Hand out what rounding left over, largest shares first.
  const byShare = [...others].sort((a, b) => next[b] - next[a]);
  for (let i = 0; assigned < rest; i = (i + 1) % byShare.length) {
    next[byShare[i]] += 1;
    assigned += 1;
  }
  return next;
}
