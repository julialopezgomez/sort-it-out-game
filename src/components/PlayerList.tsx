import { useTranslation } from 'react-i18next';
import type { PlayerView } from '../lib/schemas';
import { formatAverage } from '../lib/scoring';

/**
 * Who is in the room, and what state they are in.
 *
 * Status is never conveyed by colour alone: every dot has a text label beside it.
 */
export function PlayerList({
  players,
  mePlayerId,
  showScores = false,
  showSubmission = false,
}: {
  players: PlayerView[];
  mePlayerId: string | null;
  showScores?: boolean;
  showSubmission?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <ul className="divide-y divide-line" aria-label={t('a11y.playerListLandmark')}>
      {players.map((player) => {
        const isMe = player.playerId === mePlayerId;
        return (
          <li key={player.playerId} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5">
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                player.connected ? 'bg-teal-400' : 'bg-line ring-1 ring-inset ring-ink-faint'
              }`}
            />
            <span className="min-w-0 break-words font-medium text-ink">{player.displayName}</span>

            {isMe && <span className="chip bg-teal-50 text-teal-700">{t('a11y.youBadge')}</span>}
            {player.isHost && (
              <span className="chip bg-bluish-50 text-bluish-700">{t('common.host')}</span>
            )}
            {player.isRanker && (
              <span className="chip bg-sunny-50 text-sunny-700">{t('player.isRanker')}</span>
            )}
            {player.joinsNextTurn && (
              <span className="chip bg-line text-ink-soft">{t('player.joinsNextTurn')}</span>
            )}

            <span className="text-xs text-ink-faint">
              {player.connected ? t('player.connected') : t('player.disconnected')}
            </span>

            {showSubmission && !player.isRanker && !player.joinsNextTurn && (
              <span
                className={`chip ${
                  player.submitted ? 'bg-teal-50 text-teal-700' : 'bg-line text-ink-soft'
                }`}
              >
                {player.submitted ? `✓ ${t('player.submitted')}` : t('player.notSubmitted')}
              </span>
            )}

            {player.pendingPenalties > 0 && (
              <span className="chip bg-coral-50 text-coral-700">
                {t('player.penaltyPending', { count: player.pendingPenalties })}
              </span>
            )}

            {showScores && (
              <span className="ml-auto shrink-0 tabular-nums text-sm text-ink-soft">
                {player.totalScore}
                <span className="text-ink-faint"> · </span>
                {formatAverage(player.average === null ? null : Number(player.average))}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
