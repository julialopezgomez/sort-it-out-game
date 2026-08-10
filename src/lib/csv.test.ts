import { describe, expect, it } from 'vitest';
import { exampleCsv, parseDictionaryCsv, serializeDictionaryCsv } from './csv';

describe('CSV import', () => {
  it('parses the documented format', () => {
    const result = parseDictionaryCsv(
      ['english,spanish', 'Going camping,Ir de camping', 'Board games,', ',La siesta'].join('\n'),
    );

    expect(result.headerSkipped).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { line: 2, en: 'Going camping', es: 'Ir de camping' },
      { line: 3, en: 'Board games', es: null },
      { line: 4, en: null, es: 'La siesta' },
    ]);
  });

  it('works without a header row', () => {
    const result = parseDictionaryCsv('Going camping,Ir de camping');
    expect(result.headerSkipped).toBe(false);
    expect(result.rows).toHaveLength(1);
  });

  it('accepts Spanish header names', () => {
    const result = parseDictionaryCsv('inglés,español\nBoard games,Juegos de mesa');
    expect(result.headerSkipped).toBe(true);
    expect(result.rows).toHaveLength(1);
  });

  it('handles a UTF-8 BOM, CRLF endings and accents', () => {
    const result = parseDictionaryCsv('﻿english,spanish\r\nCoffee,Café con leche\r\n');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{ line: 2, en: 'Coffee', es: 'Café con leche' }]);
  });

  it('handles quoted commas', () => {
    const result = parseDictionaryCsv('"Coffee, black","Café, solo"');
    expect(result.rows).toEqual([{ line: 1, en: 'Coffee, black', es: 'Café, solo' }]);
  });

  it('handles escaped quotation marks', () => {
    const result = parseDictionaryCsv('"He said ""hello""",Hola');
    expect(result.rows[0]?.en).toBe('He said "hello"');
  });

  it('handles a newline inside a quoted field', () => {
    const result = parseDictionaryCsv('"Two\nlines",Dos líneas\nNext,Siguiente');
    expect(result.rows[0]?.en).toBe('Two\nlines');
    expect(result.rows[1]?.en).toBe('Next');
    // The second record starts on source line 3 because the quoted field consumed line 2.
    expect(result.rows[1]?.line).toBe(3);
  });

  it('reports row-level errors without discarding the valid rows', () => {
    const result = parseDictionaryCsv(
      ['english,spanish', 'Good one,Buena', ',', 'Also good,También', 'a,b,c'].join('\n'),
    );

    expect(result.rows.map((r) => r.en)).toEqual(['Good one', 'Also good']);
    expect(result.errors).toEqual([
      { line: 3, code: 'BOTH_EMPTY', raw: ',' },
      { line: 5, code: 'TOO_MANY_COLUMNS', raw: 'a,b,c' },
    ]);
  });

  it('rejects a row where both values are empty', () => {
    const result = parseDictionaryCsv('english,spanish\n,\n');
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.code).toBe('BOTH_EMPTY');
  });

  it('rejects text that is too long for a card', () => {
    const result = parseDictionaryCsv(`${'x'.repeat(81)},corto`);
    expect(result.errors[0]?.code).toBe('TOO_LONG');
  });

  it('flags an unterminated quote instead of silently swallowing the file', () => {
    const result = parseDictionaryCsv('"never closed,Hola');
    expect(result.errors[0]?.code).toBe('UNCLOSED_QUOTE');
  });

  it('ignores blank lines and a trailing newline', () => {
    const result = parseDictionaryCsv('english,spanish\nA,B\n\n\nC,D\n');
    expect(result.rows.map((r) => r.en)).toEqual(['A', 'C']);
    expect(result.errors).toEqual([]);
  });

  it('tolerates a third column that is empty', () => {
    const result = parseDictionaryCsv('A,B,');
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toEqual({ line: 1, en: 'A', es: 'B' });
  });

  it('returns nothing for an empty file', () => {
    expect(parseDictionaryCsv('')).toEqual({ rows: [], errors: [], headerSkipped: false });
  });
});

describe('CSV export', () => {
  it('writes a UTF-8 BOM for spreadsheet compatibility', () => {
    const csv = serializeDictionaryCsv([{ en: 'Coffee', es: 'Café' }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('english,spanish');
    expect(csv).toContain('Coffee,Café');
  });

  it('can omit the BOM when asked', () => {
    expect(serializeDictionaryCsv([], { bom: false }).startsWith('﻿')).toBe(false);
  });

  it('quotes fields containing commas, quotes or newlines', () => {
    const csv = serializeDictionaryCsv(
      [
        { en: 'Coffee, black', es: null },
        { en: 'He said "hi"', es: null },
        { en: 'Two\nlines', es: null },
      ],
      { bom: false },
    );

    expect(csv).toContain('"Coffee, black",');
    expect(csv).toContain('"He said ""hi""",');
    expect(csv).toContain('"Two\nlines",');
  });

  it('leaves a missing language as an empty field', () => {
    const csv = serializeDictionaryCsv([{ en: null, es: 'La siesta' }], { bom: false });
    expect(csv).toContain(',La siesta');
  });

  it('round-trips through the parser without loss', () => {
    const original = [
      { en: 'Coffee, black', es: 'Café, solo' },
      { en: 'He said "hi"', es: null },
      { en: null, es: 'La siesta' },
      { en: 'Café con leche', es: 'Café con leche' },
    ];

    const parsed = parseDictionaryCsv(serializeDictionaryCsv(original));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map(({ en, es }) => ({ en, es }))).toEqual(original);
  });

  it('produces an example file that parses cleanly', () => {
    const parsed = parseDictionaryCsv(exampleCsv());
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.length).toBeGreaterThanOrEqual(4);
    // The example deliberately demonstrates every legal shape.
    expect(parsed.rows.some((r) => r.en !== null && r.es !== null)).toBe(true);
    expect(parsed.rows.some((r) => r.en !== null && r.es === null)).toBe(true);
    expect(parsed.rows.some((r) => r.en === null && r.es !== null)).toBe(true);
  });
});
