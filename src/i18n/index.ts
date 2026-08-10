import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import es from './es.json';
import type { Language } from '../lib/types';

/**
 * Interface localization.
 *
 * Each player picks their own language and it affects nobody else's screen: the choice
 * lives in this browser (and on the player row, so a reconnect from another device
 * remembers it). Card *content* is localized separately by the database, which sends each
 * player the text for their own language along with the same canonical card ids.
 */

const LANGUAGE_KEY = 'sortitout.language.v1';

export const resources = { en: { translation: en }, es: { translation: es } } as const;

function detectLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    if (stored === 'en' || stored === 'es') return stored;
  } catch {
    /* fall through to the browser preference */
  }

  const preferred = typeof navigator === 'undefined' ? '' : (navigator.language ?? '');
  return preferred.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function storeLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    /* not fatal: the language simply is not remembered next visit */
  }
}

export function currentLanguage(): Language {
  return i18next.language === 'es' ? 'es' : 'en';
}

export async function changeLanguage(language: Language): Promise<void> {
  storeLanguage(language);
  await i18next.changeLanguage(language);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
  }
}

void i18next.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

if (typeof document !== 'undefined') {
  document.documentElement.lang = currentLanguage();
}

export default i18next;
