import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shell } from '../components/Shell';
import {
  EmptyState,
  ErrorBanner,
  ServiceUnavailable,
  Spinner,
  StatusAnnouncer,
} from '../components/Feedback';
import { useGameRoom } from '../hooks/useGameRoom';
import { isServiceProblem } from '../lib/errors';
import * as rpc from '../lib/rpc';
import { canonicalRoomCode } from '../lib/roomCode';
import { rememberMembership } from '../lib/session';
import { saveHistoryEntry } from '../lib/localHistory';
import { mergeIntoLocalDictionary } from '../lib/localDictionary';
import type { Language } from '../lib/types';
import { LobbyView } from './room/LobbyView';
import { PrepareView } from './room/PrepareView';
import { OrderingView } from './room/OrderingView';
import { WaitingView } from './room/WaitingView';
import { PauseView } from './room/PauseView';
import { RevealView } from './room/RevealView';
import { FinalView } from './room/FinalView';

/**
 * The room. One component decides which screen the phase calls for; everything else is a
 * presentational view fed from the single authoritative state read.
 */
export function RoomScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ code: string }>();
  const roomCode = canonicalRoomCode(params.code ?? '');

  const { state, offset, error, loading, refresh, clearError, realtimeConnected } = useGameRoom(
    roomCode || null,
  );

  const savedHistoryFor = useRef<string | null>(null);
  const syncedDictionaryCount = useRef(0);
  const [announcement, setAnnouncement] = useState('');

  // Keep the "rejoin this room" shortcut on the landing page accurate.
  useEffect(() => {
    if (!state) return;
    rememberMembership({
      roomCode: state.game.roomCode,
      displayName: state.me.displayName,
      isHost: state.me.isHost,
    });
  }, [state]);

  // The Host keeps a copy of every custom term this game produced, so terms invented at
  // the table are still there next time they create a room.
  useEffect(() => {
    if (!state?.me.isHost || !state.customCards) return;
    if (state.customCards.length === syncedDictionaryCount.current) return;
    syncedDictionaryCount.current = state.customCards.length;
    mergeIntoLocalDictionary(
      state.customCards.map((card) => ({ en: card.textEn, es: card.textEs })),
    );
  }, [state?.me.isHost, state?.customCards]);

  // A finished game is written into this browser's history, once.
  useEffect(() => {
    if (!state?.result || !state.me.isHost) return;
    if (savedHistoryFor.current === state.result.gameId) return;
    savedHistoryFor.current = state.result.gameId;
    saveHistoryEntry(state.result);
  }, [state?.result, state?.me.isHost]);

  // Announce phase changes for screen readers.
  const lastPhase = useRef<string | null>(null);
  useEffect(() => {
    if (!state) return;
    const phase = `${state.game.effectivePhase}:${state.game.currentTurnNumber}`;
    if (lastPhase.current === phase) return;
    lastPhase.current = phase;
    setAnnouncement(phaseAnnouncement(state.game.effectivePhase, t));
  }, [state, t]);

  const onLanguageChange = (language: Language) => {
    if (!state) return;
    // Persisted on the player row so a reconnect from another device remembers it. It
    // changes nobody else's screen.
    void rpc
      .setLanguage(roomCode, language)
      .then(refresh)
      .catch(() => undefined);
  };

  if (!roomCode)
    return (
      <Shell>
        <EmptyState title={t('errors.INVALID_ROOM_CODE')} />
      </Shell>
    );

  if (error && isServiceProblem(error.code)) {
    return (
      <Shell>
        <ServiceUnavailable error={error} />
      </Shell>
    );
  }

  if (error && !state) {
    return (
      <Shell>
        <RoomProblem code={error.code} roomCode={roomCode} />
      </Shell>
    );
  }

  if (loading && !state) {
    return (
      <Shell>
        <Spinner label={t('status.connecting')} />
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell>
        <EmptyState title={t('errors.ROOM_NOT_FOUND')} body={t('status.roomNotFoundBody')}>
          <Link to="/join" className="btn-primary btn-sm">
            {t('landing.joinGame')}
          </Link>
        </EmptyState>
      </Shell>
    );
  }

  // "Play again" points every member at the new room.
  const nextRoom = state.game.nextRoomCode;

  const shared = { state, offset, refresh, roomCode };

  return (
    <Shell wide onLanguageChange={onLanguageChange}>
      <StatusAnnouncer message={announcement} />

      <div className="space-y-4">
        {error && error.code === 'NOT_IN_ROOM' ? (
          <EmptyState title={t('status.notInRoomTitle')} body={t('status.notInRoomBody')}>
            <Link to={`/join/${roomCode}`} className="btn-primary btn-sm">
              {t('join.submit')}
            </Link>
          </EmptyState>
        ) : (
          error && <ErrorBanner error={error} onDismiss={clearError} />
        )}

        {!realtimeConnected && state.game.phase !== 'finished' && (
          <p className="text-xs text-ink-faint" role="status">
            {t('status.reconnecting')}
          </p>
        )}

        {nextRoom && (
          <section className="card border-teal-400 bg-teal-50 p-4">
            <p className="text-sm font-medium">{t('final.playAgainJoined')}</p>
            <button
              type="button"
              className="btn-primary btn-sm mt-2"
              onClick={() => navigate(`/room/${nextRoom}`, { replace: true })}
            >
              {t('final.playAgain')}
            </button>
          </section>
        )}

        <PhaseView {...shared} />
      </div>
    </Shell>
  );
}

type ViewProps = {
  state: NonNullable<ReturnType<typeof useGameRoom>['state']>;
  offset: ReturnType<typeof useGameRoom>['offset'];
  refresh: () => Promise<void>;
  roomCode: string;
};

function PhaseView({ state, offset, refresh, roomCode }: ViewProps) {
  const phase = state.game.phase;
  const effective = state.game.effectivePhase;

  if (phase === 'finished' || phase === 'cancelled') {
    return <FinalView state={state} roomCode={roomCode} refresh={refresh} />;
  }

  if (phase === 'lobby') {
    return <LobbyView state={state} roomCode={roomCode} refresh={refresh} />;
  }

  // A paused game shows why it is paused, with the underlying screen's context intact.
  if (phase === 'paused') {
    return <PauseView state={state} roomCode={roomCode} refresh={refresh} offset={offset} />;
  }

  if (effective === 'preparing_cards') {
    return state.turn?.iAmRanker ? (
      <PrepareView state={state} roomCode={roomCode} refresh={refresh} />
    ) : (
      <WaitingView state={state} roomCode={roomCode} refresh={refresh} kind="preparing" />
    );
  }

  if (effective === 'ranker_ordering') {
    return state.turn?.iAmRanker ? (
      <OrderingView
        state={state}
        roomCode={roomCode}
        refresh={refresh}
        offset={offset}
        role="ranker"
      />
    ) : (
      <WaitingView state={state} roomCode={roomCode} refresh={refresh} kind="ranker_ordering" />
    );
  }

  if (effective === 'guessers_ordering') {
    if (state.turn?.iAmEligibleGuesser && !state.turn.iHaveSubmitted) {
      return (
        <OrderingView
          state={state}
          roomCode={roomCode}
          refresh={refresh}
          offset={offset}
          role="guesser"
        />
      );
    }
    return (
      <WaitingView
        state={state}
        roomCode={roomCode}
        refresh={refresh}
        kind="submitted"
        offset={offset}
      />
    );
  }

  if (effective === 'reveal') {
    return <RevealView state={state} roomCode={roomCode} refresh={refresh} offset={offset} />;
  }

  return <WaitingView state={state} roomCode={roomCode} refresh={refresh} kind="advancing" />;
}

function RoomProblem({ code, roomCode }: { code: string; roomCode: string }) {
  const { t } = useTranslation();

  const copy: Record<string, { title: string; body: string }> = {
    ROOM_NOT_FOUND: { title: t('status.roomNotFoundTitle'), body: t('status.roomNotFoundBody') },
    ROOM_FULL: { title: t('status.roomFullTitle'), body: t('status.roomFullBody') },
    GAME_OVER: { title: t('status.gameOverTitle'), body: t('status.gameOverBody') },
    NOT_IN_ROOM: { title: t('status.notInRoomTitle'), body: t('status.notInRoomBody') },
  };

  const chosen = copy[code] ?? { title: t('errors.title'), body: t(`errors.${code}`) };

  return (
    <EmptyState title={chosen.title} body={chosen.body}>
      <Link to={`/join/${roomCode}`} className="btn-primary btn-sm">
        {t('join.submit')}
      </Link>
      <Link to="/" className="btn-quiet btn-sm">
        {t('common.back')}
      </Link>
    </EmptyState>
  );
}

function phaseAnnouncement(phase: string, t: (key: string) => string): string {
  switch (phase) {
    case 'preparing_cards':
      return t('prepare.title');
    case 'ranker_ordering':
      return t('order.rankerTitle');
    case 'guessers_ordering':
      return t('order.guesserTitle');
    case 'reveal':
      return t('reveal.title');
    case 'finished':
      return t('final.title');
    default:
      return t('common.loading');
  }
}
