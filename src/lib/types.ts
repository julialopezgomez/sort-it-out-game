/**
 * Shared domain vocabulary.
 *
 * The words used here are the words used in the UI, the SQL and the docs:
 *
 *   Game    the whole session, from lobby to final results
 *   Cycle   one complete rotation in which every active player is Ranker once
 *   Turn    one player is Ranker, everyone else eligible is a Guesser
 *   Ranker  the player privately choosing and ordering five cards
 *   Guesser a player trying to reproduce the Ranker's order
 *   Host    the player who created the room
 */

export type Language = 'en' | 'es';

export const LANGUAGES: readonly Language[] = ['en', 'es'] as const;

/** The canonical card shape. One id, localized fields, language-independent identity. */
export type Card = {
  id: string;
  textEn: string | null;
  textEs: string | null;
  source: 'factory' | 'custom';
  createdAt: string;
};

export type GamePhase =
  | 'lobby'
  | 'preparing_cards'
  | 'ranker_ordering'
  | 'guessers_ordering'
  | 'reveal'
  | 'paused'
  | 'next_turn'
  | 'finished'
  | 'cancelled';

export type PauseReason = 'manual' | 'ranker_disconnected';

/** null seconds means "unlimited" everywhere in this codebase — never a fake far-off date. */
export type GameSettings = {
  totalCycles: number;
  rankerSeconds: number | null;
  guesserSeconds: number | null;
  allowManualCards: boolean;
};

export const PLAYER_MIN = 2;
export const PLAYER_MAX = 30;
export const CARDS_PER_TURN = 5;
export const CYCLES_MIN = 1;
export const CYCLES_MAX = 10;
export const NAME_MAX_LENGTH = 24;
export const CARD_TEXT_MAX_LENGTH = 80;

/** Heartbeat cadence and the silence after which a player counts as disconnected. */
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const DISCONNECT_AFTER_MS = 30_000;

/** How long the reveal stays on screen before the game moves itself along. */
export const REVEAL_SECONDS = 10;

/** Offered as buttons; the Host can also nudge a custom value with +30s / +1min. */
export const RANKER_TIME_PRESETS: readonly (number | null)[] = [
  15,
  30,
  45,
  60,
  90,
  120,
  null,
] as const;

/** Same options plus 5 minutes, which is enough for the group to argue it out. */
export const GUESSER_TIME_PRESETS: readonly (number | null)[] = [
  15,
  30,
  45,
  60,
  90,
  120,
  300,
  null,
] as const;

export const TIME_LIMIT_MIN_SECONDS = 5;
export const TIME_LIMIT_MAX_SECONDS = 3600;
