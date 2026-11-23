import type { PendingBattles } from '../../game/session';
import type { BattleSetup, Content, EmpireId, GameState } from '../../sim';
import { placeName } from '../format';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  battles: PendingBattles;
  onFight: (setup: BattleSetup) => void;
  onAuto: (setup: BattleSetup) => void;
}

/** What one side brings to a battle, as "2 Frigate, 1 Battery". */
function forces(setup: BattleSetup, empire: EmpireId): string {
  const counts = new Map<string, number>();
  for (const u of setup.units) if (u.empire === empire) counts.set(u.name, (counts.get(u.name) ?? 0) + 1);
  return [...counts].map(([name, n]) => `${n} ${name}`).join(', ');
}

/** Before the turn resolves: each battle the player is in, to fight or to auto-resolve. */
export function BattlePrompt({ state, content, player, battles, onFight, onAuto }: Props) {
  const name = (id: EmpireId) => (id === player ? 'You' : (content.factions[state.empires[id]?.faction]?.name ?? id));
  const open = battles.setups.filter((b) => !(b.key in battles.decided));
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Battle ahead">
        <header className="modal-head">
          <div>
            <h2>{open.length === 1 ? 'Battle ahead' : `${open.length} battles ahead`}</h2>
            <p className="muted">Command your ships yourself, or let the battle be auto-resolved.</p>
          </div>
        </header>
        <ul className="battle-prompt">
          {battles.setups.map((setup) => {
            const decided = battles.decided[setup.key];
            const empires = [...new Set(setup.units.map((u) => u.empire))].sort((a, b) => (a === player ? -1 : b === player ? 1 : a < b ? -1 : 1));
            return (
              <li key={setup.key}>
                <h3>Battle at {placeName(state, setup.sector)}</h3>
                <ul className="planet-list">
                  {empires.map((id) => (
                    <li key={id}>
                      <span>
                        <span className="dot" style={{ background: content.factions[state.empires[id]?.faction]?.color }} /> {name(id)}
                      </span>
                      <span className="muted">{forces(setup, id)}</span>
                    </li>
                  ))}
                </ul>
                {decided ? (
                  <p className="muted">{decided === 'auto' ? 'Will be auto-resolved.' : 'Fought.'}</p>
                ) : (
                  <div className="fleet-actions">
                    <button type="button" className="btn primary" onClick={() => onFight(setup)}>
                      Fight
                    </button>
                    <button type="button" className="btn" onClick={() => onAuto(setup)}>
                      Auto-resolve
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
