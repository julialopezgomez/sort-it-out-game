import type { GamePhase } from './types';

/**
 * The one and only description of legal phase transitions.
 *
 * This table is mirrored by `public._can_transition` in
 * supabase/migrations/0040_helpers.sql. The database copy is the one that actually
 * guards the data; this copy exists so the UI can reason about what is coming next, and
 * so the rules are unit-testable without a database. `stateMachine.test.ts` asserts the
 * table's shape, and supabase/tests/game_flow.sql asserts the SQL copy agrees.
 */
export const PHASE_TRANSITIONS: Readonly<Record<GamePhase, readonly GamePhase[]>> = {
  lobby: ['preparing_cards', 'cancelled'],
  preparing_cards: ['ranker_ordering', 'next_turn', 'paused', 'cancelled', 'finished'],
  ranker_ordering: ['guessers_ordering', 'next_turn', 'paused', 'cancelled', 'finished'],
  guessers_ordering: ['reveal', 'paused', 'cancelled', 'finished'],
  reveal: ['next_turn', 'paused', 'cancelled', 'finished'],
  next_turn: ['preparing_cards', 'finished', 'paused', 'cancelled'],
  paused: [
    'preparing_cards',
    'ranker_ordering',
    'guessers_ordering',
    'reveal',
    'next_turn',
    'cancelled',
    'finished',
  ],
  finished: [],
  cancelled: [],
};

export const ALL_PHASES = Object.keys(PHASE_TRANSITIONS) as GamePhase[];

export function canTransition(from: GamePhase, to: GamePhase): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: GamePhase, to: GamePhase): void {
  if (!canTransition(from, to)) {
    throw new Error(`ILLEGAL_TRANSITION: ${from} -> ${to}`);
  }
}

/** A phase from which nothing further can happen. */
export function isTerminal(phase: GamePhase): boolean {
  return PHASE_TRANSITIONS[phase].length === 0;
}

/** Phases in which a game is being actively played (so a Host may pause it). */
export function isPausable(phase: GamePhase): boolean {
  return canTransition(phase, 'paused');
}

/** Phases where a countdown may be running. Card preparation is deliberately untimed. */
export function isTimedPhase(phase: GamePhase): boolean {
  return phase === 'ranker_ordering' || phase === 'guessers_ordering' || phase === 'reveal';
}

/**
 * While paused, `paused_from_phase` is what the players are really waiting on. The UI
 * needs that to decide which screen to draw behind the pause overlay.
 */
export function effectivePhase(phase: GamePhase, pausedFrom: GamePhase | null): GamePhase {
  return phase === 'paused' && pausedFrom ? pausedFrom : phase;
}

/** A Ranker turn can only be abandoned before the Ranker has locked in an order. */
export function canSkipRankerTurn(effective: GamePhase): boolean {
  return effective === 'preparing_cards' || effective === 'ranker_ordering';
}
