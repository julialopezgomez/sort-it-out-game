import { useRegisterSW } from 'virtual:pwa-register/react';
import { useTranslation } from 'react-i18next';

/**
 * Service worker lifecycle.
 *
 * The offline shell exists so the app opens instantly and does not look broken on a flaky
 * connection. It does not pretend multiplayer works offline: `offlineReady` says plainly
 * that playing with other people still needs a connection.
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface p-3 shadow-card"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-2">
        <div className="flex-1">
          <p className="text-sm font-medium">{t('pwa.updateTitle')}</p>
          <p className="text-xs text-ink-soft">{t('pwa.updateBody')}</p>
        </div>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => void updateServiceWorker(true)}
        >
          {t('pwa.reload')}
        </button>
        <button type="button" className="btn-quiet btn-sm" onClick={() => setNeedRefresh(false)}>
          {t('pwa.later')}
        </button>
      </div>
    </div>
  );
}
