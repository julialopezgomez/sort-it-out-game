/**
 * Error codes.
 *
 * Every RPC raises a stable ASCII token (`NAME_TAKEN`, `ROOM_FULL`, ...) rather than an
 * English sentence, so the same failure can be shown in the reader's own language. This
 * module turns whatever came back from Supabase into one of those tokens plus an i18n key.
 */

export const ERROR_CODES = [
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_CODE_EXHAUSTED',
  'INVALID_ROOM_CODE',
  'GAME_OVER',
  'NAME_TAKEN',
  'INVALID_NAME',
  'INVALID_LANGUAGE',
  'INVALID_SETTINGS',
  'INVALID_PAYLOAD',
  'INVALID_ORDER',
  'INVALID_SLOT',
  'MISSING_SESSION',
  'NOT_IN_ROOM',
  'NOT_HOST',
  'NOT_RANKER',
  'NOT_ALLOWED',
  'NOT_ORDERING',
  'WRONG_PHASE',
  'NO_ACTIVE_TURN',
  'NEED_TWO_PLAYERS',
  'NOT_ENOUGH_CARDS',
  'NOT_ENOUGH_CUSTOM_CARDS',
  'CARDS_INCOMPLETE',
  'CARD_NOT_FOUND',
  'CARD_ALREADY_IN_USE',
  'CARD_NEEDS_TEXT',
  'CARD_TOO_LONG',
  'TOO_MANY_CARDS',
  'MANUAL_CARDS_DISABLED',
  'ALREADY_SUBMITTED',
  'DEADLINE_PASSED',
  'RANKER_CONNECTED',
  'ILLEGAL_TRANSITION',
  'RATE_LIMITED',
  'RESULT_NOT_FOUND',
  'SERVICE_UNAVAILABLE',
  'NOT_CONFIGURED',
  'OFFLINE',
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const CODE_SET = new Set<string>(ERROR_CODES);

export class GameError extends Error {
  readonly code: ErrorCode;
  override readonly cause?: unknown;

  constructor(code: ErrorCode, cause?: unknown) {
    super(code);
    this.name = 'GameError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Supabase wraps a Postgres exception in a PostgrestError whose `message` is our token.
 * Network and project-paused failures arrive as fetch errors instead, which is how the
 * "the site owner needs to wake the database up" screen gets triggered.
 */
export function toGameError(error: unknown): GameError {
  if (error instanceof GameError) return error;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new GameError('OFFLINE', error);
  }

  const message = extractMessage(error);

  if (message && CODE_SET.has(message)) {
    return new GameError(message as ErrorCode, error);
  }

  // A paused free-tier project, DNS failure or CORS rejection all surface as a
  // TypeError from fetch with no useful body.
  if (isNetworkFailure(error, message)) {
    return new GameError('SERVICE_UNAVAILABLE', error);
  }

  return new GameError('UNKNOWN', error);
}

function extractMessage(error: unknown): string | null {
  if (typeof error === 'string') return error.trim();
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message.trim();
  }
  return null;
}

function isNetworkFailure(error: unknown, message: string | null): boolean {
  if (error instanceof TypeError) return true;
  if (!message) return false;
  const lowered = message.toLowerCase();
  return (
    lowered.includes('failed to fetch') ||
    lowered.includes('networkerror') ||
    lowered.includes('load failed') ||
    lowered.includes('fetch failed') ||
    lowered.includes('timeout')
  );
}

/** i18n lookup key for a code, e.g. `errors.NAME_TAKEN`. */
export function errorKey(code: ErrorCode): string {
  return `errors.${code}`;
}

/**
 * Codes that mean "the backend itself is unwell" rather than "you did something
 * invalid". These are the ones that get the owner-facing diagnostic screen.
 */
export function isServiceProblem(code: ErrorCode): boolean {
  return code === 'SERVICE_UNAVAILABLE' || code === 'NOT_CONFIGURED' || code === 'OFFLINE';
}
