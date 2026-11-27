import { SKIP_LIMIT } from '../../game/skip';
import { victoryPaths, type Content, type EmpireId, type GameState } from '../../sim';
import { HOTKEYS } from '../hotkeys';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  onClose: () => void;
}

/** How to play, the ways to win this game, and the keyboard shortcuts. */
export function HelpScreen({ state, content, player, onClose }: Props) {
  const paths = victoryPaths(state, player, content);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide help" role="dialog" aria-modal="true" aria-label="Help" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>How to play</h2>
            <p className="muted">Give your orders, then end the turn. Every empire moves at once.</p>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <div className="help-columns">
          <section>
            <h3>Your turn</h3>
            <ul>
              <li>
                <strong>Colonies.</strong> Click a system to see it. A governor places its workers; raise a slider to place some by hand. Keep
                something in the build queue.
              </li>
              <li>
                <strong>Fleets.</strong> Click a fleet, then right-click a sector to send it. Fleets must stay within supply range of a colony.
              </li>
              <li>
                <strong>Expanding.</strong> Send a colony ship to a free system and choose Found colony. Scouts reveal what is out there.
              </li>
              <li>
                <strong>Borders.</strong> The sectors near your colonies are your territory, outlined on the map. No one may settle inside another
                empire&apos;s border, and only scouts may cross it unless you are at war or have open borders or an alliance. A troop transport
                can build an outpost in empty space to push your border out; enemies at war take it if nothing armed of yours guards it.
                Borders breed tension: neighbours whose territory touches yours think a little less of you every ten turns unless you
                share open borders or an alliance, and pushing your border into space they claimed angers them more. Resentful rivals go to war sooner.
              </li>
              <li>
                <strong>Minor races.</strong> Independent peoples can be courted until they join you, bought if your power can, or conquered.
              </li>
              <li>
                <strong>Other empires.</strong> The Diplomacy page holds treaties, offers, gifts and war. A new peace cannot be broken for the first 10 turns. At war you can pay for peace with credits (held until they answer) and colonies other than your home; a power that is winning names its price. The Intel page runs covert operations.
              </li>
              <li>
                <strong>War.</strong> Warships fight when hostile fleets share a sector. Send troop transports to a colony to invade it.
              </li>
              <li>
                <strong>Idle list.</strong> The turn report lists colonies and ships with nothing to do. Click one to jump to it.
              </li>
              <li>
                <strong>Skip ahead</strong> ends up to {SKIP_LIMIT} turns in a row and stops as soon as something needs you: a ship arrives, a
                queue empties, an offer comes in, or you are attacked.
              </li>
              <li>
                <strong>Saving.</strong> The game saves itself every turn. Save game keeps a copy in one of three slots or downloads a file.
              </li>
            </ul>
          </section>

          <section>
            <h3>Ways to win</h3>
            <ul aria-label="Ways to win explained">
              {paths.map((path) => (
                <li key={path.kind}>
                  <strong>{path.label}.</strong> {path.note}
                </li>
              ))}
            </ul>
            <p className="muted hint">Your progress on each is on the Diplomacy page.</p>

            <h3 className="spaced">Keys</h3>
            <table className="keys">
              <tbody>
                {HOTKEYS.map((hotkey) => (
                  <tr key={hotkey.action}>
                    <th scope="row">
                      <kbd>{hotkey.keys}</kbd>
                    </th>
                    <td>{hotkey.does}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted hint">On the map: drag to pan, scroll to zoom, click to select, right-click to send a fleet.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
