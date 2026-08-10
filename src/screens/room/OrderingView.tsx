import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OrderableList } from '../../components/OrderableList';
import { ErrorBanner } from '../../components/Feedback';
import { ConfirmDialog } from '../../components/Dialog';
import { HostControls } from './HostControls';
import { TurnHeader } from './TurnHeader';
import * as rpc from '../../lib/rpc';
import { toGameError, type GameError } from '../../lib/errors';
import type { CardView, GameStateView } from '../../lib/schemas';
import { CARDS_PER_TURN } from '../../lib/types';
import type { RoomViewProps } from './shared';

const PERSIST_DEBOUNCE_MS = 700;

/**
 * Private ordering, for the Ranker and for a Guesser.
 *
 * The difference between the two roles is small but important:
 *
 *  - The Ranker's starting sequence is already a valid order, and drafts are saved as they
 *    go, so a timeout submits whatever they last had rather than nothing.
 *  - A Guesser must press submit. Missing the deadline scores 0 for that turn — and the
 *    turn still counts in their average, which is why the screen says so up front.
 */
export function OrderingView({
  state,
  roomCode,
  refresh,
  offset,
  role,
}: RoomViewProps & { role: 'ranker' | 'guesser' }) {
  const { t } = useTranslation();
  const turn = state.turn;

  const [order, setOrder] = useState<string[]>(() => initialOrder(state));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GameError | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localEdit = useRef(false);
  const turnId = turn?.turnId ?? null;

  // Adopt the server's order on a new turn, or when a refetch brings a newer draft than we
  // have locally (for instance after reconnecting on another device).
  useEffect(() => {
    localEdit.current = false;
    setOrder(initialOrder(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnId, role]);

  const cards = orderedCards(turn?.cards ?? [], order);

  const persist = useCallback(
    (next: string[]) => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        // A draft save is best effort: it exists so a refresh does not lose work, and a
        // failure changes nothing that matters.
        void rpc.persistRanking(roomCode, next).catch(() => undefined);
      }, PERSIST_DEBOUNCE_MS);
    },
    [roomCode],
  );

  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    },
    [],
  );

  const handleChange = (next: string[]) => {
    localEdit.current = true;
    setOrder(next);
    persist(next);
  };

  const submit = async () => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    setBusy(true);
    setError(null);
    try {
      await rpc.submitRanking(roomCode, order);
      await refresh();
    } catch (caught) {
      setError(toGameError(caught));
      // The phase may well have moved on underneath us; make sure the screen catches up.
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const isRanker = role === 'ranker';

  return (
    <div className="space-y-4">
      <TurnHeader state={state} offset={offset} />

      <section>
        <h1 className="text-2xl">
          {isRanker
            ? t('order.rankerTitle')
            : t('order.guesserTitle', { name: turn?.rankerDisplayName ?? '' })}
        </h1>
        <p className="help">
          {isRanker
            ? t('order.rankerIntro')
            : t('order.guesserIntro', { name: turn?.rankerDisplayName ?? '' })}
        </p>
      </section>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {/* A player carrying a skip penalty deserves to know before they invest effort. */}
      {!isRanker && state.me.pendingPenalties > 0 && (
        <p className="rounded-xl bg-coral-50 px-3 py-2 text-sm text-coral-700">
          {t('order.penaltyWarning')}
        </p>
      )}

      <OrderableList items={cards} onChange={handleChange} disabled={busy} />

      <section className="space-y-2">
        <button
          type="button"
          className="btn-primary w-full sm:w-auto"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? t('order.submitting') : t('order.submit')}
        </button>
        <p className="help">{t('order.autoSaveHint')}</p>
        <p className="help">
          {isRanker ? t('order.rankerAutoSubmitHint') : t('order.guesserMustSubmitHint')}
        </p>
      </section>

      {isRanker && (
        <section className="border-t border-line pt-3">
          <button
            type="button"
            className="btn-quiet btn-sm"
            disabled={busy}
            onClick={() => setConfirmSkip(true)}
          >
            {t('prepare.skipMyTurn')}
          </button>
        </section>
      )}

      <HostControls state={state} roomCode={roomCode} refresh={refresh} onError={setError} />

      <ConfirmDialog
        open={confirmSkip}
        title={t('prepare.skipConfirmTitle')}
        body={t('prepare.skipConfirmBody')}
        confirmLabel={t('prepare.skipConfirm')}
        danger
        onCancel={() => setConfirmSkip(false)}
        onConfirm={() => {
          setConfirmSkip(false);
          void (async () => {
            setBusy(true);
            try {
              await rpc.skipRankerTurn(roomCode);
              await refresh();
            } catch (caught) {
              setError(toGameError(caught));
            } finally {
              setBusy(false);
            }
          })();
        }}
      />
    </div>
  );
}

/**
 * Where the list starts: the draft the server already has, or the dealt slot order — which
 * is itself a valid order, so a Ranker who never touches anything still submits something.
 */
function initialOrder(state: GameStateView): string[] {
  const turn = state.turn;
  if (!turn) return [];
  if (turn.myOrder && turn.myOrder.length === CARDS_PER_TURN) return turn.myOrder;
  return (turn.cards ?? []).map((card) => card.canonicalId);
}

/** Present the cards in the player's current order, ignoring anything unexpected. */
function orderedCards(cards: CardView[], order: string[]): CardView[] {
  const byId = new Map(cards.map((card) => [card.canonicalId, card]));
  const result: CardView[] = [];
  for (const id of order) {
    const card = byId.get(id);
    if (card) {
      result.push(card);
      byId.delete(id);
    }
  }
  // Anything the order did not mention (a fresh turn, a stale draft) goes on the end.
  for (const card of byId.values()) result.push(card);
  return result;
}
