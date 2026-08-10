import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/Dialog';
import * as rpc from '../../lib/rpc';
import { toGameError, type GameError } from '../../lib/errors';
import { canSkipRankerTurn } from '../../lib/stateMachine';
import type { GameStateView } from '../../lib/schemas';

/**
 * The Host's controls, and only the Host's.
 *
 * Every one of these is also enforced in the database, so a hidden button is a convenience
 * rather than a security measure. Note the asymmetry the rules require: the Host may skip a
 * Ranker only while that Ranker is disconnected, whereas the Ranker may always hand over
 * their own turn (that button lives on the Ranker's own screens).
 */
export function HostControls({
  state,
  roomCode,
  refresh,
  onError,
}: {
  state: GameStateView;
  roomCode: string;
  refresh: () => Promise<void>;
  onError?: (error: GameError) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);

  if (!state.me.isHost) return null;

  const paused = state.game.phase === 'paused';
  const effective = state.game.effectivePhase;
  const rankerName = state.turn?.rankerDisplayName ?? '';
  const rankerAway = state.turn?.rankerConnected === false;
  const skippable = canSkipRankerTurn(effective) && rankerAway;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (caught) {
      onError?.(toGameError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card border-dashed p-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        {t('common.host')}
      </h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {paused ? (
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={busy}
            onClick={() => void run(() => rpc.resumeGame(roomCode))}
          >
            {t('pause.resume')}
          </button>
        ) : (
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={() => void run(() => rpc.pauseGame(roomCode))}
          >
            {t('pause.pause')}
          </button>
        )}

        {skippable && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={() => setConfirmSkip(true)}
          >
            {t('pause.skipDisconnected', { name: rankerName })}
          </button>
        )}

        {effective === 'reveal' && !paused && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={() => void run(() => rpc.advanceRevealNow(roomCode))}
          >
            {t('reveal.advanceNow')}
          </button>
        )}

        <button
          type="button"
          className="btn-danger btn-sm"
          disabled={busy}
          onClick={() => setConfirmEnd(true)}
        >
          {t('settings.endGame')}
        </button>
      </div>

      <ConfirmDialog
        open={confirmSkip}
        title={t('pause.skipDisconnected', { name: rankerName })}
        body={t('pause.skipDisconnectedConfirm', { name: rankerName })}
        confirmLabel={t('pause.skipDisconnected', { name: rankerName })}
        onCancel={() => setConfirmSkip(false)}
        onConfirm={() => {
          setConfirmSkip(false);
          void run(() => rpc.skipRankerTurn(roomCode));
        }}
      />

      <ConfirmDialog
        open={confirmEnd}
        title={t('settings.endGameConfirmTitle')}
        body={t('settings.endGameConfirmBody')}
        confirmLabel={t('settings.endGameConfirm')}
        danger
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          void run(() => rpc.endGame(roomCode));
        }}
      />
    </section>
  );
}
