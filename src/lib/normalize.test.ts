import { describe, expect, it } from 'vitest';
import { cleanText, customCardKey, foldText, isNameTaken, normalizeCustomCards } from './normalize';

describe('text normalization', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanText('  Board   games  ')).toBe('Board games');
    expect(cleanText('a\t\nb')).toBe('a b');
  });

  it('turns blank input into null', () => {
    expect(cleanText('')).toBeNull();
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(null)).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });

  it('preserves accents and capitalisation exactly as typed', () => {
    expect(cleanText('Café con Leche')).toBe('Café con Leche');
  });

  it('normalizes compatibility forms so visually identical text compares equal', () => {
    // "e" + combining acute versus the precomposed "é".
    const decomposed = 'Café';
    const composed = 'Café';
    expect(foldText(decomposed)).toBe(foldText(composed));
  });

  it('folds case for comparison only', () => {
    expect(foldText('  BOARD  Games ')).toBe('board games');
  });
});

describe('duplicate custom-card normalization', () => {
  it('treats differently spaced and cased text as the same card', () => {
    expect(customCardKey('Board games', null)).toBe(customCardKey('  board   GAMES ', ''));
  });

  it('keeps a bilingual card as one card, not two', () => {
    const bilingual = customCardKey('Board games', 'Juegos de mesa');
    const englishOnly = customCardKey('Board games', null);
    expect(bilingual).not.toBe(englishOnly);
  });

  it('drops exact duplicates and reports them', () => {
    const result = normalizeCustomCards([
      { en: 'Board games', es: null },
      { en: 'board  games', es: '' },
      { en: 'Going camping', es: 'Ir de camping' },
    ]);

    expect(result.cards.map((c) => c.en)).toEqual(['Board games', 'Going camping']);
    expect(result.duplicates).toHaveLength(1);
    expect(result.invalid).toEqual([]);
  });

  it('respects cards that already exist in the dictionary', () => {
    const existing = [customCardKey('Board games', null)];
    const result = normalizeCustomCards([{ en: 'BOARD GAMES', es: null }], existing);

    expect(result.cards).toEqual([]);
    expect(result.duplicates).toHaveLength(1);
  });

  it('rejects a card with no text in either language', () => {
    const result = normalizeCustomCards([
      { en: '', es: '' },
      { en: null, es: null },
      { en: '   ', es: null },
    ]);

    expect(result.cards).toEqual([]);
    expect(result.invalid).toHaveLength(3);
    expect(result.invalid.every((i) => i.reason === 'empty')).toBe(true);
  });

  it('accepts a card with only one language', () => {
    const result = normalizeCustomCards([
      { en: 'Board games', es: null },
      { en: null, es: 'La siesta' },
    ]);
    expect(result.cards).toHaveLength(2);
    expect(result.invalid).toEqual([]);
  });

  it('rejects text longer than the database allows, keeping the good rows', () => {
    const result = normalizeCustomCards([
      { en: 'x'.repeat(81), es: null },
      { en: 'Fine', es: null },
    ]);

    expect(result.cards.map((c) => c.en)).toEqual(['Fine']);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]?.reason).toBe('too_long');
  });

  it('carries the source line through for row-level error reporting', () => {
    const result = normalizeCustomCards([
      { en: 'Good', es: null, line: 2 },
      { en: '', es: '', line: 3 },
    ]);
    expect(result.cards[0]?.line).toBe(2);
    expect(result.invalid[0]?.row.line).toBe(3);
  });
});

describe('unique display names', () => {
  const existing = ['Ana', 'Ben García'];

  it('rejects a name that differs only by case or spacing', () => {
    expect(isNameTaken('ana', existing)).toBe(true);
    expect(isNameTaken('  ANA ', existing)).toBe(true);
    expect(isNameTaken('ben garcía', existing)).toBe(true);
  });

  it('accepts a genuinely different name', () => {
    expect(isNameTaken('Cleo', existing)).toBe(false);
  });

  it('accepts a name that differs by accent, because that is a different name', () => {
    expect(isNameTaken('Ben Garcia', existing)).toBe(false);
  });

  it('lets a player keep their own name when editing', () => {
    expect(isNameTaken('Ana', existing, { ignore: 'Ana' })).toBe(false);
  });

  it('does not consider an empty name taken', () => {
    expect(isNameTaken('   ', existing)).toBe(false);
  });
});
