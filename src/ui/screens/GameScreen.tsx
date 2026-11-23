import { useEffect, useMemo, useRef, useState } from 'react';
import { idleText, placeName, victoryText } from '../format';
import { saveFileName } from '../../game/persistence';
import type { GameSession } from '../../game/session';
import { SKIP_LIMIT } from '../../game/skip';
import {
  atWar,
  getEmpireView,
  idleReport,
  sameSector,
  sortedKeys,
  systemAt,
  validateCommand,
  type BattleSetup,
  type Command,
  type EmpireId,
  type FleetId,
  type Sector,
  type SystemId,
  type TurnEvent,
} from '../../sim';
import { BattlePrompt } from '../battle/BattlePrompt';
import { BattleScreen } from '../battle/BattleScreen';
import { FleetPanel } from '../fleet/FleetPanel';
import { HelpScreen } from '../help/HelpScreen';
import { hotkeyAction } from '../hotkeys';
import { EventLog } from '../hud/EventLog';
import { TopBar } from '../hud/TopBar';
import { GalaxyMap } from '../map/GalaxyMap';
import { ResearchScreen } from '../research/ResearchScreen';
import { SystemPanel } from '../system/SystemPanel';
import { SystemsScreen } from '../system/SystemsScreen';
import { EmpireScreen } from './EmpireScreen';
import { SaveScreen } from './SaveScreen';
import { useSession } from '../useSession';
import { EmpiresScreen } from '../war/EmpiresScreen';
import { IntelScreen } from '../war/IntelScreen';
import { ReportScreen } from '../war/ReportScreen';

interface Props {
  session: GameSession;
  onQuit: () => void;
}

type Selection = { kind: 'system'; id: SystemId } | { kind: 'fleet'; id: FleetId } | null;
/** The full-screen page that is open, if any. */
type Screen = 'empire' | 'research' | 'empires' | 'intel' | 'systems' | 'help' | 'save' | null;

const SKIP_IDLE_KEY = 'accord.skipIdleWarning';

// A per-player convenience; the game works the same if browser storage is unavailable.
function readSkipIdleWarning(): boolean {
  try {
    return localStorage.getItem(SKIP_IDLE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeSkipIdleWarning(skip: boolean): void {
  try {
    if (skip) localStorage.setItem(SKIP_IDLE_KEY, '1');
    else localStorage.removeItem(SKIP_IDLE_KEY);
  } catch {
    // Nothing to do: the choice still holds for this session.
  }
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
  const { state, player, lastEvents, turnsPlayed, lastError, battles } = useSession(session);
  const { content } = session;
  /** The battle the player chose to fight, while its screen is open. */
  const [fighting, setFighting] = useState<BattleSetup | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'system', id: state.empires[player].homeSystem });
  const [moveMode, setMoveMode] = useState(false);
  const [screen, setScreen] = useState<Screen>(null);
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

  const idle = useMemo(() => idleReport(state, player, content), [state, player, content]);
  const waiting = idle.filter((item) => item.blocking);
  /** Set while the idle warning is up: which way of ending the turn is waiting on the answer. */
  const [confirmEnd, setConfirmEnd] = useState<'turn' | 'skip' | null>(null);
  const [skipIdleWarning, setSkipIdleWarning] = useState(readSkipIdleWarning);
  const endTurn = (how: 'turn' | 'skip') => {
    setConfirmEnd(null);
    const sector = ownFleet?.sector ?? null;
    if (how === 'skip') session.skipAhead(SKIP_LIMIT);
    else session.endTurn();
    // A selected colony ship that has just founded its colony is gone: show the colony instead
    // of an empty panel.
    if (selection?.kind !== 'fleet' || !sector) return;
    const now = session.getSnapshot().state;
    if (now.fleets[selection.id]) return;
    const here = systemAt(now, sector);
    if (here?.colony?.owner === player) setSelection({ kind: 'system', id: here.id });
  };
  /** Ends the turn, first asking if the player means to leave things idle. */
  const requestEndTurn = (how: 'turn' | 'skip' = 'turn') => {
    if (over) return;
    if (waiting.length > 0 && !skipIdleWarning) setConfirmEnd(how);
    else endTurn(how);
  };

  const battleSides = (setup: BattleSetup): Record<EmpireId, { name: string; color: string }> => {
    const sides = {} as Record<EmpireId, { name: string; color: string }>;
    for (const u of setup.units) {
      const faction = content.factions[state.empires[u.empire].faction];
      sides[u.empire] = { name: u.empire === player ? `You (${faction.name})` : faction.name, color: faction.color };
    }
    return sides;
  };

  const select = (next: Selection) => {
    setSelection(next);
    setMoveMode(false);
  };

  /** Steps through the idle colonies and ships, one per press. */
  const idleCursor = useRef(0);
  const selectNextIdle = () => {
    const targets = idle.filter((item) => item.kind !== 'unsettled');
    if (targets.length === 0) return;
    const item = targets[idleCursor.current++ % targets.length];
    select('fleet' in item ? { kind: 'fleet', id: item.fleet } : { kind: 'system', id: item.system });
  };

  // Keyboard shortcuts. One listener for the life of the screen; it calls whatever the latest
  // render put in the ref, so it always sees current state.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    const action = hotkeyAction({
      key: e.key,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      targetTag: e.target instanceof Element ? e.target.tagName : null,
    });
    if (!action) return;
    // A waiting battle has the screen to itself until it is decided.
    if (battles) return;
    const result = over && !resultSeen;
    if (action === 'close') {
      if (confirmEnd) setConfirmEnd(null);
      else if (report) setReport(null);
      else if (screen) setScreen(null);
      else if (result) setResultSeen(true);
      else setMoveMode(false);
      return;
    }
    // With a window open, the keys belong to it.
    if (confirmEnd || report || screen || result) return;
    e.preventDefault();
    if (action === 'endTurn') requestEndTurn('turn');
    else if (action === 'skipAhead') requestEndTurn('skip');
    else if (action === 'nextIdle') selectNextIdle();
    else if (action === 'move') setMoveMode(ownFleet !== undefined);
    else setScreen(action);
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  /**
   * Sends the selected fleet to a sector. It only travels: founding a colony
   * and landing troops are their own orders, given once the fleet is there.
   */
  const sendFleet = (sector: Sector) => {
    if (!ownFleet) return;
    setMoveMode(false);
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
        onEndTurn={() => requestEndTurn('turn')}
        onSkipAhead={() => requestEndTurn('skip')}
        onResearch={() => setScreen('research')}
        onEmpires={() => setScreen('empires')}
        onIntel={() => setScreen('intel')}
        onSystems={() => setScreen('systems')}
        onEmpire={() => setScreen('empire')}
        onHelp={() => setScreen('help')}
        offers={offers}
        wars={wars}
        over={over}
        onSave={() => setScreen('save')}
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
          <EventLog
            state={state}
            content={content}
            player={player}
            events={lastEvents}
            idle={idle}
            turnsPlayed={turnsPlayed}
            onOpenReport={setReport}
            onSelectSystem={(id) => select({ kind: 'system', id })}
            onSelectFleet={(id) => select({ kind: 'fleet', id })}
          />
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
      {confirmEnd && (
        <div className="modal-backdrop" onClick={() => setConfirmEnd(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="End turn?" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <div>
                <h2>End turn?</h2>
                <p className="muted">These will do nothing this turn:</p>
              </div>
            </header>
            <ul className="planet-list" aria-label="Left idle">
              {waiting.map((item, i) => (
                <li key={i}>{idleText(item, state)}</li>
              ))}
            </ul>
            <label className="skip-warning">
              <input
                type="checkbox"
                checked={skipIdleWarning}
                onChange={(e) => {
                  setSkipIdleWarning(e.target.checked);
                  writeSkipIdleWarning(e.target.checked);
                }}
              />{' '}
              Don't warn me about idle colonies and ships again
            </label>
            <div className="fleet-actions">
              <button type="button" className="btn primary" onClick={() => setConfirmEnd(null)}>
                Go back
              </button>
              <button type="button" className="btn" onClick={() => endTurn(confirmEnd)}>
                {confirmEnd === 'skip' ? 'Skip ahead anyway' : 'End turn anyway'}
              </button>
            </div>
          </div>
        </div>
      )}
      {screen === 'empires' && (
        <EmpiresScreen state={state} content={content} player={player} view={view} dispatch={session.dispatch} onClose={() => setScreen(null)} />
      )}
      {screen === 'empire' && (
        <EmpireScreen
          state={state}
          content={content}
          player={player}
          onSelectSystem={(id) => select({ kind: 'system', id })}
          onSelectFleet={(id) => select({ kind: 'fleet', id })}
          onClose={() => setScreen(null)}
        />
      )}
      {screen === 'systems' && (
        <SystemsScreen state={state} content={content} player={player} onSelect={(id) => select({ kind: 'system', id })} onClose={() => setScreen(null)} />
      )}
      {screen === 'intel' && <IntelScreen state={state} content={content} player={player} dispatch={session.dispatch} onClose={() => setScreen(null)} />}
      {screen === 'help' && <HelpScreen state={state} content={content} player={player} onClose={() => setScreen(null)} />}
      {screen === 'save' && (
        <SaveScreen
          state={state}
          content={content}
          onDownload={() => downloadText(saveFileName(state), session.exportSave())}
          onClose={() => setScreen(null)}
        />
      )}
      {report && <ReportScreen state={state} content={content} player={player} event={report} onClose={() => setReport(null)} />}
      {over && !resultSeen && (
        <div className="modal-backdrop">
          <div className="modal result" role="dialog" aria-modal="true" aria-label="Game over">
            <h2>{state.winner === player ? 'Victory' : 'Defeat'}</h2>
            <p>
              {victoryText(state.victory, content.factions[state.empires[state.winner!].faction].name, state.winner === player)}
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
      {screen === 'research' && (
        <ResearchScreen state={state} content={content} player={player} dispatch={session.dispatch} onClose={() => setScreen(null)} />
      )}
      {battles && !fighting && (
        <BattlePrompt
          state={state}
          content={content}
          player={player}
          battles={battles}
          onFight={setFighting}
          onAuto={(setup) => session.decideBattle(setup.key, 'auto')}
        />
      )}
      {battles && fighting && (
        <BattleScreen
          key={fighting.key}
          content={content}
          setup={fighting}
          options={battles.options[fighting.key]}
          title={`Battle at ${placeName(state, fighting.sector)}`}
          sides={battleSides(fighting)}
          onFinish={(outcome) => {
            setFighting(null);
            session.decideBattle(fighting.key, outcome);
          }}
        />
      )}
    </div>
  );
}
