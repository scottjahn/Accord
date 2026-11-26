import { describe, expect, it } from 'vitest';
import { HOTKEYS, hotkeyAction, type KeyPress } from '../../src/ui/hotkeys';

const press = (key: string, more: Partial<KeyPress> = {}): KeyPress => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  targetTag: 'BODY',
  ...more,
});

describe('hotkeys', () => {
  it('maps each key to its action, in either case', () => {
    expect(hotkeyAction(press('Enter'))).toBe('endTurn');
    expect(hotkeyAction(press('Enter', { shiftKey: true }))).toBe('skipAhead');
    expect(hotkeyAction(press('r'))).toBe('research');
    expect(hotkeyAction(press('R', { shiftKey: true }))).toBe('research');
    expect(hotkeyAction(press('d'))).toBe('empires');
    expect(hotkeyAction(press('i'))).toBe('intel');
    expect(hotkeyAction(press('s'))).toBe('systems');
    expect(hotkeyAction(press('g'))).toBe('save');
    expect(hotkeyAction(press('h'))).toBe('help');
    expect(hotkeyAction(press('?', { shiftKey: true }))).toBe('help');
    expect(hotkeyAction(press('n'))).toBe('nextIdle');
    expect(hotkeyAction(press('m'))).toBe('move');
    expect(hotkeyAction(press('Escape'))).toBe('close');
    expect(hotkeyAction(press('x'))).toBeNull();
  });

  it('leaves typing in a form field alone, apart from Escape', () => {
    for (const targetTag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(hotkeyAction(press('r', { targetTag }))).toBeNull();
      expect(hotkeyAction(press('Enter', { targetTag }))).toBeNull();
      expect(hotkeyAction(press('Escape', { targetTag }))).toBe('close');
    }
  });

  it('lets Enter press a focused button instead of ending the turn', () => {
    expect(hotkeyAction(press('Enter', { targetTag: 'BUTTON' }))).toBeNull();
    expect(hotkeyAction(press('r', { targetTag: 'BUTTON' }))).toBe('research');
  });

  it('never takes a browser shortcut', () => {
    expect(hotkeyAction(press('r', { ctrlKey: true }))).toBeNull();
    expect(hotkeyAction(press('s', { metaKey: true }))).toBeNull();
    expect(hotkeyAction(press('Enter', { altKey: true }))).toBeNull();
  });

  it('lists every action once for the help page', () => {
    const actions = HOTKEYS.map((h) => h.action);
    expect(new Set(actions).size).toBe(actions.length);
    expect(actions).toContain('endTurn');
    expect(actions).toContain('close');
  });
});
