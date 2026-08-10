import type { Card, Language } from './types';

/**
 * Bilingual card display.
 *
 * Factory cards always carry both languages, so every player sees a concept in their own
 * language and — because the canonical id is language-independent — everyone is ranking
 * the same five things.
 *
 * Custom cards may only have one language, because the group typed them and we do not
 * call a translation API. When the reader's language is missing we show what exists and
 * mark it, rather than hiding the card or inventing a translation.
 */

export type CardDisplay = {
  text: string;
  /** The language the text actually came from. */
  shownLanguage: Language;
  /** True when this is not the language the reader asked for. */
  isFallback: boolean;
};

export function displayCard(
  card: Pick<Card, 'textEn' | 'textEs'>,
  language: Language,
): CardDisplay | null {
  const preferred = language === 'en' ? card.textEn : card.textEs;
  if (preferred !== null && preferred !== '') {
    return { text: preferred, shownLanguage: language, isFallback: false };
  }

  const other: Language = language === 'en' ? 'es' : 'en';
  const fallback = other === 'en' ? card.textEn : card.textEs;
  if (fallback !== null && fallback !== '') {
    return { text: fallback, shownLanguage: other, isFallback: true };
  }

  // A card with neither language cannot exist: the database CHECK constraint forbids it.
  return null;
}

/** True when a card can be shown at all. */
export function isUsableCard(card: Pick<Card, 'textEn' | 'textEs'>): boolean {
  return Boolean(card.textEn) || Boolean(card.textEs);
}

/** Sort label for dictionary lists, independent of the reader's language. */
export function cardSortKey(card: Pick<Card, 'textEn' | 'textEs'>): string {
  return (card.textEn ?? card.textEs ?? '').toLowerCase();
}

/** Does this card mention `query` in either language? Used by the custom-card picker. */
export function cardMatchesQuery(card: Pick<Card, 'textEn' | 'textEs'>, query: string): boolean {
  const needle = query.normalize('NFKC').trim().toLowerCase();
  if (needle === '') return true;
  return [card.textEn, card.textEs].some((text) => text?.toLowerCase().includes(needle) ?? false);
}
