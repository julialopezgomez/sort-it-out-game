import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorKey, type GameError } from '../lib/errors';
import { supabaseDashboardUrl } from '../lib/supabase';

/** A dismissible inline error, for things the player can react to. */
export function ErrorBanner({ error, onDismiss }: { error: GameError; onDismiss?: () => void }) {
  const { t } = useTranslation();

  return (
    <div role="alert" className="card border-coral-500 bg-coral-50 p-3">
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="text-coral-700">
          !
        </span>
        <p className="flex-1 text-sm text-coral-700">{t(errorKey(error.code))}</p>
        {onDismiss && (
          <button type="button" className="btn-quiet btn-sm" onClick={onDismiss}>
            {t('common.dismiss')}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The full-page state for "the backend is not answering".
 *
 * Ordinary players see a short, calm message. Underneath it, in a clearly separated block,
 * is the note for whoever runs the site — because on the Supabase free plan the usual cause
 * is a project that was paused for inactivity and has to be restored by hand.
 */
export function ServiceUnavailable({ error }: { error: GameError }) {
  const { t } = useTranslation();
  const notConfigured = error.code === 'NOT_CONFIGURED';
  const offline = error.code === 'OFFLINE';

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h1 className="text-xl">
          {offline
            ? t('status.offlineTitle')
            : notConfigured
              ? t('status.notConfiguredTitle')
              : t('status.unavailableTitle')}
        </h1>
        <p className="mt-2 text-ink-soft">
          {offline
            ? t('status.offlineBody')
            : notConfigured
              ? t('status.notConfiguredBody')
              : t('status.unavailableBody')}
        </p>
        <button type="button" className="btn-primary mt-4" onClick={() => window.location.reload()}>
          {t('common.retry')}
        </button>
      </section>

      {!offline && (
        <section className="card border-dashed bg-canvas p-5">
          <h2 className="text-base">{t('status.ownerTitle')}</h2>
          {notConfigured ? (
            <>
              <p className="mt-2 text-sm text-ink-soft">{t('status.notConfiguredBody')}</p>
              <p className="mt-2 text-sm text-ink-soft">{t('status.readmeHint')}</p>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-ink-soft">{t('status.ownerBody')}</p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
                <li>{t('status.ownerStep1')}</li>
                <li>{t('status.ownerStep2')}</li>
                <li>{t('status.ownerStep3')}</li>
              </ol>
              <a
                className="btn-secondary btn-sm mt-3"
                href={supabaseDashboardUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t('status.openDashboard')}
              </a>
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** A calm full-page message for the ordinary dead ends: bad code, full room, finished game. */
export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <section className="card p-5">
      <h1 className="text-xl">{title}</h1>
      {body && <p className="mt-2 text-ink-soft">{body}</p>}
      {children && <div className="mt-4 flex flex-wrap gap-2">{children}</div>}
    </section>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 text-ink-soft" role="status" aria-live="polite">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-teal-600"
      />
      <span>{label ?? t('common.loading')}</span>
    </div>
  );
}

/** A polite live region for phase changes, so a screen reader is told the game moved on. */
export function StatusAnnouncer({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
