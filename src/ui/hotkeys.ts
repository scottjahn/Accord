export type HotkeyAction =
  | 'endTurn'
  | 'skipAhead'
  | 'nextIdle'
  | 'move'
  | 'research'
  | 'empire'
  | 'empires'
  | 'intel'
  | 'systems'
  | 'save'
  | 'help'
  | 'close';

/** The keys, in the order the help page lists them. */
export const HOTKEYS: { keys: string; action: HotkeyAction; does: string }[] = [
  { keys: 'Enter', action: 'endTurn', does: 'End the turn' },
  { keys: 'Shift + Enter', action: 'skipAhead', does: 'Skip ahead until something needs you' },
  { keys: 'N', action: 'nextIdle', does: 'Jump to the next idle colony or ship' },
  { keys: 'M', action: 'move', does: 'Move the selected fleet (then click a sector)' },
  { keys: 'O', action: 'empire', does: 'Open Your empire: every colony and fleet' },
  { keys: 'R', action: 'research', does: 'Open Research' },
  { keys: 'E', action: 'empires', does: 'Open Empires' },
  { keys: 'I', action: 'intel', does: 'Open Intel' },
  { keys: 'S', action: 'systems', does: 'Open Systems' },
  { keys: 'G', action: 'save', does: 'Open Save game' },
  { keys: 'H or ?', action: 'help', does: 'Open this help page' },
  { keys: 'Esc', action: 'close', does: 'Close the open window, or cancel a move' },
];

const LETTERS: Record<string, HotkeyAction> = {
  n: 'nextIdle',
  m: 'move',
  o: 'empire',
  r: 'research',
  e: 'empires',
  i: 'intel',
  s: 'systems',
  g: 'save',
  h: 'help',
  '?': 'help',
};

export interface KeyPress {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** Tag name of the element that has focus, in capitals, or null. */
  targetTag: string | null;
}

/**
 * Which action a key press means, or null if it is not a hotkey. Keys typed
 * into a form field are left alone, and Enter on a focused button presses that
 * button instead of ending the turn. Browser shortcuts (Ctrl, Alt, Cmd) are
 * never taken.
 */
export function hotkeyAction(press: KeyPress): HotkeyAction | null {
  if (press.ctrlKey || press.metaKey || press.altKey) return null;
  if (press.key === 'Escape') return 'close';
  const tag = press.targetTag;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null;
  if (press.key === 'Enter') {
    if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return null;
    return press.shiftKey ? 'skipAhead' : 'endTurn';
  }
  return LETTERS[press.key.toLowerCase()] ?? null;
}
