import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shell } from '../components/Shell';
import { TimeLimitPicker } from '../components/TimeLimitPicker';
import { CsvImport } from '../components/CsvImport';
import { ErrorBanner, ServiceUnavailable } from '../components/Feedback';
import { ConfirmDialog } from '../components/Dialog';
import * as rpc from '../lib/rpc';
import { GameError, toGameError } from '../lib/errors';
import { isSupabaseConfigured } from '../lib/supabase';
import { rememberMembership } from '../lib/session';
import { currentLanguage } from '../i18n';
import { customCardKey } from '../lib/normalize';
import {
  clearLocalDictionary,
  loadLocalDictionary,
  localDictionaryForUpload,
  mergeIntoLocalDictionary,
} from '../lib/localDictionary';
import {
  CYCLES_MAX,
  CYCLES_MIN,
  GUESSER_TIME_PRESETS,
  NAME_MAX_LENGTH,
  RANKER_TIME_PRESETS,
  type GameSettings,
} from '../lib/types';

export function CreateGameScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [settings, setSettings] = useState<GameSettings>({
    totalCycles: 2,
    rankerSeconds: 45,
    guesserSeconds: 60,
    allowManualCards: true,
  });
  const [dictionary, setDictionary] = useState(() => loadLocalDictionary());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GameError | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

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
      const result = await rpc.createRoom({
        displayName,
        language: currentLanguage(),
        settings,
        // The Host's private dictionary travels into every game they create.
        customCards: localDictionaryForUpload(),
      });
      rememberMembership({
        roomCode: result.roomCode,
        displayName: displayName.trim(),
        isHost: true,
      });
      navigate(`/room/${result.roomCode}`, { replace: true });
    } catch (caught) {
      setError(toGameError(caught));
      setBusy(false);
    }
  };

  const nameLength = displayName.trim().length;
  const canSubmit = nameLength >= 1 && nameLength <= NAME_MAX_LENGTH && !busy;

  return (
    <Shell>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        <h1 className="text-2xl">{t('create.title')}</h1>

        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

        <section className="card p-4">
          <label className="label" htmlFor="host-name">
            {t('create.yourName')}
          </label>
          <input
            id="host-name"
            className="field mt-1"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={t('create.namePlaceholder')}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="off"
            autoCapitalize="words"
            required
            aria-describedby="host-name-help"
          />
          <p className="help" id="host-name-help">
            {t('create.nameHelp')}
          </p>
        </section>

        <section className="card space-y-5 p-4">
          <h2 className="text-lg">{t('create.settingsTitle')}</h2>

          <div>
            <label className="label" htmlFor="cycles">
              {t('create.cycles')}
            </label>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="cycles-label">
              {Array.from({ length: CYCLES_MAX - CYCLES_MIN + 1 }, (_, i) => i + CYCLES_MIN).map(
                (count) => (
                  <button
                    key={count}
                    type="button"
                    aria-pressed={settings.totalCycles === count}
                    onClick={() => setSettings((s) => ({ ...s, totalCycles: count }))}
                    className={`btn btn-sm min-w-[2.75rem] ${
                      settings.totalCycles === count
                        ? 'bg-teal-600 text-white'
                        : 'border border-line bg-surface text-ink hover:bg-teal-50'
                    }`}
                  >
                    {count}
                  </button>
                ),
              )}
            </div>
            <input type="hidden" id="cycles" value={settings.totalCycles} readOnly />
            <p className="help" id="cycles-label">
              {t('create.cyclesHelp')}
            </p>
          </div>

          <TimeLimitPicker
            label={t('create.rankerTime')}
            help={t('create.timeHelp')}
            value={settings.rankerSeconds}
            presets={RANKER_TIME_PRESETS}
            onChange={(seconds) => setSettings((s) => ({ ...s, rankerSeconds: seconds }))}
          />

          <TimeLimitPicker
            label={t('create.guesserTime')}
            help={t('create.guesserTimeHelp')}
            value={settings.guesserSeconds}
            presets={GUESSER_TIME_PRESETS}
            onChange={(seconds) => setSettings((s) => ({ ...s, guesserSeconds: seconds }))}
          />

          <div>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 rounded border-line text-teal-600"
                checked={settings.allowManualCards}
                onChange={(event) =>
                  setSettings((s) => ({ ...s, allowManualCards: event.target.checked }))
                }
              />
              <span>
                <span className="font-medium">{t('create.allowManualCards')}</span>
                <span className="help block">{t('create.allowManualCardsHelp')}</span>
              </span>
            </label>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="text-lg">{t('create.dictionaryTitle')}</h2>
          <p className="help">{t('create.dictionaryHelp')}</p>
          <p className="mt-2 text-sm font-medium">
            {t('create.dictionaryStored', { count: dictionary.length })}
          </p>

          <div className="mt-3">
            <CsvImport
              existingKeys={dictionary.map((card) => customCardKey(card.en, card.es))}
              onImport={(cards) => {
                mergeIntoLocalDictionary(cards);
                setDictionary(loadLocalDictionary());
              }}
            />
          </div>

          {dictionary.length > 0 && (
            <button
              type="button"
              className="btn-quiet btn-sm mt-3"
              onClick={() => setConfirmClear(true)}
            >
              {t('create.clearDictionary')}
            </button>
          )}
        </section>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={!canSubmit}>
            {busy ? t('create.creating') : t('create.submit')}
          </button>
          <button type="button" className="btn-quiet" onClick={() => navigate('/')}>
            {t('common.back')}
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmClear}
        title={t('create.clearDictionary')}
        body={t('create.clearDictionaryConfirm')}
        confirmLabel={t('create.clearDictionary')}
        danger
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          clearLocalDictionary();
          setDictionary(loadLocalDictionary());
          setConfirmClear(false);
        }}
      />
    </Shell>
  );
}
