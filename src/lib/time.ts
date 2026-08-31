/**
 * Countdowns.
 *
 * The browser clock is never the source of truth. Every RPC response carries the server's
 * `serverNow`, from which we derive a fixed offset; a countdown is then rendered as
 * `deadline - (Date.now() + offset)`. A client whose clock is an hour out still sees a
 * correct timer, and — crucially — the client never decides whether a submission is late.
 * That call belongs to `advance_game_if_needed` in Postgres.
 */

export type ClockOffset = {
  /** Milliseconds to add to the local clock to approximate server time. */
  offsetMs: number;
  measuredAt: number;
};

/**
 * Parse a timestamp the database produced, in milliseconds, or null if it cannot be read.
 *
 * Postgres writes a whole-hour UTC offset as `+00` (and `+02`, `-07`), which `Date.parse`
 * rejects outright — `serverNow` is built with to_char and arrives in exactly that shape.
 * Padding the offset to `+00:00` makes it a string every browser understands.
 */
export function parseServerTime(iso: string | null): number | null {
  if (!iso) return null;

  const direct = Date.parse(iso);
  if (!Number.isNaN(direct)) return direct;

  const padded = iso.replace(/([+-]\d{2})$/, '$1:00');
  const parsed = Date.parse(padded);
  return Number.isNaN(parsed) ? null : parsed;
}

export function computeClockOffset(serverNowIso: string, localNowMs = Date.now()): ClockOffset {
  const serverMs = parseServerTime(serverNowIso);
  if (serverMs === null) {
    return { offsetMs: 0, measuredAt: localNowMs };
  }
  return { offsetMs: serverMs - localNowMs, measuredAt: localNowMs };
}

export function serverNow(offset: ClockOffset | null, localNowMs = Date.now()): number {
  return localNowMs + (offset?.offsetMs ?? 0);
}

/**
 * Milliseconds left on a phase.
 *   null deadline  -> null (unlimited; the UI shows "no time limit", not a fake number)
 *   past deadline  -> 0
 */
export function remainingMs(
  deadlineIso: string | null,
  offset: ClockOffset | null,
  localNowMs = Date.now(),
): number | null {
  const deadlineMs = parseServerTime(deadlineIso);
  if (deadlineMs === null) return null;
  return Math.max(0, deadlineMs - serverNow(offset, localNowMs));
}

/** m:ss, which is how a family reads a clock. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '∞';
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** A whole-seconds view, for aria-live announcements and tests. */
export function remainingSeconds(ms: number | null): number | null {
  if (ms === null) return null;
  return Math.max(0, Math.ceil(ms / 1000));
}

/** Under ten seconds the timer turns urgent (and is announced). */
export function isUrgent(ms: number | null): boolean {
  return ms !== null && ms <= 10_000;
}

/**
 * What a paused game should display. The server preserved the exact remainder when it
 * paused, so the frozen number is shown rather than a running one.
 */
export function pausedRemainingMs(remaining: number | null): number | null {
  if (remaining === null) return null;
  return Math.max(0, remaining);
}

/** Total seconds a Host has chosen, formatted for the settings screen. */
export function formatLimit(seconds: number | null, unlimitedLabel: string): string {
  if (seconds === null) return unlimitedLabel;
  if (seconds % 60 === 0) return `${seconds / 60}:00`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Clamp a Host's custom "+30s / +1min" nudge into the range the database accepts. */
export function clampTimeLimit(seconds: number, min = 5, max = 3600): number {
  return Math.min(max, Math.max(min, Math.round(seconds)));
}
