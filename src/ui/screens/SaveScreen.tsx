import { useState } from 'react';
import { browserStorage, listSlots, writeSlot, type SaveSlot } from '../../game/persistence';
import { humanEmpire } from '../../game/session';
import type { Content, GameState } from '../../sim';

interface Props {
  state: GameState;
  content: Content;
  onDownload: () => void;
  onClose: () => void;
}

/** One line on what a slot holds. */
export function slotText(slot: SaveSlot, content: Content): string {
  if (slot.problem) return `Cannot be loaded: ${slot.problem}`;
  if (!slot.game) return 'Empty';
  const human = humanEmpire(slot.game);
  const faction = human ? content.factions[slot.game.empires[human].faction]?.name : null;
  return `${faction ?? 'Unknown power'}, turn ${slot.game.turn}, ${slot.game.difficulty}, seed ${slot.game.seed}`;
}

/** Save the game into one of the browser's slots, or download it as a file. */
export function SaveScreen({ state, content, onDownload, onClose }: Props) {
  const [slots, setSlots] = useState(() => listSlots(browserStorage()));
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  const save = (slot: number) => {
    const ok = writeSlot(browserStorage(), slot, state);
    setMessage(
      ok
        ? { text: `Saved to slot ${slot}.`, bad: false }
        : { text: 'Could not save: the browser has no room or blocks storage. Download the file instead.', bad: true },
    );
    setSlots(listSlots(browserStorage()));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Save game" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Save game</h2>
            <p className="muted">The game also saves itself every turn. Slots live in this browser only.</p>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <ul className="building-list" aria-label="Save slots">
          {slots.map((slot) => (
            <li key={slot.slot}>
              <div className="building-info">
                <span>Slot {slot.slot}</span>
                <span className="muted">{slotText(slot, content)}</span>
              </div>
              <button type="button" className="btn small" aria-label={`Save to slot ${slot.slot}`} onClick={() => save(slot.slot)}>
                {slot.game || slot.problem ? 'Overwrite' : 'Save here'}
              </button>
            </li>
          ))}
        </ul>
        {message && (
          <p className={message.bad ? 'error' : 'ok-note'} role="status">
            {message.text}
          </p>
        )}
        <div className="fleet-actions">
          <button type="button" className="btn" onClick={onDownload}>
            Download save file
          </button>
        </div>
      </div>
    </div>
  );
}
