/**
 * CSV import and export for the custom dictionary.
 *
 * Format: exactly two logical columns, `english` and `spanish`. Either value may be
 * empty, but not both.
 *
 *   english,spanish
 *   Going camping,Ir de camping
 *   Board games,
 *   ,La siesta
 *
 * The parser is written by hand rather than pulled from a dependency because it has to
 * behave predictably on the things a real spreadsheet produces: a UTF-8 BOM, CRLF line
 * endings, quoted fields containing commas, escaped double quotes, and newlines inside
 * quotes. Nothing here touches the network — an imported file goes only into the game's
 * own Supabase rows.
 */

export type CsvRowError = {
  line: number;
  code: 'BOTH_EMPTY' | 'TOO_MANY_COLUMNS' | 'TOO_LONG' | 'UNCLOSED_QUOTE';
  raw: string;
};

export type CsvParseResult = {
  rows: { line: number; en: string | null; es: string | null }[];
  errors: CsvRowError[];
  /** True when the first line looked like a header and was skipped. */
  headerSkipped: boolean;
};

const MAX_FIELD_LENGTH = 80;

/**
 * Split CSV text into rows of fields, honouring quotes. Returns the 1-based source line
 * each record started on so errors can point at the right row even when a quoted field
 * spanned several lines.
 */
function splitRecords(
  input: string,
): { line: number; fields: string[]; raw: string; unclosed: boolean }[] {
  // Strip a UTF-8 BOM if a spreadsheet added one.
  const text = input.replace(/^\uFEFF/, '');
  const records: { line: number; fields: string[]; raw: string; unclosed: boolean }[] = [];

  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;
  let raw = '';
  let sawContent = false;

  const pushField = () => {
    fields.push(field);
    field = '';
  };

  const pushRecord = (unclosed = false) => {
    pushField();
    // Skip records that are entirely empty (trailing newline, blank separator lines).
    const isBlank = fields.length === 1 && fields[0]?.trim() === '';
    if (!isBlank || sawContent === false) {
      if (!isBlank) records.push({ line: recordStartLine, fields, raw: raw.trim(), unclosed });
    }
    fields = [];
    raw = '';
    recordStartLine = line;
    sawContent = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          field += '"';
          raw += '""';
          i += 1;
          continue;
        }
        inQuotes = false;
        raw += char;
        continue;
      }
      if (char === '\n') line += 1;
      field += char;
      raw += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      raw += char;
      sawContent = true;
      continue;
    }

    if (char === ',') {
      pushField();
      raw += char;
      sawContent = true;
      continue;
    }

    if (char === '\r') {
      // normalize CRLF and lone CR
      continue;
    }

    if (char === '\n') {
      line += 1;
      pushRecord();
      recordStartLine = line;
      continue;
    }

    field += char;
    raw += char;
    if (char.trim() !== '') sawContent = true;
  }

  if (field !== '' || fields.length > 0 || inQuotes) {
    pushRecord(inQuotes);
  }

  return records;
}

function looksLikeHeader(fields: readonly string[]): boolean {
  const first = fields[0]?.trim().toLowerCase() ?? '';
  const second = fields[1]?.trim().toLowerCase() ?? '';
  const englishHeaders = ['english', 'en', 'ingles', 'inglés'];
  const spanishHeaders = ['spanish', 'es', 'espanol', 'español'];
  return englishHeaders.includes(first) && spanishHeaders.includes(second);
}

export function parseDictionaryCsv(input: string): CsvParseResult {
  const records = splitRecords(input);
  const rows: CsvParseResult['rows'] = [];
  const errors: CsvRowError[] = [];
  let headerSkipped = false;

  records.forEach((record, index) => {
    if (index === 0 && looksLikeHeader(record.fields)) {
      headerSkipped = true;
      return;
    }

    if (record.unclosed) {
      errors.push({ line: record.line, code: 'UNCLOSED_QUOTE', raw: record.raw });
      return;
    }

    // A third column is a genuine mistake (usually a stray comma), not something to guess at.
    const extras = record.fields.slice(2).filter((value) => value.trim() !== '');
    if (extras.length > 0) {
      errors.push({ line: record.line, code: 'TOO_MANY_COLUMNS', raw: record.raw });
      return;
    }

    const en = (record.fields[0] ?? '').trim();
    const es = (record.fields[1] ?? '').trim();

    if (en === '' && es === '') {
      errors.push({ line: record.line, code: 'BOTH_EMPTY', raw: record.raw });
      return;
    }

    if (en.length > MAX_FIELD_LENGTH || es.length > MAX_FIELD_LENGTH) {
      errors.push({ line: record.line, code: 'TOO_LONG', raw: record.raw });
      return;
    }

    rows.push({ line: record.line, en: en === '' ? null : en, es: es === '' ? null : es });
  });

  return { rows, errors, headerSkipped };
}

function quoteField(value: string | null): string {
  const text = value ?? '';
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Serialize the dictionary. The leading BOM is what makes Excel open accented Spanish
 * correctly instead of showing mojibake.
 */
export function serializeDictionaryCsv(
  cards: readonly { en: string | null; es: string | null }[],
  options: { bom?: boolean } = {},
): string {
  const withBom = options.bom ?? true;
  const lines = ['english,spanish'];
  for (const card of cards) {
    lines.push(`${quoteField(card.en)},${quoteField(card.es)}`);
  }
  return `${withBom ? '﻿' : ''}${lines.join('\r\n')}\r\n`;
}

/** Offered as a "Download example CSV" button on the import screen. */
export const EXAMPLE_CSV_ROWS: readonly { en: string | null; es: string | null }[] = [
  { en: 'Going camping', es: 'Ir de camping' },
  { en: 'Rainy afternoons', es: 'Tardes lluviosas' },
  { en: 'Board games', es: null },
  { en: null, es: 'La siesta' },
  { en: 'Coffee, black, no sugar', es: 'Café solo, sin azúcar' },
];

export function exampleCsv(): string {
  return serializeDictionaryCsv(EXAMPLE_CSV_ROWS);
}
