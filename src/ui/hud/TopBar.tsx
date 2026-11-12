import { empireSupport, eraOf, fleetsOf, type Content, type EmpireId, type GameState } from '../../sim';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  onEndTurn: () => void;
  onResearch: () => void;
  onSave: () => void;
  onQuit: () => void;
}

export function TopBar({ state, content, player, onEndTurn, onResearch, onSave, onQuit }: Props) {
  const empire = state.empires[player];
  const faction = content.factions[empire.faction];
  const support = empireSupport(state, player, content);
  const idle = fleetsOf(state, player).filter((f) => !f.destination && f.order === 'none').length;
  return (
    <header className="topbar">
      <div className="topbar-id">
        <span className="brand">Accord</span>
        <span className="dot" style={{ background: faction.color }} />
        <span>{faction.name}</span>
      </div>
      <dl className="topbar-stats">
        <div>
          <dt>Turn</dt>
          <dd data-testid="turn">{state.turn}</dd>
        </div>
        <div>
          <dt>Era</dt>
          <dd data-testid="era">{eraOf(empire.research, content)}</dd>
        </div>
        <div>
          <dt>Fleet support</dt>
          <dd data-testid="support">
            {support.used} / {support.cap}
          </dd>
        </div>
        <div>
          <dt>Idle fleets</dt>
          <dd data-testid="idle-fleets">{idle}</dd>
        </div>
        <div>
          <dt>Intel</dt>
          <dd data-testid="intel-pool">{empire.intelPool}</dd>
        </div>
      </dl>
      <div className="topbar-actions">
        <button type="button" className="btn" onClick={onQuit}>
          Main menu
        </button>
        <button type="button" className="btn" onClick={onSave}>
          Save file
        </button>
        <button type="button" className="btn" onClick={onResearch}>
          Research
        </button>
        <button type="button" className="btn primary" onClick={onEndTurn}>
          End turn
        </button>
      </div>
    </header>
  );
}
