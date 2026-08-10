import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shell } from '../components/Shell';
import { ErrorBanner, ServiceUnavailable } from '../components/Feedback';
import * as rpc from '../lib/rpc';
import { GameError, toGameError } from '../lib/errors';
import { isSupabaseConfigured } from '../lib/supabase';
import { rememberMembership, readMembership } from '../lib/session';
import { currentLanguage } from '../i18n';
import {
  canonicalRoomCode,
  hasAmbiguousCharacters,
  isValidRoomCode,
  ROOM_CODE_LENGTH,
} from '../lib/roomCode';
import { NAME_MAX_LENGTH } from '../lib/types';

/**
 * Joining, reconnecting and reclaiming are all this one form.
 *
 * A player who was disconnected types the same room code and the same name and gets their
 * score back. Nobody is ever asked for a recovery code, a password or an email address.
 */
export function JoinScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ code?: string }>();
  const remembered = readMembership();

  const [roomCode, setRoomCode] = useState(() => canonicalRoomCode(params.code ?? ''));
  const [displayName, setDisplayName] = useState(remembered?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GameError | null>(null);

  if (!isSupabaseConfigured) {
    return (
      <Shell>
        <ServiceUnavailable error={new GameError('NOT_CONFIGURED')} />
      </Shell>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.joinRoom({
        roomCode,
        displayName,
        language: currentLanguage(),
      });
      rememberMembership({
        roomCode: result.roomCode,
        displayName: displayName.trim(),
        isHost: false,
      });
      navigate(`/room/${result.roomCode}`, { replace: true });
    } catch (caught) {
      setError(toGameError(caught));
      setBusy(false);
    }
  };

  const codeValid = isValidRoomCode(roomCode);
  const nameLength = displayName.trim().length;
  const canSubmit = codeValid && nameLength >= 1 && nameLength <= NAME_MAX_LENGTH && !busy;

  return (
    <Shell>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        <h1 className="text-2xl">{t('join.title')}</h1>

        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

        <section className="card p-4">
          <label className="label" htmlFor="room-code">
            {t('join.roomCode')}
          </label>
          <input
            id="room-code"
            className="field mt-1 text-center text-2xl uppercase tracking-[0.35em] tabular-nums"
            value={roomCode}
            onChange={(event) =>
              setRoomCode(canonicalRoomCode(event.target.value).slice(0, ROOM_CODE_LENGTH))
            }
            placeholder={t('join.roomCodePlaceholder')}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={ROOM_CODE_LENGTH}
            required
            aria-describedby="room-code-help"
          />
          <p className="help" id="room-code-help">
            {t('join.roomCodeHelp')}
          </p>
          {hasAmbiguousCharacters(roomCode) && (
            <p className="mt-1 rounded-lg bg-sunny-50 px-2 py-1 text-sm text-sunny-700">
              {t('join.ambiguousCode')}
            </p>
          )}
        </section>

        <section className="card p-4">
          <label className="label" htmlFor="join-name">
            {t('join.yourName')}
          </label>
          <input
            id="join-name"
            className="field mt-1"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="off"
            autoCapitalize="words"
            required
            aria-describedby="join-name-help"
          />
          <p className="help" id="join-name-help">
            {t('join.nameHelp')}
          </p>
        </section>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={!canSubmit}>
            {busy ? t('join.joining') : t('join.submit')}
          </button>
          <button type="button" className="btn-quiet" onClick={() => navigate('/')}>
            {t('common.back')}
          </button>
        </div>
      </form>
    </Shell>
  );
}
