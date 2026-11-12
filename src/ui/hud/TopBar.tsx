import type { Content, EmpireId, GameState } from '../../sim';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  onEndTurn: () => void;
  onSave: () => void;
  onQuit: () => void;
}

export function TopBar({ state, content, player, onEndTurn, onSave, onQuit }: Props) {
  const empire = state.empires[player];
  const faction = content.factions[empire.faction];
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
          <dt>Research</dt>
          <dd data-testid="research-pool">{empire.researchPool}</dd>
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
        <button type="button" className="btn primary" onClick={onEndTurn}>
          End turn
        </button>
      </div>
    </header>
  );
}
