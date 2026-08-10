import { useTranslation } from 'react-i18next';
import { competitionRanking } from '../lib/ranking';
import { formatAverage } from '../lib/scoring';

/**
 * The two live leaderboards, always side by side: total points and average points.
 *
 * Places use standard competition ranking, so ties share a place and the next one is
 * skipped (1st, 2nd, 2nd, 4th). A player who has not yet played a guessing turn shows an
 * em dash for their average rather than a misleading 0.00.
 */

export type LeaderboardRow = {
  playerId: string;
  displayName: string;
  totalScore: number;
  scoredGuesserTurns: number;
  average: number | null;
  rankerTurnsCompleted?: number;
  rankerTurnsSkipped?: number;
  consumedPenalties?: number;
  pendingPenalties?: number;
};

export function Leaderboards({
  rows,
  mePlayerId,
  detailed = false,
}: {
  rows: LeaderboardRow[];
  mePlayerId: string | null;
  detailed?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <LeaderboardTable
        caption={t('leaderboard.byTotal')}
        rows={rows}
        mePlayerId={mePlayerId}
        scoreOf={(row) => row.totalScore}
        valueOf={(row) => String(row.totalScore)}
        valueHeader={t('leaderboard.total')}
        detailed={detailed}
      />
      <LeaderboardTable
        caption={t('leaderboard.byAverage')}
        rows={rows}
        mePlayerId={mePlayerId}
        scoreOf={(row) => row.average}
        valueOf={(row) => formatAverage(row.average, t('common.notAvailable'))}
        valueHeader={t('leaderboard.average')}
        detailed={detailed}
        note={t('leaderboard.explainAverage')}
      />
    </div>
  );
}

function LeaderboardTable({
  caption,
  rows,
  mePlayerId,
  scoreOf,
  valueOf,
  valueHeader,
  detailed,
  note,
}: {
  caption: string;
  rows: LeaderboardRow[];
  mePlayerId: string | null;
  scoreOf: (row: LeaderboardRow) => number | null;
  valueOf: (row: LeaderboardRow) => string;
  valueHeader: string;
  detailed: boolean;
  note?: string;
}) {
  const { t } = useTranslation();
  const placed = competitionRanking(rows, scoreOf, (row) => row.displayName);

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="px-4 pt-3 text-left text-sm font-semibold text-ink">
            {caption}
          </caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
              <th scope="col" className="px-4 py-2 font-medium">
                {t('leaderboard.place')}
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                {t('leaderboard.name')}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                {valueHeader}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                {t('leaderboard.turns')}
              </th>
              {detailed && (
                <>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    {t('leaderboard.rankerTurns')}
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    {t('leaderboard.rankerSkipped')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    {t('leaderboard.penalties')}
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {placed.map(({ item, place }) => {
              const isMe = item.playerId === mePlayerId;
              return (
                <tr key={item.playerId} className={isMe ? 'bg-teal-50/60' : undefined}>
                  <td className="px-4 py-2 tabular-nums font-semibold text-ink-soft">{place}</td>
                  <td className="px-2 py-2">
                    <span className="break-words font-medium">{item.displayName}</span>
                    {isMe && <span className="sr-only"> ({t('common.you')})</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold">
                    {valueOf(item)}
                    {item.average === null && valueHeader === t('leaderboard.average') && (
                      <span className="sr-only"> {t('leaderboard.averageUnknown')}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-soft">
                    {item.scoredGuesserTurns}
                  </td>
                  {detailed && (
                    <>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-soft">
                        {item.rankerTurnsCompleted ?? 0}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-soft">
                        {item.rankerTurnsSkipped ?? 0}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-soft">
                        {(item.consumedPenalties ?? 0) + (item.pendingPenalties ?? 0) === 0
                          ? '—'
                          : `${item.consumedPenalties ?? 0}${
                              (item.pendingPenalties ?? 0) > 0
                                ? ` (+${item.pendingPenalties ?? 0})`
                                : ''
                            }`}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {note && <p className="border-t border-line px-4 py-2 text-xs text-ink-faint">{note}</p>}
    </div>
  );
}
