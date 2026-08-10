import { useTranslation } from 'react-i18next';
import { changeLanguage, currentLanguage } from '../i18n';
import { LANGUAGES, type Language } from '../lib/types';

/**
 * Each player's own language, and nobody else's.
 *
 * Changing this affects only this browser: it is stored locally and, once in a room, sent
 * to the player's own row so a reconnect from another device remembers the choice.
 */
export function LanguageSwitcher({ onChange }: { onChange?: (language: Language) => void }) {
  const { t } = useTranslation();
  const active = currentLanguage();

  const pick = async (language: Language) => {
    if (language === active) return;
    await changeLanguage(language);
    onChange?.(language);
  };

  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-canvas p-1"
      role="group"
      aria-label={t('a11y.languageSwitcher')}
    >
      {LANGUAGES.map((language) => (
        <button
          key={language}
          type="button"
          onClick={() => void pick(language)}
          aria-pressed={active === language}
          className={`min-h-[2.25rem] rounded-full px-3 text-sm font-medium transition-colors ${
            active === language
              ? 'bg-teal-600 text-white'
              : 'text-ink-soft hover:bg-black/5 hover:text-ink'
          }`}
        >
          {language === 'en' ? 'EN' : 'ES'}
          <span className="sr-only">{language === 'en' ? ' English' : ' Español'}</span>
        </button>
      ))}
    </div>
  );
}
