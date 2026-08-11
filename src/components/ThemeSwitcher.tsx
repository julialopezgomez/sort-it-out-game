import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readTheme, storeTheme, THEME_OPTIONS, type Theme } from '../lib/theme';

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const [active, setActive] = useState<Theme>(() => readTheme());
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const pick = (theme: Theme) => {
    storeTheme(theme);
    setActive(theme);
    setOpen(false);
    setAnnouncement(t('theme.changed', { theme: t(`theme.${theme}`) }));
    triggerRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-touch min-w-[2.75rem] items-center justify-center rounded-full border border-line bg-canvas text-teal-700 transition-colors hover:bg-teal-50"
        aria-label={t('theme.open')}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="theme-picker"
        title={t('theme.open')}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3a9 9 0 0 0 0 18h1.3a1.7 1.7 0 0 0 1.2-2.9 1.7 1.7 0 0 1 1.2-2.9H18A3 3 0 0 0 21 12a9 9 0 0 0-9-9Z" />
          <circle cx="7.5" cy="10" r=".8" fill="currentColor" stroke="none" />
          <circle cx="10" cy="6.8" r=".8" fill="currentColor" stroke="none" />
          <circle cx="14" cy="6.8" r=".8" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {open ? (
        <div
          id="theme-picker"
          role="group"
          aria-label={t('theme.title')}
          className="card fixed inset-x-4 top-[4.5rem] z-40 p-2 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-60"
        >
          <p className="px-3 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {t('theme.title')}
          </p>
          {THEME_OPTIONS.map((theme) => (
            <button
              key={theme.id}
              type="button"
              aria-pressed={active === theme.id}
              onClick={() => pick(theme.id)}
              className="flex min-h-touch w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-ink hover:bg-teal-50"
            >
              <span className="flex" aria-hidden="true">
                {theme.swatches.map((color, index) => (
                  <span
                    key={color}
                    className={`h-5 w-5 rounded-full border-2 border-surface ${index > 0 ? '-ml-1.5' : ''}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span className="flex-1">{t(`theme.${theme.id}`)}</span>
              <span
                className={active === theme.id ? 'text-teal-700' : 'invisible'}
                aria-hidden="true"
              >
                ✓
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
