import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shell } from '../components/Shell';
import { EmptyState, ErrorBanner } from '../components/Feedback';
import { ConfirmDialog } from '../components/Dialog';
import {
  deleteHistoryEntry,
  historyAsCsv,
  historyAsJson,
  loadHistory,
  type HistoryEntry,
} from '../lib/localHistory';
import { downloadTextFile, timestampedFilename } from '../lib/download';
import { formatAverage } from '../lib/scoring';
import { formatRoomCode } from '../lib/roomCode';
import { formatLimit } from '../lib/time';
import * as rpc from '../lib/rpc';
import { toGameError, type GameError } from '../lib/errors';

/**
 * The Host's history, in the Host's own browser.
 *
 * There are no accounts, so there is no server-side "my games" list — only this local
 * index. It is stated plainly that clearing site data loses this list, and Export exists
 * precisely so that loss is avoidable.
 */
export function HistoryScreen() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<HistoryEntry[]>(() => loadHistory());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HistoryEntry | null>(null);
  const [error, setError] = useState<GameError | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async (entry: HistoryEntry) => {
    setBusy(true);
    setError(null);
    try {
      // Best effort: the database record may already be gone (retention, or another
      // browser deleted it), which is fine — the local entry still needs to disappear.
      await rpc.deleteGameRecord(entry.roomCode).catch(() => undefined);
    } catch (caught) {
      setError(toGameError(caught));
    } finally {
      deleteHistoryEntry(entry.gameId);
      setEntries(loadHistory());
      setBusy(false);
      setPendingDelete(null);
    }
  };

  return (
    <Shell>
      <div className="space-y-4">
        <h1 className="text-2xl">{t('history.title')}</h1>
        <p className="help">{t('history.intro')}</p>
        <p className="rounded-xl bg-sunny-50 px-3 py-2 text-sm text-sunny-700">
          {t('history.warning')}
        </p>

        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

        {entries.length === 0 ? (
          <EmptyState title={t('history.empty')}>
            <Link to="/" className="btn-secondary btn-sm">
              {t('common.back')}
            </Link>
          </EmptyState>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() =>
                  downloadTextFile(
                    timestampedFilename('sort-it-out-history', 'json'),
                    historyAsJson(),
                    'application/json',
                  )
                }
              >
                {t('history.exportJson')}
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() =>
                  downloadTextFile(
                    timestampedFilename('sort-it-out-history', 'csv'),
                    historyAsCsv(entries),
                  )
                }
              >
                {t('history.exportCsv')}
              </button>
            </div>

            <ul className="space-y-3">
              {entries.map((entry) => {
                const isOpen = expanded === entry.gameId;
                return (
                  <li key={entry.gameId} className="card p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="font-semibold tabular-nums">
                          {formatRoomCode(entry.roomCode)}
                        </p>
                        <p className="text-sm text-ink-faint">
                          {entry.finishedAt ? new Date(entry.finishedAt).toLocaleString() : '—'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-quiet btn-sm"
                        onClick={() => setExpanded(isOpen ? null : entry.gameId)}
                      >
                        {isOpen ? t('history.hideDetail') : t('history.viewDetail')}
                      </button>
                    </div>

                    <p className="mt-1 break-words text-sm text-ink-soft">
                      {t('history.playerNames')}: {entry.playerNames.join(', ')}
                    </p>

                    {isOpen && (
                      <div className="mt-3 space-y-3 border-t border-line pt-3">
                        <div>
                          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                            {t('history.settings')}
                          </h3>
                          <p className="text-sm">
                            {t('settings.cycles')}: {entry.summary.settings.totalCycles} ·{' '}
                            {t('settings.rankerTime')}:{' '}
                            {formatLimit(
                              entry.summary.settings.rankerSeconds,
                              t('common.unlimited'),
                            )}{' '}
                            · {t('settings.guesserTime')}:{' '}
                            {formatLimit(
                              entry.summary.settings.guesserSeconds,
                              t('common.unlimited'),
                            )}
                          </p>
                        </div>

                        <div>
                          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                            {t('history.results')}
                          </h3>
                          <div className="mt-1 overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-xs text-ink-faint">
                                  <th scope="col" className="py-1 pr-2">
                                    {t('leaderboard.place')}
                                  </th>
                                  <th scope="col" className="px-2 py-1">
                                    {t('leaderboard.name')}
                                  </th>
                                  <th scope="col" className="px-2 py-1 text-right">
                                    {t('leaderboard.total')}
                                  </th>
                                  <th scope="col" className="py-1 pl-2 text-right">
                                    {t('leaderboard.average')}
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-line">
                                {entry.summary.players.map((player) => (
                                  <tr key={player.playerId}>
                                    <td className="py-1 pr-2 tabular-nums">{player.totalPlace}</td>
                                    <td className="px-2 py-1 break-words">{player.displayName}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">
                                      {player.totalScore}
                                    </td>
                                    <td className="py-1 pl-2 text-right tabular-nums">
                                      {formatAverage(
                                        player.average === null ? null : Number(player.average),
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <p className="mt-1 text-sm text-ink-soft">
                            {t('coop.groupPoints')} {entry.summary.cooperative.groupPoints} ·{' '}
                            {t('coop.gamePoints')} {entry.summary.cooperative.gamePoints}
                          </p>
                        </div>

                        <button
                          type="button"
                          className="btn-danger btn-sm"
                          disabled={busy}
                          onClick={() => setPendingDelete(entry)}
                        >
                          {t('history.delete')}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <Link to="/" className="btn-quiet btn-sm">
          {t('common.back')}
        </Link>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('history.delete')}
        body={t('history.deleteConfirm', {
          code: pendingDelete ? formatRoomCode(pendingDelete.roomCode) : '',
        })}
        confirmLabel={t('history.delete')}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete);
        }}
      />
    </Shell>
  );
}
