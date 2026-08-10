import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlayerList } from '../../components/PlayerList';
import { CopyButton } from '../../components/CopyButton';
import { QrCode } from '../../components/QrCode';
import { TimeLimitPicker } from '../../components/TimeLimitPicker';
import { ErrorBanner } from '../../components/Feedback';
import { ConfirmDialog } from '../../components/Dialog';
import * as rpc from '../../lib/rpc';
import { GameError, toGameError } from '../../lib/errors';
import { formatLimit } from '../../lib/time';
import { formatRoomCode, joinUrl } from '../../lib/roomCode';
import {
  CYCLES_MAX,
  CYCLES_MIN,
  GUESSER_TIME_PRESETS,
  PLAYER_MAX,
  PLAYER_MIN,
  RANKER_TIME_PRESETS,
  type GameSettings,
} from '../../lib/types';
import { totalTurnsFor } from '../../lib/rotation';
import type { RoomViewProps } from './shared';

export function LobbyView({ state, roomCode, refresh }: RoomViewProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GameError | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [draft, setDraft] = useState<GameSettings>({
    totalCycles: state.game.totalCycles,
    rankerSeconds: state.game.rankerSeconds,
    guesserSeconds: state.game.guesserSeconds,
    allowManualCards: state.game.allowManualCards,
  });

  const isHost = state.me.isHost;
  const playerCount = state.players.length;
  const host = state.players.find((player) => player.isHost);

  const link = joinUrl(roomCode, window.location.origin, import.meta.env.BASE_URL);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(toGameError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl">{t('lobby.title')}</h1>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <section className="card p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink-faint">
          {t('lobby.roomCode')}
        </h2>
        <p className="mt-1 select-all text-4xl font-semibold tracking-[0.2em] tabular-nums text-teal-700">
          {formatRoomCode(roomCode)}
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <h3 className="text-sm font-medium">{t('lobby.shareTitle')}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <CopyButton value={roomCode} label={t('lobby.copyCode')} />
              <CopyButton value={link} label={t('lobby.copyLink')} />
            </div>
            <p className="help break-all">{link}</p>
          </div>

          <div className="justify-self-center text-center">
            <h3 className="mb-1 text-sm font-medium">{t('lobby.qrTitle')}</h3>
            <QrCode value={link} alt={t('lobby.qrAlt', { code: roomCode })} />
          </div>
        </div>
      </section>

      <section className="card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg">{t('lobby.playerList')}</h2>
          <p className="text-sm text-ink-soft">
            {t('lobby.playerCount', { current: playerCount, max: PLAYER_MAX })}
          </p>
        </div>

        <PlayerList players={state.players} mePlayerId={state.me.playerId} />

        {playerCount < PLAYER_MIN && (
          <p className="mt-2 rounded-xl bg-sunny-50 px-3 py-2 text-sm text-sunny-700">
            {t('lobby.needMorePlayers')}
          </p>
        )}
        <p className="help">{t('lobby.leaveHint')}</p>
      </section>

      <section className="card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg">{t('lobby.settingsSummary')}</h2>
          {isHost && !editing && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(true)}>
              {t('lobby.editSettings')}
            </button>
          )}
        </div>

        {!editing ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-ink-faint">{t('settings.cycles')}</dt>
              <dd className="font-medium">{state.game.totalCycles}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">{t('settings.rankerTime')}</dt>
              <dd className="font-medium">
                {formatLimit(state.game.rankerSeconds, t('common.unlimited'))}
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">{t('settings.guesserTime')}</dt>
              <dd className="font-medium">
                {formatLimit(state.game.guesserSeconds, t('common.unlimited'))}
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">{t('settings.manualCards')}</dt>
              <dd className="font-medium">
                {state.game.allowManualCards
                  ? t('settings.manualCardsOn')
                  : t('settings.manualCardsOff')}
              </dd>
            </div>
          </dl>
        ) : (
          <div className="mt-3 space-y-4">
            <div>
              <span className="label" id="lobby-cycles">
                {t('settings.cycles')}
              </span>
              <div
                className="mt-2 flex flex-wrap gap-2"
                role="group"
                aria-labelledby="lobby-cycles"
              >
                {Array.from({ length: CYCLES_MAX - CYCLES_MIN + 1 }, (_, i) => i + CYCLES_MIN).map(
                  (count) => (
                    <button
                      key={count}
                      type="button"
                      aria-pressed={draft.totalCycles === count}
                      onClick={() => setDraft((d) => ({ ...d, totalCycles: count }))}
                      className={`btn btn-sm min-w-[2.75rem] ${
                        draft.totalCycles === count
                          ? 'bg-teal-600 text-white'
                          : 'border border-line bg-surface text-ink hover:bg-teal-50'
                      }`}
                    >
                      {count}
                    </button>
                  ),
                )}
              </div>
              <p className="help">{t('create.cyclesHelp')}</p>
            </div>

            <TimeLimitPicker
              label={t('settings.rankerTime')}
              help={t('create.timeHelp')}
              value={draft.rankerSeconds}
              presets={RANKER_TIME_PRESETS}
              onChange={(seconds) => setDraft((d) => ({ ...d, rankerSeconds: seconds }))}
            />
            <TimeLimitPicker
              label={t('settings.guesserTime')}
              help={t('create.guesserTimeHelp')}
              value={draft.guesserSeconds}
              presets={GUESSER_TIME_PRESETS}
              onChange={(seconds) => setDraft((d) => ({ ...d, guesserSeconds: seconds }))}
            />

            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 rounded border-line text-teal-600"
                checked={draft.allowManualCards}
                onChange={(event) =>
                  setDraft((d) => ({ ...d, allowManualCards: event.target.checked }))
                }
              />
              <span className="font-medium">{t('create.allowManualCards')}</span>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await rpc.updateSettings(roomCode, draft);
                    setEditing(false);
                  })
                }
              >
                {t('common.save')}
              </button>
              <button
                type="button"
                className="btn-quiet btn-sm"
                onClick={() => {
                  setEditing(false);
                  setDraft({
                    totalCycles: state.game.totalCycles,
                    rankerSeconds: state.game.rankerSeconds,
                    guesserSeconds: state.game.guesserSeconds,
                    allowManualCards: state.game.allowManualCards,
                  });
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {!isHost && <p className="help">{t('lobby.hostOnly')}</p>}
        {playerCount >= PLAYER_MIN && (
          <p className="help">
            {t('lobby.turnsPlanned', {
              count: totalTurnsFor(playerCount, state.game.totalCycles),
            })}
          </p>
        )}
      </section>

      {isHost ? (
        <section className="space-y-2">
          <p className="text-sm text-ink-soft">{t('lobby.youAreHost')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || playerCount < PLAYER_MIN || editing}
              onClick={() => void run(() => rpc.startGame(roomCode))}
            >
              {busy ? t('lobby.starting') : t('lobby.start')}
            </button>
            <button type="button" className="btn-danger" onClick={() => setConfirmEnd(true)}>
              {t('settings.endGame')}
            </button>
          </div>
        </section>
      ) : (
        <p className="rounded-xl bg-bluish-50 px-3 py-2 text-sm text-bluish-700">
          {t('lobby.waitingForHost', { name: host?.displayName ?? t('common.host') })}
        </p>
      )}

      <p className="text-xs text-ink-faint">{t('settings.removePlayerFuture')}</p>

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
    </div>
  );
}
