import { useTranslation } from 'react-i18next';
import { formatDuration, isUrgent, remainingSeconds } from '../lib/time';

/**
 * A countdown display.
 *
 * The number comes from the server deadline plus a measured clock offset. An unlimited
 * phase says so in words instead of showing an invented figure. The last five seconds are
 * announced politely for screen-reader users.
 */
export function Timer({
  ms,
  paused = false,
  label,
}: {
  ms: number | null;
  paused?: boolean;
  label?: string;
}) {
  const { t } = useTranslation();

  if (ms === null) {
    return (
      <div className="chip bg-bluish-50 text-bluish-700">
        <span aria-hidden="true">∞</span>
        <span>{t('game.noTimeLimit')}</span>
      </div>
    );
  }

  const urgent = !paused && isUrgent(ms);
  const seconds = remainingSeconds(ms) ?? 0;

  return (
    <div className="flex items-center gap-2">
      <div
        className={`chip tabular-nums ${
          paused
            ? 'bg-line text-ink-soft'
            : urgent
              ? 'bg-coral-50 font-semibold text-coral-700'
              : 'bg-teal-50 text-teal-700'
        }`}
      >
        <span className="sr-only">{label ?? t('game.timeLeft')}: </span>
        <span aria-hidden="true">⏱</span>
        <span>{formatDuration(ms)}</span>
      </div>

      {/* Polite, and only in the final seconds, so it never talks over the game. */}
      <span role="status" aria-live="polite" className="sr-only">
        {urgent && seconds > 0 ? t('a11y.timerUrgent', { seconds }) : ''}
      </span>
      {ms === 0 && !paused && (
        <span role="status" aria-live="polite" className="sr-only">
          {t('game.timeUp')}
        </span>
      )}
    </div>
  );
}
