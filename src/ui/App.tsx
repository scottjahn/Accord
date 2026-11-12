import { useEffect, useMemo, useState } from 'react';
import { loadContent } from '../data';
import { browserStorage, readAutosave, writeAutosave } from '../game/persistence';
import { createSession, humanEmpire, type GameSession } from '../game/session';
import type { GameState } from '../sim';
import { GameScreen } from './screens/GameScreen';
import { NewGameScreen } from './screens/NewGameScreen';

export function App() {
  const content = useMemo(loadContent, []);
  const [session, setSession] = useState<GameSession | null>(null);

  // Autosave on every change, including the first state of a new game.
  useEffect(() => {
    if (!session) return;
    const storage = browserStorage();
    const save = () => writeAutosave(storage, session.getSnapshot().state);
    save();
    return session.subscribe(save);
  }, [session]);

  if (!session) {
    const saved = readAutosave(browserStorage());
    const resumable = saved?.ok && humanEmpire(saved.value) ? saved.value : null;
    return (
      <NewGameScreen
        content={content}
        saved={resumable}
        onStart={(state: GameState) => setSession(createSession(content, state))}
      />
    );
  }
  return <GameScreen session={session} onQuit={() => setSession(null)} />;
}
