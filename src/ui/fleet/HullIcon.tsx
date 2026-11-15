import type { HullRole } from '../../sim';

interface Props {
  role: HullRole;
  /** Hull generation; later generations are drawn with more to them. */
  tier: number;
  /** The owner's colour. */
  color: string;
}

/** The body of each kind of ship, nose to the right, in a 32 by 16 box. */
const BODY: Record<HullRole, string> = {
  scout: 'M3 8 L11 5.5 L29 8 L11 10.5 Z',
  colony: 'M4 5 H18 Q27 5 28 8 Q27 11 18 11 H4 Z',
  warship: 'M4 4.5 L14 5.5 L29 8 L14 10.5 L4 11.5 L7 8 Z',
  transport: 'M4 4.5 H22 L28 8 L22 11.5 H4 Z',
};

/** What a second-generation hull adds: engines, a dome, wings or a cargo spine. */
const SECOND: Record<HullRole, string> = {
  scout: 'M9 5.8 L5 2.5 L13 5.2 Z M9 10.2 L5 13.5 L13 10.8 Z',
  colony: 'M9 5 Q13 0.5 17 5 Z M9 11 Q13 15.5 17 11 Z',
  warship: 'M10 5.2 L6 1.5 L17 5.8 Z M10 10.8 L6 14.5 L17 10.2 Z',
  transport: 'M7 4.5 V2.5 H19 V4.5 Z M7 11.5 V13.5 H19 V11.5 Z',
};

/** What a third-generation hull adds on top: outriggers and a longer prow. */
const THIRD: Record<HullRole, string> = {
  scout: 'M14 3.5 H22 V4.3 H14 Z M14 11.7 H22 V12.5 H14 Z',
  colony: 'M20 3 H25 V4 H20 Z M20 12 H25 V13 H20 Z',
  warship: 'M17 2.5 H26 V3.5 H17 Z M17 12.5 H26 V13.5 H17 Z M29 8 L32 7.4 V8.6 Z',
  transport: 'M21 2.5 H25 V3.5 H21 Z M21 12.5 H25 V13.5 H21 Z',
};

/**
 * A small side-on silhouette of a ship: its shape says what it is for, and each
 * hull generation adds to it. Decoration only; the name is always beside it.
 */
export function HullIcon({ role, tier, color }: Props) {
  return (
    <svg className="hull-icon" viewBox="0 0 32 16" width="32" height="16" aria-hidden="true" data-role={role} data-tier={tier}>
      <path d="M1 6.5 H5 V9.5 H1 Z" fill="currentColor" opacity="0.55" />
      <path d={BODY[role]} fill={color} stroke="currentColor" strokeWidth="0.6" strokeOpacity="0.7" />
      {tier >= 2 && <path d={SECOND[role]} fill={color} stroke="currentColor" strokeWidth="0.5" strokeOpacity="0.7" />}
      {tier >= 3 && <path d={THIRD[role]} fill="currentColor" opacity="0.85" />}
      <circle cx={role === 'colony' ? 21 : 19} cy="8" r="1.1" fill="currentColor" opacity="0.9" />
    </svg>
  );
}
