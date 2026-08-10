import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlayerList } from '../../components/PlayerList';
import { ErrorBanner } from '../../components/Feedback';
import { formatDuration } from '../../lib/time';
import { HostControls } from './HostControls';
import * as rpc from '../../lib/rpc';
import { toGameError, type GameError } from '../../lib/errors';
import type { RoomViewProps } from './shared';

/**
 * The pause screen.
 *
 * Two very different situations look almost identical to a player, and the copy says
 * which one is happening: the Host paused on purpose (nothing resumes until they say so),
 * or the Ranker vanished (the game already knows, and will resume itself the moment they
 * are back — the Host can also choose to skip that turn instead of waiting).
 */
export function PauseView({ state, roomCode, refresh }: RoomViewProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<GameError | null>(null);
  const [busy, setBusy] = useState(false);

  const reason = state.game.pauseReason;
  const rankerName = state.turn?.rankerDisplayName ?? '';
  const isManual = reason === 'manual';
  const host = state.players.find((player) => player.isHost);

  const resume = async () => {
    setBusy(true);
    setError(null);
    try {
      await rpc.resumeGame(roomCode);
      await refresh();
    } catch (caught) {
      setError(toGameError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <section className="card p-5 text-center">
        <h1 className="text-xl">
          {isManual ? t('pause.manualTitle') : t('pause.rankerTitle', { name: rankerName })}
        </h1>
        <p className="mt-2 text-ink-soft">
          {isManual
            ? t('pause.manualBody', { name: host?.displayName ?? t('common.host') })
            : state.me.isHost
              ? t('pause.rankerBodyHost')
              : t('pause.rankerBody', { name: rankerName })}
        </p>

        {state.game.remainingMs !== null && (
          <p className="mt-3 text-sm text-ink-faint">
            {t('pause.frozenAt', { time: formatDuration(state.game.remainingMs) })}
          </p>
        )}

        {isManual && state.me.isHost && (
          <button
            type="button"
            className="btn-primary mt-4"
            disabled={busy}
            onClick={() => void resume()}
          >
            {t('pause.resume')}
          </button>
        )}
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink-faint">
          {t('lobby.playerList')}
        </h2>
        <PlayerList players={state.players} mePlayerId={state.me.playerId} />
      </section>

      <HostControls state={state} roomCode={roomCode} refresh={refresh} onError={setError} />
    </div>
  );
}
