import { describe, expect, it } from 'vitest';
import { cardMatchesQuery, cardSortKey, displayCard, isUsableCard } from './cards';
import factoryCards from '../../supabase/seed/factory_cards.json';

describe('bilingual card fallback', () => {
  const bilingual = { textEn: 'Going camping', textEs: 'Ir de camping' };
  const englishOnly = { textEn: 'Board games', textEs: null };
  const spanishOnly = { textEn: null, textEs: 'La siesta' };

  it('shows a bilingual card in the reader’s own language', () => {
    expect(displayCard(bilingual, 'en')).toEqual({
      text: 'Going camping',
      shownLanguage: 'en',
      isFallback: false,
    });
    expect(displayCard(bilingual, 'es')).toEqual({
      text: 'Ir de camping',
      shownLanguage: 'es',
      isFallback: false,
    });
  });

  it('falls back to the other language and says so', () => {
    // A Spanish reader meeting an English-only custom card.
    expect(displayCard(englishOnly, 'es')).toEqual({
      text: 'Board games',
      shownLanguage: 'en',
      isFallback: true,
    });
    // An English reader meeting a Spanish-only custom card.
    expect(displayCard(spanishOnly, 'en')).toEqual({
      text: 'La siesta',
      shownLanguage: 'es',
      isFallback: true,
    });
  });

  it('does not mark a card as a fallback when the language matches', () => {
    expect(displayCard(englishOnly, 'en')?.isFallback).toBe(false);
    expect(displayCard(spanishOnly, 'es')?.isFallback).toBe(false);
  });

  it('treats empty strings as missing', () => {
    expect(displayCard({ textEn: '', textEs: 'Solo español' }, 'en')).toEqual({
      text: 'Solo español',
      shownLanguage: 'es',
      isFallback: true,
    });
  });

  it('returns null only for a card with no text at all', () => {
    expect(displayCard({ textEn: null, textEs: null }, 'en')).toBeNull();
    expect(isUsableCard({ textEn: null, textEs: null })).toBe(false);
    expect(isUsableCard(englishOnly)).toBe(true);
  });
});

describe('factory dictionary', () => {
  const cards = factoryCards as { en: string; es: string }[];

  it('ships at least 250 concepts', () => {
    expect(cards.length).toBeGreaterThanOrEqual(250);
  });

  it('gives every factory card both an English and a Spanish version', () => {
    const incomplete = cards.filter((c) => !c.en?.trim() || !c.es?.trim());
    expect(incomplete).toEqual([]);
  });

  it('has no duplicate concepts in either language', () => {
    const en = cards.map((c) => c.en.trim().toLowerCase());
    const es = cards.map((c) => c.es.trim().toLowerCase());
    expect(new Set(en).size).toBe(cards.length);
    expect(new Set(es).size).toBe(cards.length);
  });

  it('keeps every card short enough for the database and the UI', () => {
    const tooLong = cards.filter((c) => c.en.length > 80 || c.es.length > 80);
    expect(tooLong).toEqual([]);
  });

  it('renders every factory card in both languages without ever falling back', () => {
    for (const card of cards) {
      const asCard = { textEn: card.en, textEs: card.es };
      expect(displayCard(asCard, 'en')?.isFallback).toBe(false);
      expect(displayCard(asCard, 'es')?.isFallback).toBe(false);
    }
  });
});

describe('dictionary list helpers', () => {
  it('sorts by whichever language exists', () => {
    expect(cardSortKey({ textEn: 'Zebra', textEs: 'Aardvark' })).toBe('zebra');
    expect(cardSortKey({ textEn: null, textEs: 'Aardvark' })).toBe('aardvark');
  });

  it('searches across both languages', () => {
    const card = { textEn: 'Going camping', textEs: 'Ir de camping' };
    expect(cardMatchesQuery(card, 'camp')).toBe(true);
    expect(cardMatchesQuery(card, 'IR DE')).toBe(true);
    expect(cardMatchesQuery(card, 'pizza')).toBe(false);
    expect(cardMatchesQuery(card, '   ')).toBe(true);
  });
});
