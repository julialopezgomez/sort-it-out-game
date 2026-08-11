import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';

/**
 * The page frame: a skip link, a quiet header, and one main landmark.
 */
export function Shell({
  children,
  wide = false,
  onLanguageChange,
}: {
  children: ReactNode;
  wide?: boolean;
  onLanguageChange?: (language: 'en' | 'es') => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only-focusable btn-primary absolute left-4 top-4 z-50 focus:not-sr-only"
      >
        {t('a11y.skipToContent')}
      </a>

      <header className="border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="group flex min-w-0 items-baseline gap-2 rounded-lg">
            <span className="text-lg font-semibold tracking-tight text-ink group-hover:text-teal-700">
              {t('app.name')}
            </span>
            <span className="hidden truncate text-sm text-ink-faint sm:inline">
              {t('app.tagline')}
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeSwitcher />
            <LanguageSwitcher onChange={onLanguageChange} />
          </div>
        </div>
      </header>

      <main id="main" aria-label={t('a11y.mainLandmark')} className={wide ? 'stack-wide' : 'stack'}>
        {children}
      </main>

      <footer className="mx-auto w-full max-w-4xl px-4 pb-10 text-center text-xs text-ink-faint sm:px-6">
        <Link to="/rules" className="underline hover:text-ink-soft">
          {t('landing.readRules')}
        </Link>
      </footer>
    </div>
  );
}
