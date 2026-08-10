import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Leaderboards } from '../../components/Leaderboards';
import { CooperativeScoreboard } from '../../components/CooperativeScoreboard';
import { ErrorBanner } from '../../components/Feedback';
import * as rpc from '../../lib/rpc';
import { toGameError, type GameError } from '../../lib/errors';
import { downloadTextFile, timestampedFilename } from '../../lib/download';
import { serializeDictionaryCsv } from '../../lib/csv';
import { formatRoomCode } from '../../lib/roomCode';
import { competitionRanking } from '../../lib/ranking';
import type { RoomViewProps } from './shared';

/**
 * Final results: two individual leaderboards, the cooperative verdict, and the actions the
 * Host can take with them — export the dictionary, play again, or just move on. The
 * summary was already written into Supabase and, for the Host, into this browser's history
 * the moment the game finished (see RoomScreen).
 */
export function FinalView({ state, roomCode }: RoomViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GameError | null>(null);

  const result = state.result;
  if (!result) {
    return (
      <section className="card p-5 text-center">
        <p className="text-ink-soft">{t('common.loading')}</p>
      </section>
    );
  }

  const rows = result.players.map((player) => ({
    playerId: player.playerId,
    displayName: player.displayName,
    totalScore: player.totalScore,
    scoredGuesserTurns: player.scoredGuesserTurns,
    average: player.average === null ? null : Number(player.average),
    rankerTurnsCompleted: player.rankerTurnsCompleted,
    rankerTurnsSkipped: player.rankerTurnsSkipped,
    consumedPenalties: player.consumedPenalties,
    pendingPenalties: player.pendingPenalties,
  }));

  const playAgain = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await rpc.playAgain(roomCode);
      navigate(`/room/${outcome.roomCode}`, { replace: true });
    } catch (caught) {
      setError(toGameError(caught));
    } finally {
      setBusy(false);
    }
  };

  const exportDictionary = async () => {
    setBusy(true);
    setError(null);
    try {
      const dictionary = await rpc.exportCustomDictionary(roomCode);
      downloadTextFile(
        timestampedFilename(`sort-it-out-${roomCode}`, 'csv'),
        serializeDictionaryCsv(dictionary.cards),
      );
    } catch (caught) {
      setError(toGameError(caught));
    } finally {
      setBusy(false);
    }
  };

  const wasCancelled = state.game.phase === 'cancelled';
  const host = state.players.find((player) => player.isHost);
  const rankedByTotal = competitionRanking(rows, (r) => r.totalScore);
  const winner = rankedByTotal.find((row) => row.place === 1)?.item;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl">{t('final.title')}</h1>
        <p className="help">
          {t('final.subtitle', { code: formatRoomCode(roomCode), turns: result.scoredTurns })}
        </p>
        {wasCancelled && host && (
          <p className="mt-2 rounded-xl bg-sunny-50 px-3 py-2 text-sm text-sunny-700">
            {t('final.hostEnded', { name: host.displayName })}
          </p>
        )}
      </header>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {winner && (
        <p className="text-center text-lg">
          🏅 <span className="font-semibold">{winner.displayName}</span>
        </p>
      )}

      <Leaderboards rows={rows} mePlayerId={state.me.playerId} detailed />

      <CooperativeScoreboard
        groupPoints={result.cooperative.groupPoints}
        gamePoints={result.cooperative.gamePoints}
        possiblePoints={result.cooperative.possiblePoints}
        final
      />

      <section className="flex flex-wrap gap-2">
        {state.me.isHost && (
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void playAgain()}
          >
            {busy ? t('final.playAgainWorking') : t('final.playAgain')}
          </button>
        )}
        {state.me.isHost && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void exportDictionary()}
          >
            {t('final.exportDictionary')}
          </button>
        )}
        {state.me.isHost && (
          <Link to="/history" className="btn-quiet">
            {t('final.viewHistory')}
          </Link>
        )}
        <Link to="/" className="btn-quiet">
          {t('final.newGame')}
        </Link>
      </section>

      {state.me.isHost && <p className="text-xs text-ink-faint">{t('final.saveSummary')}</p>}
      <p className="text-center text-ink-soft">{t('final.thanks')}</p>
    </div>
  );
}
