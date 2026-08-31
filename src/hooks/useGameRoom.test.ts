import { describe, expect, it } from 'vitest';
import type { GamePhase } from '../lib/types';
import type { GameStateView } from '../lib/schemas';
import { nextAdvanceDelay } from './useGameRoom';

/**
 * Nothing else in the app moves an expired phase along: GitHub Pages has no scheduler, so
 * if this function declines to schedule a check, the game simply stops. It has to keep
 * scheduling one even when a timestamp is not what it expected.
 */
function stateWith(game: Partial<GameStateView['game']> & { phase: GamePhase }): GameStateView {
  return {
    // Postgres writes this with to_char, so the offset arrives as `+00`, not `+00:00`.
    serverNow: '2026-01-01T12:00:00.000+00',
    game: {
      deadlineAt: null,
      pauseReason: null,
      ...game,
    },
    turn: null,
  } as unknown as GameStateView;
}

describe('scheduling the next nudge', () => {
  it('waits for a deadline written in the shape the database sends', () => {
    const delay = nextAdvanceDelay(
      stateWith({ phase: 'guessers_ordering', deadlineAt: '2026-01-01T12:00:30.000+00' }),
    );
    // 30 seconds away, capped by the poll ceiling.
    expect(delay).toBe(15_000);
  });

  it('schedules a check for just after a deadline that is close', () => {
    const delay = nextAdvanceDelay(
      stateWith({ phase: 'ranker_ordering', deadlineAt: '2026-01-01T12:00:05.000+00' }),
    );
    expect(delay).toBe(5_700);
  });

  it('keeps checking while an expired phase has not moved', () => {
    const phases: GamePhase[] = ['ranker_ordering', 'guessers_ordering', 'reveal'];
    for (const phase of phases) {
      const delay = nextAdvanceDelay(
        stateWith({ phase, deadlineAt: '2026-01-01T11:59:59.000+00' }),
      );
      expect(delay, phase).toBe(1_000);
    }
  });

  it('falls back to the local clock when the server timestamp is unreadable', () => {
    const state = stateWith({
      phase: 'guessers_ordering',
      deadlineAt: '2026-01-01T12:00:10.000Z',
    });
    const broken = { ...state, serverNow: 'not a date' } as GameStateView;
    const delay = nextAdvanceDelay(broken, Date.parse('2026-01-01T12:00:00.000Z'));
    expect(delay).toBe(10_700);
  });

  it('has nothing to schedule where no deadline can pass', () => {
    expect(nextAdvanceDelay(stateWith({ phase: 'lobby' }))).toBeNull();
    expect(nextAdvanceDelay(stateWith({ phase: 'finished' }))).toBeNull();
    expect(nextAdvanceDelay(stateWith({ phase: 'paused', pauseReason: 'manual' }))).toBeNull();
  });

  it('polls a disconnect pause, which can end on its own', () => {
    expect(
      nextAdvanceDelay(stateWith({ phase: 'paused', pauseReason: 'ranker_disconnected' })),
    ).toBe(5_000);
  });
});
