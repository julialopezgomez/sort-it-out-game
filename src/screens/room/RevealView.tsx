import { useTranslation } from 'react-i18next';
import { Leaderboards } from '../../components/Leaderboards';
import { CooperativeScoreboard } from '../../components/CooperativeScoreboard';
import { Timer } from '../../components/Timer';
import { HostControls } from './HostControls';
import { useCountdown } from '../../hooks/useCountdown';
import { formatAverage } from '../../lib/scoring';
import { leaderboardRows } from './shared';
import type { RoomViewProps } from './shared';
import { useState } from 'react';
import type { GameError } from '../../lib/errors';
import { ErrorBanner } from '../../components/Feedback';

/**
 * The reveal.
 *
 * Everyone sees their own comparison table, the Ranker's true order, both live
 * leaderboards, and the cooperative scoreboard. Correctness is never colour-only: every row
 * also carries a text label ("Right" / "Wrong").
 */
export function RevealView({ state, roomCode, refresh, offset }: RoomViewProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<GameError | null>(null);
  const reveal = state.reveal;
  const ms = useCountdown(state.game.deadlineAt, offset ?? null);

  if (!reveal) {
    return (
      <section className="card p-5 text-center">
        <p className="text-ink-soft">{t('common.loading')}</p>
      </section>
    );
  }

  const skipped = state.turn?.skipped ?? false;

  return (
    <div className="space-y-5">
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl">{t('reveal.title')}</h1>
        <Timer ms={ms} label={t('reveal.advanceIn', { seconds: Math.ceil((ms ?? 0) / 1000) })} />
      </header>

      {skipped ? (
        <section className="card p-4">
          <h2 className="text-lg">{t('reveal.skippedTitle')}</h2>
          <p className="help">{t('reveal.skippedBody', { name: reveal.rankerDisplayName })}</p>
        </section>
      ) : (
        <>
          <section className="card p-4">
            <h2 className="text-lg">
              {t('reveal.rankerOrderTitle', { name: reveal.rankerDisplayName })}
            </h2>
            <ol className="mt-2 space-y-1.5">
              {reveal.rankerOrder.map((card) => (
                <li
                  key={card.canonicalId}
                  className="flex items-center gap-2 text-sm"
                  data-card-id={card.canonicalId}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-teal-50 text-xs font-semibold text-teal-700"
                  >
                    {card.position}
                  </span>
                  <span className="break-words">{card.text}</span>
                </li>
              ))}
            </ol>
          </section>

          {!state.turn?.iAmRanker && reveal.myComparison && (
            <ComparisonTable
              rows={reveal.myComparison}
              rawScore={reveal.myRawScore}
              awardedScore={reveal.myAwardedScore}
              penaltyApplied={reveal.myPenaltyApplied}
              submitted={reveal.mySubmitted}
            />
          )}

          {state.turn?.iAmRanker && (
            <section className="card p-4">
              <h2 className="text-lg">{t('reveal.rankerViewTitle')}</h2>
              <p className="help">{t('reveal.rankerViewBody')}</p>
              <PerPlayerTable perPlayer={reveal.perPlayer} />
            </section>
          )}
        </>
      )}

      <section className="card p-4">
        <h2 className="text-lg">{t('reveal.yourTotals')}</h2>
        <dl className="mt-2 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-teal-50 px-3 py-2">
            <dt className="text-xs font-medium text-teal-700">{t('reveal.totalScore')}</dt>
            <dd className="tabular-nums text-2xl font-semibold">{state.me.totalScore}</dd>
          </div>
          <div className="rounded-xl bg-bluish-50 px-3 py-2">
            <dt className="text-xs font-medium text-bluish-700">{t('reveal.averageScore')}</dt>
            <dd className="tabular-nums text-2xl font-semibold">
              {formatAverage(
                state.me.average === null ? null : Number(state.me.average),
                t('common.notAvailable'),
              )}
            </dd>
          </div>
        </dl>
      </section>

      <CooperativeScoreboard
        groupPoints={state.game.groupPoints}
        gamePoints={state.game.gamePoints}
        possiblePoints={state.game.possiblePoints}
        turnGroupPoints={reveal.turnGroupPoints}
        turnGamePoints={reveal.turnGamePoints}
      />

      <Leaderboards rows={leaderboardRows(state)} mePlayerId={state.me.playerId} />

      <HostControls state={state} roomCode={roomCode} refresh={refresh} onError={setError} />
    </div>
  );
}

function ComparisonTable({
  rows,
  rawScore,
  awardedScore,
  penaltyApplied,
  submitted,
}: {
  rows: {
    canonicalId: string;
    text: string | null;
    myPosition: number;
    rankerPosition: number | null;
    correct: boolean;
  }[];
  rawScore: number | null;
  awardedScore: number | null;
  penaltyApplied: boolean;
  submitted: boolean;
}) {
  const { t } = useTranslation();
  const sorted = [...rows].sort((a, b) => a.myPosition - b.myPosition);
  const correctCount = rows.filter((row) => row.correct).length;

  return (
    <section className="card overflow-hidden p-4">
      <h2 className="text-lg">{t('reveal.yourComparison')}</h2>

      {!submitted && (
        <p className="mt-2 rounded-xl bg-coral-50 px-3 py-2 text-sm text-coral-700">
          {t('reveal.notSubmittedTitle')}: {t('reveal.notSubmittedBody')}
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
              <th scope="col" className="py-1.5 pr-2 font-medium">
                {t('reveal.concept')}
              </th>
              <th scope="col" className="px-2 py-1.5 text-center font-medium">
                {t('reveal.yourRank')}
              </th>
              <th scope="col" className="px-2 py-1.5 text-center font-medium">
                {t('reveal.rankerRank')}
              </th>
              <th scope="col" className="py-1.5 pl-2 text-right font-medium">
                {t('reveal.result')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.canonicalId}>
                <td className="py-2 pr-2 break-words">{row.text}</td>
                <td className="px-2 py-2 text-center tabular-nums">{row.myPosition}</td>
                <td className="px-2 py-2 text-center tabular-nums">{row.rankerPosition ?? '—'}</td>
                <td className="py-2 pl-2 text-right">
                  <span
                    className={`chip ${
                      row.correct ? 'bg-teal-50 text-teal-700' : 'bg-coral-50 text-coral-700'
                    }`}
                  >
                    <span aria-hidden="true">{row.correct ? '✓' : '✕'}</span>
                    {row.correct ? t('reveal.correct') : t('reveal.incorrect')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-sm text-ink-soft">
        {t('reveal.correctCount', { count: correctCount })}
      </p>

      <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-ink-faint">{t('reveal.rawScore')}</dt>
          <dd className="tabular-nums font-medium">{rawScore ?? 0}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">{t('reveal.awardedScore')}</dt>
          <dd className="tabular-nums font-medium">{awardedScore ?? 0}</dd>
        </div>
      </dl>

      {penaltyApplied && (
        <div className="mt-3 rounded-xl bg-coral-50 px-3 py-2 text-sm text-coral-700">
          <p className="font-medium">{t('reveal.penaltyTitle')}</p>
          <p>{t('reveal.penaltyBody', { raw: rawScore ?? 0 })}</p>
        </div>
      )}
    </section>
  );
}

function PerPlayerTable({
  perPlayer,
}: {
  perPlayer: {
    playerId: string;
    displayName: string;
    awardedScore: number | null;
    penaltyApplied: boolean;
    submitted: boolean;
  }[];
}) {
  const { t } = useTranslation();
  return (
    <ul className="mt-3 divide-y divide-line">
      {perPlayer.map((player) => (
        <li key={player.playerId} className="flex items-center justify-between gap-2 py-2 text-sm">
          <span className="break-words font-medium">{player.displayName}</span>
          <span className="flex items-center gap-2">
            {!player.submitted && (
              <span className="chip bg-coral-50 text-coral-700">{t('player.notSubmitted')}</span>
            )}
            {player.penaltyApplied && <span className="chip bg-coral-50 text-coral-700">0</span>}
            <span className="tabular-nums font-semibold">{player.awardedScore ?? 0}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
