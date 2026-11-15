import { creditIncome, empireSupport, eraOf, fleetsOf, type Content, type EmpireId, type GameState } from '../../sim';
import { SKIP_LIMIT } from '../../game/skip';
import { lineValue, signed } from '../format';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  onEndTurn: () => void;
  /** Ends turns until something needs the player. */
  onSkipAhead: () => void;
  onHelp: () => void;
  onResearch: () => void;
  onEmpires: () => void;
  onIntel: () => void;
  onSystems: () => void;
  /** Treaty offers waiting for the player's answer. */
  offers: number;
  /** How many empires the player is at war with. */
  wars: number;
  /** True once the game has a winner. */
  over: boolean;
  onSave: () => void;
  onQuit: () => void;
}

export function TopBar({ state, content, player, onEndTurn, onSkipAhead, onHelp, onResearch, onEmpires, onIntel, onSystems, offers, wars, over, onSave, onQuit }: Props) {
  const empire = state.empires[player];
  const faction = content.factions[empire.faction];
  const support = empireSupport(state, player, content);
  const idle = fleetsOf(state, player).filter((f) => !f.destination && f.order === 'none').length;
  const income = creditIncome(state, player, content);
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
        <div title={income.lines.map((l) => `${l.source}: ${lineValue(l)}`).join('\n') || 'No income'}>
          <dt>Credits</dt>
          <dd>
            <span data-testid="credits">{empire.credits}</span>{' '}
            <span className="muted" data-testid="credit-income">
              ({signed(income.total)})
            </span>
          </dd>
        </div>
        <div>
          <dt>Intel</dt>
          <dd data-testid="intel-pool">{empire.intelPool}</dd>
        </div>
      </dl>
      <div className="topbar-actions">
        <button type="button" className="btn" onClick={onQuit} aria-label="Main menu" title="Back to the main menu; the game is saved">
          Menu
        </button>
        <button type="button" className="btn" onClick={onHelp} aria-label="Help" title="How to play and keyboard shortcuts (H)">
          ?
        </button>
        <button type="button" className="btn" onClick={onSave} title="Save to a slot or download a file (G)">
          Save
        </button>
        <button type="button" className="btn" onClick={onSystems}>
          Systems
        </button>
        <button type="button" className="btn" onClick={onResearch}>
          Research
        </button>
        <button type="button" className="btn" onClick={onIntel}>
          Intel
        </button>
        <button type="button" className={`btn${wars > 0 ? ' danger' : offers > 0 ? ' primary' : ''}`} onClick={onEmpires}>
          {wars > 0 ? 'Empires (at war)' : offers > 0 ? `Empires (${offers} ${offers === 1 ? 'offer' : 'offers'})` : 'Empires'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={onSkipAhead}
          disabled={over}
          title={over ? 'The game is over' : `End up to ${SKIP_LIMIT} turns, stopping as soon as something needs you (Shift + Enter)`}
        >
          Skip ahead
        </button>
        <button type="button" className="btn primary" onClick={onEndTurn} disabled={over} title={over ? 'The game is over' : 'End the turn (Enter)'}>
          End turn
        </button>
      </div>
    </header>
  );
}
