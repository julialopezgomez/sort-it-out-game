/**
 * Text normalization.
 *
 * Deliberately kept identical to `_clean_text`, `_fold_text` and `_custom_card_key` in
 * supabase/migrations/0040_helpers.sql, so the client's "that name is taken" and "that
 * card already exists" checks agree with the database's. The database still has the last
 * word — these functions only exist to give instant feedback.
 *
 * Player names and card text are never rewritten beyond this: accents, capitalisation and
 * punctuation are the player's own and are stored exactly as typed (after trimming).
 */

/** Trim, collapse inner whitespace, NFKC-normalize. Empty becomes null. */
export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned;
}

/** The comparison form: cleaned and case-folded. Used for names and card identity. */
export function foldText(value: string | null | undefined): string {
  return (cleanText(value) ?? '').toLowerCase();
}

/**
 * A custom card's identity is the pair of its folded languages, so a bilingual card is
 * one card rather than two, and ("Board games", "") collides with ("board  games", null).
 */
export function customCardKey(
  en: string | null | undefined,
  es: string | null | undefined,
): string {
  return `${foldText(en)}|${foldText(es)}`;
}

export type CustomCardInput = {
  en: string | null;
  es: string | null;
  /** Optional source line, for reporting CSV import errors. */
  line?: number;
};

export type CustomCardDraft = {
  en: string | null;
  es: string | null;
  key: string;
  line?: number;
};

export type DedupeResult = {
  cards: CustomCardDraft[];
  /** Rows dropped because an identical card was already present. */
  duplicates: CustomCardInput[];
  /** Rows dropped because they had no usable text, or text that was too long. */
  invalid: { row: CustomCardInput; reason: 'empty' | 'too_long' }[];
};

export const CARD_TEXT_MAX = 80;

/**
 * Normalize a batch of candidate custom cards and drop exact duplicates, keeping the
 * first occurrence. Invalid rows are reported rather than silently discarded so the CSV
 * import screen can show row-level errors while still committing the good rows.
 */
export function normalizeCustomCards(
  rows: readonly CustomCardInput[],
  existingKeys: readonly string[] = [],
): DedupeResult {
  const seen = new Set(existingKeys);
  const cards: CustomCardDraft[] = [];
  const duplicates: CustomCardInput[] = [];
  const invalid: DedupeResult['invalid'] = [];

  for (const row of rows) {
    const en = cleanText(row.en);
    const es = cleanText(row.es);

    if (en === null && es === null) {
      invalid.push({ row, reason: 'empty' });
      continue;
    }
    if ((en?.length ?? 0) > CARD_TEXT_MAX || (es?.length ?? 0) > CARD_TEXT_MAX) {
      invalid.push({ row, reason: 'too_long' });
      continue;
    }

    const key = customCardKey(en, es);
    if (seen.has(key)) {
      duplicates.push(row);
      continue;
    }

    seen.add(key);
    cards.push(row.line === undefined ? { en, es, key } : { en, es, key, line: row.line });
  }

  return { cards, duplicates, invalid };
}

/** Client-side mirror of the room's unique-name rule. */
export function isNameTaken(
  candidate: string,
  existingNames: readonly string[],
  options: { ignore?: string } = {},
): boolean {
  const folded = foldText(candidate);
  if (folded === '') return false;
  const ignore = options.ignore === undefined ? null : foldText(options.ignore);
  return existingNames.some((name) => {
    const other = foldText(name);
    if (ignore !== null && other === ignore) return false;
    return other === folded;
  });
}
