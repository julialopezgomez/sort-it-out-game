import { describe, expect, it } from 'vitest';
import {
  ALL_PHASES,
  PHASE_TRANSITIONS,
  assertTransition,
  canSkipRankerTurn,
  canTransition,
  effectivePhase,
  isPausable,
  isTerminal,
  isTimedPhase,
} from './stateMachine';
import type { GamePhase } from './types';

/** The legal flow described in the game rules, in order. */
const HAPPY_PATH: GamePhase[] = [
  'lobby',
  'preparing_cards',
  'ranker_ordering',
  'guessers_ordering',
  'reveal',
  'next_turn',
  'preparing_cards',
];

describe('legal state-machine transitions', () => {
  it('walks the whole happy path', () => {
    for (let i = 0; i < HAPPY_PATH.length - 1; i += 1) {
      const from = HAPPY_PATH[i]!;
      const to = HAPPY_PATH[i + 1]!;
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it('can finish after a cycle completes', () => {
    expect(canTransition('next_turn', 'finished')).toBe(true);
  });

  it('allows a skipped Ranker turn from either preparation or ordering', () => {
    expect(canTransition('preparing_cards', 'next_turn')).toBe(true);
    expect(canTransition('ranker_ordering', 'next_turn')).toBe(true);
  });

  it('can pause every in-play phase and return to exactly that phase', () => {
    const inPlay: GamePhase[] = [
      'preparing_cards',
      'ranker_ordering',
      'guessers_ordering',
      'reveal',
      'next_turn',
    ];
    for (const phase of inPlay) {
      expect(canTransition(phase, 'paused'), `${phase} -> paused`).toBe(true);
      expect(canTransition('paused', phase), `paused -> ${phase}`).toBe(true);
    }
  });

  it('never pauses the lobby or a finished game', () => {
    expect(canTransition('lobby', 'paused')).toBe(false);
    expect(canTransition('finished', 'paused')).toBe(false);
    expect(canTransition('cancelled', 'paused')).toBe(false);
  });

  it('lets the Host end a game in progress, landing on finished', () => {
    for (const phase of [
      'preparing_cards',
      'ranker_ordering',
      'guessers_ordering',
      'reveal',
    ] as const) {
      expect(canTransition(phase, 'finished'), `${phase} -> finished`).toBe(true);
    }
    // Ending from the lobby cancels instead: nothing was ever played.
    expect(canTransition('lobby', 'cancelled')).toBe(true);
  });
});

describe('rejected state-machine transitions', () => {
  it('never skips ahead to a reveal', () => {
    expect(canTransition('lobby', 'reveal')).toBe(false);
    expect(canTransition('preparing_cards', 'reveal')).toBe(false);
    expect(canTransition('preparing_cards', 'guessers_ordering')).toBe(false);
  });

  it('never goes backwards', () => {
    expect(canTransition('reveal', 'guessers_ordering')).toBe(false);
    expect(canTransition('guessers_ordering', 'ranker_ordering')).toBe(false);
    expect(canTransition('ranker_ordering', 'preparing_cards')).toBe(false);
    expect(canTransition('preparing_cards', 'lobby')).toBe(false);
  });

  it('treats finished and cancelled as final', () => {
    expect(isTerminal('finished')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    for (const phase of ALL_PHASES) {
      expect(canTransition('finished', phase), `finished -> ${phase}`).toBe(false);
      expect(canTransition('cancelled', phase), `cancelled -> ${phase}`).toBe(false);
    }
  });

  it('never returns to the lobby once a game has begun', () => {
    for (const phase of ALL_PHASES) {
      if (phase === 'lobby') continue;
      expect(canTransition(phase, 'lobby'), `${phase} -> lobby`).toBe(false);
    }
  });

  it('never pauses a pause', () => {
    expect(canTransition('paused', 'paused')).toBe(false);
  });

  it('throws with a recognizable message on an illegal transition', () => {
    expect(() => assertTransition('lobby', 'reveal')).toThrow(/ILLEGAL_TRANSITION/);
    expect(() => assertTransition('lobby', 'preparing_cards')).not.toThrow();
  });

  it('has an entry for every phase, and only names real phases', () => {
    expect(ALL_PHASES).toHaveLength(9);
    for (const [from, targets] of Object.entries(PHASE_TRANSITIONS)) {
      for (const to of targets) {
        expect(ALL_PHASES, `${from} -> ${to}`).toContain(to);
      }
      // No phase may transition to itself.
      expect(targets).not.toContain(from as GamePhase);
    }
  });
});

describe('phase helpers', () => {
  it('knows which phases carry a countdown', () => {
    expect(isTimedPhase('ranker_ordering')).toBe(true);
    expect(isTimedPhase('guessers_ordering')).toBe(true);
    expect(isTimedPhase('reveal')).toBe(true);
    // Card preparation is explicitly never timed.
    expect(isTimedPhase('preparing_cards')).toBe(false);
    expect(isTimedPhase('lobby')).toBe(false);
  });

  it('reports what a paused game is really waiting on', () => {
    expect(effectivePhase('paused', 'ranker_ordering')).toBe('ranker_ordering');
    expect(effectivePhase('paused', null)).toBe('paused');
    expect(effectivePhase('reveal', 'ranker_ordering')).toBe('reveal');
  });

  it('only allows skipping before the Ranker has locked an order in', () => {
    expect(canSkipRankerTurn('preparing_cards')).toBe(true);
    expect(canSkipRankerTurn('ranker_ordering')).toBe(true);
    expect(canSkipRankerTurn('guessers_ordering')).toBe(false);
    expect(canSkipRankerTurn('reveal')).toBe(false);
  });

  it('agrees with the transition table about pausability', () => {
    for (const phase of ALL_PHASES) {
      expect(isPausable(phase)).toBe(PHASE_TRANSITIONS[phase].includes('paused'));
    }
  });
});
