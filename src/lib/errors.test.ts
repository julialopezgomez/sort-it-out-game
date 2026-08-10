import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, GameError, errorKey, isServiceProblem, toGameError } from './errors';
import en from '../i18n/en.json';
import es from '../i18n/es.json';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('error code mapping', () => {
  it('passes a known Postgres token straight through', () => {
    // Supabase wraps a plpgsql RAISE in an object whose message is our token.
    expect(toGameError({ message: 'NAME_TAKEN' }).code).toBe('NAME_TAKEN');
    expect(toGameError({ message: '  ROOM_FULL  ' }).code).toBe('ROOM_FULL');
  });

  it('keeps an existing GameError intact', () => {
    const original = new GameError('NOT_HOST');
    expect(toGameError(original)).toBe(original);
  });

  it('reads a paused or unreachable project as a service problem', () => {
    // A paused free-tier project surfaces as a plain fetch failure with no body.
    expect(toGameError(new TypeError('Failed to fetch')).code).toBe('SERVICE_UNAVAILABLE');
    expect(toGameError({ message: 'TypeError: Load failed' }).code).toBe('SERVICE_UNAVAILABLE');
    expect(toGameError({ message: 'fetch failed' }).code).toBe('SERVICE_UNAVAILABLE');
  });

  it('reports being offline before blaming the server', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(toGameError(new TypeError('Failed to fetch')).code).toBe('OFFLINE');
  });

  it('falls back to UNKNOWN for anything unrecognizable', () => {
    expect(toGameError({ message: 'some database detail nobody planned for' }).code).toBe(
      'UNKNOWN',
    );
    expect(toGameError(null).code).toBe('UNKNOWN');
    expect(toGameError(42).code).toBe('UNKNOWN');
  });

  it('separates "the backend is unwell" from "you did something invalid"', () => {
    expect(isServiceProblem('SERVICE_UNAVAILABLE')).toBe(true);
    expect(isServiceProblem('NOT_CONFIGURED')).toBe(true);
    expect(isServiceProblem('OFFLINE')).toBe(true);
    expect(isServiceProblem('NAME_TAKEN')).toBe(false);
  });
});

describe('every error is translatable', () => {
  const englishErrors = (en as { errors: Record<string, string> }).errors;
  const spanishErrors = (es as { errors: Record<string, string> }).errors;

  it('has an English message for every error code', () => {
    const missing = ERROR_CODES.filter((code) => !englishErrors[code]);
    expect(missing).toEqual([]);
  });

  it('has a Spanish message for every error code', () => {
    const missing = ERROR_CODES.filter((code) => !spanishErrors[code]);
    expect(missing).toEqual([]);
  });

  it('builds the i18n lookup key', () => {
    expect(errorKey('NAME_TAKEN')).toBe('errors.NAME_TAKEN');
  });
});
