import { useMemo, useState } from 'react';
import { saveFileName } from '../../game/persistence';
import type { GameSession } from '../../game/session';
import {
  atWar,
  getEmpireView,
  sameSector,
  sortedKeys,
  systemAt,
  validateCommand,
  type Command,
  type FleetId,
  type Sector,
  type SystemId,
  type TurnEvent,
} from '../../sim';
import { FleetPanel } from '../fleet/FleetPanel';
import { EventLog } from '../hud/EventLog';
import { TopBar } from '../hud/TopBar';
import { GalaxyMap } from '../map/GalaxyMap';
import { ResearchScreen } from '../research/ResearchScreen';
import { SystemPanel } from '../system/SystemPanel';
import { useSession } from '../useSession';
import { EmpiresScreen } from '../war/EmpiresScreen';
import { IntelScreen } from '../war/IntelScreen';
import { ReportScreen } from '../war/ReportScreen';

interface Props {
  session: GameSession;
  onQuit: () => void;
}

type Selection = { kind: 'system'; id: SystemId } | { kind: 'fleet'; id: FleetId } | null;

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
  const [selection, setSelection] = useState<Selection>({ kind: 'system', id: state.empires[player].homeSystem });
  const [moveMode, setMoveMode] = useState(false);
  const [showResearch, setShowResearch] = useState(false);
  const [showEmpires, setShowEmpires] = useState(false);
  const [showIntel, setShowIntel] = useState(false);
  const offers = state.offers.filter((o) => o.to === player).length;
  const [report, setReport] = useState<Extract<TurnEvent, { type: 'battle' | 'invasion' }> | null>(null);
  const [resultSeen, setResultSeen] = useState(false);
  const over = state.winner !== null;
  const wars = sortedKeys(state.empires).filter((id) => atWar(state, player, id) && !state.empires[id].eliminated).length;
  const view = useMemo(() => getEmpireView(state, player, content), [state, player, content]);

  const system = selection?.kind === 'system' ? state.systems[selection.id] : undefined;
  // A selected fleet can vanish (it colonised) or sail out of sight.
  const fleet = selection?.kind === 'fleet' ? view.fleets.find((f) => f.id === selection.id) : undefined;
  const ownFleet = fleet?.owner === player ? fleet : undefined;

  const select = (next: Selection) => {
    setSelection(next);
    setMoveMode(false);
  };

  /**
   * Sends the selected fleet to a sector. Transports sent to an enemy colony
   * invade it, and a colony ship sent to a free system settles it.
   */
  const sendFleet = (sector: Sector) => {
    if (!ownFleet) return;
    setMoveMode(false);
    const target = systemAt(state, sector);
    if (target && view.systems[target.id]?.known) {
      const invade: Command = { type: 'invadeSystem', empire: player, fleet: ownFleet.id, system: target.id };
      if (!validateCommand(state, invade, content)) {
        session.dispatch(invade);
        return;
      }
      const colonise: Command = { type: 'coloniseSystem', empire: player, fleet: ownFleet.id, system: target.id };
      if (!validateCommand(state, colonise, content)) {
        session.dispatch(colonise);
        return;
      }
    }
    session.dispatch({ type: 'moveFleet', empire: player, fleet: ownFleet.id, to: sector });
  };

  const onSectorClick = (sector: Sector, button: 'primary' | 'secondary') => {
    if (ownFleet && (button === 'secondary' || moveMode)) {
      sendFleet(sector);
      return;
    }
    if (button === 'secondary') return;
    const target = systemAt(state, sector);
    if (target) {
      select({ kind: 'system', id: target.id });
      return;
    }
    const fleetsHere = view.fleets.filter((f) => sameSector(f.sector, sector));
    const pick = fleetsHere.find((f) => f.owner === player) ?? fleetsHere[0];
    if (pick) select({ kind: 'fleet', id: pick.id });
  };

  return (
    <div className="game">
      <TopBar
        state={state}
        content={content}
        player={player}
        onEndTurn={() => session.endTurn()}
        onResearch={() => setShowResearch(true)}
        onEmpires={() => setShowEmpires(true)}
        onIntel={() => setShowIntel(true)}
        offers={offers}
        wars={wars}
        over={over}
        onSave={() => downloadText(saveFileName(state), session.exportSave())}
        onQuit={onQuit}
      />
      <div className="game-body">
        <section className="map-area" aria-label="Galaxy map">
          <GalaxyMap
            state={state}
            content={content}
            view={view}
            selectedSystem={system?.id ?? null}
            selectedFleet={fleet ?? null}
            onSectorClick={onSectorClick}
          />
          <EventLog state={state} content={content} player={player} events={lastEvents} onOpenReport={setReport} />
        </section>
        <aside className="side-panel" aria-label="Details">
          {lastError && !system && (
            <p className="error panel-error" role="alert">
              {lastError.message}
            </p>
          )}
          {system ? (
            <SystemPanel
              key={system.id}
              state={state}
              content={content}
              player={player}
              view={view}
              system={system}
              error={lastError}
              dispatch={session.dispatch}
              onSelectFleet={(id) => select({ kind: 'fleet', id })}
            />
          ) : fleet ? (
            <FleetPanel
              key={fleet.id}
              state={state}
              content={content}
              player={player}
              view={view}
              fleet={fleet}
              moveMode={moveMode}
              onToggleMove={() => setMoveMode(!moveMode)}
              dispatch={session.dispatch}
            />
          ) : (
            <p className="muted panel-empty">Select a system or a fleet on the map.</p>
          )}
        </aside>
      </div>
      {showEmpires && (
        <EmpiresScreen state={state} content={content} player={player} view={view} dispatch={session.dispatch} onClose={() => setShowEmpires(false)} />
      )}
      {showIntel && <IntelScreen state={state} content={content} player={player} dispatch={session.dispatch} onClose={() => setShowIntel(false)} />}
      {report && <ReportScreen state={state} content={content} player={player} event={report} onClose={() => setReport(null)} />}
      {over && !resultSeen && (
        <div className="modal-backdrop">
          <div className="modal result" role="dialog" aria-modal="true" aria-label="Game over">
            <h2>{state.winner === player ? 'Victory' : 'Defeat'}</h2>
            <p>
              {state.winner === player
                ? state.victory === 'accord'
                  ? 'The powers have joined the Accord under your leadership, without conquest.'
                  : 'Your rivals are beaten. The galaxy is yours.'
                : state.victory === 'accord'
                  ? `${content.factions[state.empires[state.winner!].faction].name} leads the Accord. The game is theirs.`
                : `${content.factions[state.empires[state.winner!].faction].name} has won the game.`}
            </p>
            <p className="muted">The game ended on turn {state.turn - 1}.</p>
            <div className="fleet-actions">
              <button type="button" className="btn" onClick={() => setResultSeen(true)}>
                Look at the map
              </button>
              <button type="button" className="btn primary" onClick={onQuit}>
                Main menu
              </button>
            </div>
          </div>
        </div>
      )}
      {showResearch && (
        <ResearchScreen state={state} content={content} player={player} dispatch={session.dispatch} onClose={() => setShowResearch(false)} />
      )}
    </div>
  );
}
