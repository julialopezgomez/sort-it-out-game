import { useTranslation } from 'react-i18next';
import { Timer } from '../../components/Timer';
import { useCountdown } from '../../hooks/useCountdown';
import type { ClockOffset } from '../../lib/time';
import type { GameStateView } from '../../lib/schemas';

/** Turn number, round number, who the Ranker is, and the clock. */
export function TurnHeader({
  state,
  offset,
  showTimer = true,
}: {
  state: GameStateView;
  offset?: ClockOffset | null;
  showTimer?: boolean;
}) {
  const { t } = useTranslation();
  const paused = state.game.phase === 'paused';
  const ms = useCountdown(state.game.deadlineAt, offset ?? null, {
    paused,
    frozenMs: state.game.remainingMs,
  });

  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-ink-faint">
          {t('game.turnHeading', { turn: state.game.currentTurnNumber })} ·{' '}
          {t('game.roundHeading', {
            cycle: state.game.currentCycle,
            total: state.game.totalCycles,
          })}
        </p>
        <p className="break-words font-medium">
          {state.turn?.iAmRanker
            ? t('game.youAreRanker')
            : t('game.rankerIs', { name: state.turn?.rankerDisplayName ?? '' })}
        </p>
      </div>

      {showTimer && <Timer ms={ms} paused={paused} />}
    </header>
  );
}
