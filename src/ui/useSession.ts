import { useSyncExternalStore } from 'react';
import type { GameSession, SessionSnapshot } from '../game/session';

/** Re-renders the component whenever the session publishes a new snapshot. */
export function useSession(session: GameSession): SessionSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}
