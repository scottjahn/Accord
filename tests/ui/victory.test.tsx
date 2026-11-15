// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startNewGame } from '../../src/game/session';
import { FIELDS, getEmpireView } from '../../src/sim';
import { victoryText } from '../../src/ui/format';
import { EmpiresScreen } from '../../src/ui/war/EmpiresScreen';
import { ALPHA, fixtureContent } from '../fixture';

afterEach(cleanup);

describe('ways to win on the Empires screen', () => {
  it('shows each open path with the player’s own progress and its rule', () => {
    const content = fixtureContent();
    content.rules.victory.researchLevels = 60;
    content.rules.victory.wealthCredits = 9000;
    content.rules.victory.scoreTurn = 400;
    const state = startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' });
    for (const field of FIELDS) state.empires[ALPHA].research.levels[field] = 2;
    state.empires[ALPHA].credits = 123;
    render(<EmpiresScreen state={state} content={content} player={ALPHA} view={getEmpireView(state, ALPHA, content)} dispatch={vi.fn()} onClose={vi.fn()} />);

    const list = screen.getByRole('list', { name: 'Ways to win' });
    expect(within(list).getByTestId('victory-research').textContent).toBe('12 / 60');
    expect(within(list).getByTestId('victory-wealth').textContent).toBe('123 / 9000');
    expect(within(list).getByTestId('victory-domination').textContent).toBe('0 / 1');
    expect(within(list).getByText('Hold 9000 credits in the treasury.')).toBeTruthy();
    expect(within(list).getByText('If nobody has won after turn 400, the highest score wins.')).toBeTruthy();
  });

  it('leaves out a path that is switched off', () => {
    const content = fixtureContent();
    const state = startNewGame(content, { seed: 3, preset: 'tiny', faction: 'alpha' });
    render(<EmpiresScreen state={state} content={content} player={ALPHA} view={getEmpireView(state, ALPHA, content)} dispatch={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId('victory-wealth')).toBeNull();
    expect(screen.getByTestId('victory-domination')).toBeTruthy();
  });
});

describe('how the game ended', () => {
  it('is worded for the winner and for everyone else, by kind of victory', () => {
    expect(victoryText('wealth', 'Orrin Exchange', false)).toBe('Orrin Exchange has bought the galaxy. The game is theirs.');
    expect(victoryText('research', 'The Concord', true)).toBe('Your scholars have mastered every field. No rival can catch you now.');
    expect(victoryText('score', 'Kessic Union', false)).toBe('Time has run out. Kessic Union stands above the rest.');
    expect(victoryText('domination', 'Vashran Dominate', false)).toBe('Vashran Dominate has overpowered its rivals. The game is theirs.');
    expect(victoryText('accord', 'The Concord', false)).toBe('The Concord leads the Accord. The game is theirs.');
    expect(victoryText(null, 'The Concord', false)).toBe('The Concord has won the game.');
    expect(victoryText('conquest', 'The Concord', true)).toBe('Your rivals are beaten. The galaxy is yours.');
  });
});
