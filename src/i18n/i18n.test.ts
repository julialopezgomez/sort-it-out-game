import { describe, expect, it } from 'vitest';
import en from './en.json';
import es from './es.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out[path] = value;
    } else {
      Object.assign(out, flatten(value, path));
    }
  }
  return out;
}

const english = flatten(en as Tree);
const spanish = flatten(es as Tree);

describe('every interface string exists in both languages', () => {
  it('has no English key missing from Spanish', () => {
    const missing = Object.keys(english).filter((key) => !(key in spanish));
    expect(missing).toEqual([]);
  });

  it('has no Spanish key missing from English', () => {
    const extra = Object.keys(spanish).filter((key) => !(key in english));
    expect(extra).toEqual([]);
  });

  it('has a non-empty value for every key in both languages', () => {
    const blankEnglish = Object.entries(english).filter(([, value]) => value.trim() === '');
    const blankSpanish = Object.entries(spanish).filter(([, value]) => value.trim() === '');
    expect(blankEnglish).toEqual([]);
    expect(blankSpanish).toEqual([]);
  });

  it('uses the same interpolation placeholders in both languages', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

    const mismatches: string[] = [];
    for (const [key, value] of Object.entries(english)) {
      const other = spanish[key];
      if (other === undefined) continue;
      const a = placeholders(value);
      const b = placeholders(other);
      if (a.join(',') !== b.join(',')) {
        mismatches.push(`${key}: en=[${a.join(',')}] es=[${b.join(',')}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('provides a plural form wherever a count is interpolated', () => {
    const countKeys = Object.entries(english)
      .filter(([key, value]) => value.includes('{{count}}') && key.endsWith('_one'))
      .map(([key]) => key);

    const missingPlural = countKeys.filter(
      (key) => !(`${key.slice(0, -'_one'.length)}_other` in english),
    );
    expect(missingPlural).toEqual([]);

    const missingSpanishPlural = countKeys.filter(
      (key) => !(`${key.slice(0, -'_one'.length)}_other` in spanish),
    );
    expect(missingSpanishPlural).toEqual([]);
  });
});

describe('coverage of the required string categories', () => {
  // Buttons, instructions, validation, status, timers, accessibility text, table
  // headers, scoring explanations, CSV messages and errors must all be translated.
  const requiredSections = [
    'common',
    'landing',
    'create',
    'join',
    'lobby',
    'player',
    'game',
    'prepare',
    'order',
    'waiting',
    'pause',
    'reveal',
    'coop',
    'leaderboard',
    'final',
    'csv',
    'history',
    'settings',
    'status',
    'a11y',
    'errors',
    'rules',
    'pwa',
  ];

  it.each(requiredSections)('has the %s section in both languages', (section) => {
    expect(Object.keys(english).some((key) => key.startsWith(`${section}.`))).toBe(true);
    expect(Object.keys(spanish).some((key) => key.startsWith(`${section}.`))).toBe(true);
  });

  it('translates the accessibility strings, not just the visible ones', () => {
    const a11yKeys = Object.keys(english).filter((key) => key.startsWith('a11y.'));
    expect(a11yKeys.length).toBeGreaterThanOrEqual(10);
    for (const key of a11yKeys) {
      expect(spanish[key], key).toBeTruthy();
      // A Spanish string identical to the English one is usually an untranslated stub.
      // The brand name and a few technical labels are legitimate exceptions.
      if (!['a11y.hostBadge'].includes(key)) {
        expect(spanish[key]).not.toBe(english[key]);
      }
    }
  });
});
