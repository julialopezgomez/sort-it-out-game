import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  canonicalRoomCode,
  formatRoomCode,
  hasAmbiguousCharacters,
  isValidRoomCode,
  joinUrl,
} from './roomCode';

describe('room codes', () => {
  it('excludes the ambiguous glyphs O, 0, I and 1', () => {
    for (const char of ['O', '0', 'I', '1']) {
      expect(ROOM_CODE_ALPHABET).not.toContain(char);
    }
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
  });

  it('is case-insensitive for players', () => {
    expect(canonicalRoomCode('abcdef')).toBe('ABCDEF');
    expect(canonicalRoomCode('AbCdEf')).toBe('ABCDEF');
  });

  it('forgives spaces, dashes and stray punctuation', () => {
    expect(canonicalRoomCode(' abc-def ')).toBe('ABCDEF');
    expect(canonicalRoomCode('ABC DEF')).toBe('ABCDEF');
  });

  it('validates by length', () => {
    expect(isValidRoomCode('ABCDEF')).toBe(true);
    expect(isValidRoomCode('abc def')).toBe(true);
    expect(isValidRoomCode('ABCDE')).toBe(false);
    expect(isValidRoomCode('ABCDEFG')).toBe(false);
    expect(isValidRoomCode('')).toBe(false);
    expect(isValidRoomCode(null)).toBe(false);
  });

  it('spots a code containing a character the generator never emits', () => {
    // Almost always someone typing letter O where they saw something else.
    expect(hasAmbiguousCharacters('ABCDEO')).toBe(true);
    expect(hasAmbiguousCharacters('ABCDE1')).toBe(true);
    expect(hasAmbiguousCharacters('ABCDEF')).toBe(false);
    // Only meaningful once the length is right.
    expect(hasAmbiguousCharacters('ABC')).toBe(false);
  });

  it('formats as two readable groups', () => {
    expect(formatRoomCode('ABCDEF')).toBe('ABC DEF');
    expect(formatRoomCode('abc def')).toBe('ABC DEF');
    expect(formatRoomCode('SHORT')).toBe('SHORT');
  });
});

describe('share links', () => {
  it('builds a hash route under the GitHub Pages base path', () => {
    expect(joinUrl('abcdef', 'https://example.github.io', '/sort-it-out-game/')).toBe(
      'https://example.github.io/sort-it-out-game/#/join/ABCDEF',
    );
  });

  it('handles a base path with no trailing slash', () => {
    expect(joinUrl('ABCDEF', 'https://example.github.io', '/game')).toBe(
      'https://example.github.io/game/#/join/ABCDEF',
    );
  });

  it('handles a custom domain at the root', () => {
    expect(joinUrl('ABCDEF', 'https://sortitout.example', '/')).toBe(
      'https://sortitout.example/#/join/ABCDEF',
    );
  });
});
