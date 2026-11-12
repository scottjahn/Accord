import { useState } from 'react';
import { saveFileName } from '../../game/persistence';
import type { GameSession } from '../../game/session';
import type { SystemId } from '../../sim';
import { EventLog } from '../hud/EventLog';
import { TopBar } from '../hud/TopBar';
import { GalaxyMap } from '../map/GalaxyMap';
import { SystemPanel } from '../system/SystemPanel';
import { useSession } from '../useSession';

interface Props {
  session: GameSession;
  onQuit: () => void;
}

function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function GameScreen({ session, onQuit }: Props) {
  const { state, player, lastEvents, lastError } = useSession(session);
  const { content } = session;
  const [selected, setSelected] = useState<SystemId | null>(state.empires[player].homeSystem);
  const selectedSystem = selected ? state.systems[selected] : undefined;

  return (
    <div className="game">
      <TopBar
        state={state}
        content={content}
        player={player}
        onEndTurn={() => session.endTurn()}
        onSave={() => downloadText(saveFileName(state), session.exportSave())}
        onQuit={onQuit}
      />
      <div className="game-body">
        <section className="map-area" aria-label="Galaxy map">
          <GalaxyMap state={state} content={content} player={player} selected={selected} onSelect={setSelected} />
          <EventLog state={state} content={content} player={player} events={lastEvents} />
        </section>
        <aside className="side-panel" aria-label="System details">
          {selectedSystem ? (
            <SystemPanel
              key={selectedSystem.id}
              state={state}
              content={content}
              player={player}
              system={selectedSystem}
              error={lastError}
              dispatch={session.dispatch}
            />
          ) : (
            <p className="muted panel-empty">Select a system on the map.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
