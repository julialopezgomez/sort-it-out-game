import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CardText } from '../../components/CardText';
import { Dialog, ConfirmDialog } from '../../components/Dialog';
import { ErrorBanner } from '../../components/Feedback';
import { HostControls } from './HostControls';
import { TurnHeader } from './TurnHeader';
import * as rpc from '../../lib/rpc';
import { toGameError, type GameError } from '../../lib/errors';
import { canRedrawCustomOnly } from '../../lib/sampling';
import { cardMatchesQuery, cardSortKey } from '../../lib/cards';
import { CARD_TEXT_MAX_LENGTH } from '../../lib/types';
import type { RoomViewProps } from './shared';

/**
 * Card preparation, visible only to the Ranker.
 *
 * There is no clock here on purpose: choosing what you are willing to rank is part of the
 * fun, and rushing it makes for worse cards. Each of the five slots has its own three
 * actions, and there are three actions for the whole hand.
 *
 * Every one of these calls names a *slot*, never a card. The database picks what goes in
 * it, which is what stops a modified client from stacking the deck.
 */
export function PrepareView({ state, roomCode, refresh }: RoomViewProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GameError | null>(null);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [manualSlot, setManualSlot] = useState<number | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);

  const cards = state.turn?.cards ?? [];
  const customCards = useMemo(() => state.customCards ?? [], [state.customCards]);

  const unusedCustom = useMemo(
    () => customCards.filter((card) => !card.usedThisTurn),
    [customCards],
  );

  const customOnlyAvailable = canRedrawCustomOnly(customCards.length);

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
      <TurnHeader state={state} showTimer={false} />

      <section>
        <h1 className="text-2xl">{t('prepare.title')}</h1>
        <p className="help">{t('prepare.intro')}</p>
      </section>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <ol className="space-y-2">
        {cards.map((card) => {
          const slot = card.slot ?? 0;
          return (
            <li key={card.canonicalId} className="card p-3" data-card-id={card.canonicalId}>
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 font-semibold text-teal-700"
                >
                  {slot}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="sr-only">{t('prepare.cardNumber', { number: slot })}: </span>
                  <CardText card={card} />
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2 pl-11">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  aria-label={t('prepare.replaceRandomLabel', { number: slot })}
                  onClick={() => void run(() => rpc.replaceCardRandom(roomCode, slot))}
                >
                  {t('prepare.replaceRandom')}
                </button>

                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busy || unusedCustom.length === 0}
                  aria-label={t('prepare.chooseCustomLabel', { number: slot })}
                  title={unusedCustom.length === 0 ? t('prepare.chooseCustomDisabled') : undefined}
                  onClick={() => setPickerSlot(slot)}
                >
                  {t('prepare.chooseCustom')}
                </button>

                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busy || !state.game.allowManualCards}
                  aria-label={t('prepare.enterManualLabel', { number: slot })}
                  title={!state.game.allowManualCards ? t('prepare.manualDisabled') : undefined}
                  onClick={() => setManualSlot(slot)}
                >
                  {t('prepare.enterManual')}
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {unusedCustom.length === 0 && customCards.length > 0 && (
        <p className="text-sm text-ink-faint">{t('prepare.chooseCustomDisabled')}</p>
      )}
      {!state.game.allowManualCards && (
        <p className="text-sm text-ink-faint">{t('prepare.manualDisabled')}</p>
      )}

      <section className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || cards.length !== 5}
          onClick={() => void run(() => rpc.acceptCards(roomCode))}
        >
          {t('prepare.accept')}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => void run(() => rpc.redrawAllCards(roomCode))}
        >
          {t('prepare.redrawAll')}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy || !customOnlyAvailable}
          title={
            customOnlyAvailable
              ? undefined
              : t('prepare.redrawCustomDisabled', { available: customCards.length })
          }
          onClick={() => void run(() => rpc.redrawCustomCards(roomCode))}
        >
          {t('prepare.redrawCustomOnly')}
        </button>
      </section>

      {!customOnlyAvailable && (
        <p className="text-sm text-ink-faint">
          {t('prepare.redrawCustomDisabled', { available: customCards.length })}
        </p>
      )}

      <section className="border-t border-line pt-3">
        <p className="help">{t('prepare.waitingSkip')}</p>
        <button
          type="button"
          className="btn-quiet btn-sm mt-1"
          disabled={busy}
          onClick={() => setConfirmSkip(true)}
        >
          {t('prepare.skipMyTurn')}
        </button>
      </section>

      <HostControls state={state} roomCode={roomCode} refresh={refresh} onError={setError} />

      {/* Pick one of this game's custom terms for a specific slot. */}
      <CustomCardPicker
        open={pickerSlot !== null}
        cards={unusedCustom}
        onClose={() => setPickerSlot(null)}
        onPick={(cardId) => {
          const slot = pickerSlot;
          setPickerSlot(null);
          if (slot !== null) void run(() => rpc.chooseCustomCard(roomCode, slot, cardId));
        }}
      />

      <ManualCardDialog
        open={manualSlot !== null}
        onClose={() => setManualSlot(null)}
        onSubmit={(textEn, textEs) => {
          const slot = manualSlot;
          setManualSlot(null);
          if (slot !== null) {
            void run(() => rpc.createManualCard(roomCode, slot, textEn, textEs));
          }
        }}
      />

      <ConfirmDialog
        open={confirmSkip}
        title={t('prepare.skipConfirmTitle')}
        body={t('prepare.skipConfirmBody')}
        confirmLabel={t('prepare.skipConfirm')}
        danger
        onCancel={() => setConfirmSkip(false)}
        onConfirm={() => {
          setConfirmSkip(false);
          void run(() => rpc.skipRankerTurn(roomCode));
        }}
      />
    </div>
  );
}

function CustomCardPicker({
  open,
  cards,
  onClose,
  onPick,
}: {
  open: boolean;
  cards: { id: string; textEn: string | null; textEs: string | null }[];
  onClose: () => void;
  onPick: (cardId: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () =>
      cards
        .filter((card) => cardMatchesQuery(card, query))
        .sort((a, b) => cardSortKey(a).localeCompare(cardSortKey(b))),
    [cards, query],
  );

  return (
    <Dialog open={open} title={t('prepare.pickerTitle')} onClose={onClose}>
      <label className="label" htmlFor="card-search">
        {t('prepare.pickerSearch')}
      </label>
      <input
        id="card-search"
        className="field mt-1"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('prepare.pickerSearchPlaceholder')}
        data-autofocus
        autoComplete="off"
      />

      {filtered.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">{t('prepare.pickerEmpty')}</p>
      ) : (
        <ul className="mt-3 max-h-72 divide-y divide-line overflow-y-auto">
          {filtered.map((card) => (
            <li key={card.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1 break-words text-sm">
                {card.textEn ?? '—'}
                <span className="text-ink-faint"> · </span>
                {card.textEs ?? '—'}
              </span>
              <button
                type="button"
                className="btn-secondary btn-sm shrink-0"
                onClick={() => onPick(card.id)}
              >
                {t('prepare.pickerUse')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function ManualCardDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (textEn: string | null, textEs: string | null) => void;
}) {
  const { t } = useTranslation();
  const [english, setEnglish] = useState('');
  const [spanish, setSpanish] = useState('');

  const valid = english.trim() !== '' || spanish.trim() !== '';

  const close = () => {
    setEnglish('');
    setSpanish('');
    onClose();
  };

  return (
    <Dialog
      open={open}
      title={t('prepare.manualTitle')}
      onClose={close}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={close}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!valid}
            onClick={() => {
              onSubmit(english.trim() || null, spanish.trim() || null);
              setEnglish('');
              setSpanish('');
            }}
          >
            {t('prepare.manualAdd')}
          </button>
        </>
      }
    >
      <p className="help">{t('prepare.manualIntro')}</p>

      <label className="label mt-3" htmlFor="manual-en">
        {t('prepare.manualEnglish')}
      </label>
      <input
        id="manual-en"
        className="field mt-1"
        value={english}
        onChange={(event) => setEnglish(event.target.value)}
        maxLength={CARD_TEXT_MAX_LENGTH}
        data-autofocus
        autoComplete="off"
      />

      <label className="label mt-3" htmlFor="manual-es">
        {t('prepare.manualSpanish')}
      </label>
      <input
        id="manual-es"
        className="field mt-1"
        value={spanish}
        onChange={(event) => setSpanish(event.target.value)}
        maxLength={CARD_TEXT_MAX_LENGTH}
        autoComplete="off"
      />

      {!valid && <p className="mt-2 text-sm text-coral-700">{t('prepare.manualNeedOne')}</p>}
    </Dialog>
  );
}
