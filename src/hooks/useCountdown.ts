import { useEffect, useState } from 'react';
import { remainingMs, type ClockOffset } from '../lib/time';

/**
 * A ticking countdown derived from the server deadline and the measured clock offset.
 *
 * It only displays; it never decides. Reaching zero here means "show 0:00", not "this
 * submission is late" — that verdict belongs to advance_game_if_needed in Postgres.
 */
export function useCountdown(
  deadlineAt: string | null,
  offset: ClockOffset | null,
  options: { paused?: boolean; frozenMs?: number | null } = {},
): number | null {
  const { paused = false, frozenMs = null } = options;
  const [value, setValue] = useState<number | null>(() => remainingMs(deadlineAt, offset));

  useEffect(() => {
    if (paused) {
      // While paused the server preserved the exact remainder; show that, frozen.
      setValue(frozenMs);
      return;
    }

    if (!deadlineAt) {
      setValue(null);
      return;
    }

    const tick = () => setValue(remainingMs(deadlineAt, offset));
    tick();

    // 250ms keeps the seconds digit honest without a per-frame redraw.
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [deadlineAt, offset, paused, frozenMs]);

  return value;
}

/** True once per second, for aria-live announcements that must not spam a screen reader. */
export function useUrgentAnnouncement(ms: number | null): string | null {
  const [announcement, setAnnouncement] = useState<string | null>(null);

  useEffect(() => {
    if (ms === null) {
      setAnnouncement(null);
      return;
    }
    const seconds = Math.ceil(ms / 1000);
    // Announce only the last few seconds, and only on whole-second boundaries.
    if (seconds <= 5 && seconds > 0) {
      setAnnouncement(String(seconds));
    } else {
      setAnnouncement(null);
    }
  }, [ms]);

  return announcement;
}
