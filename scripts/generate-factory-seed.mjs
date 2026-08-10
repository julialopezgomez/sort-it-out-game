#!/usr/bin/env node
/**
 * Generates `supabase/migrations/0030_seed_factory_cards.sql` from
 * `supabase/seed/factory_cards.json`.
 *
 *   pnpm seed:factory
 *
 * The JSON file is the single source of truth for the factory dictionary. Card ids are
 * derived deterministically from the English text, so:
 *
 *   - adding a card is safe;
 *   - EDITING the English text of an existing card mints a NEW id. If you need to correct
 *     a typo, edit the generated SQL by hand or accept that the old id disappears from
 *     future seeds (existing games that already reference it keep working).
 *
 * The generated statement is idempotent: re-running the migration refreshes the
 * translations without touching anything else.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sourcePath = path.join(root, 'supabase/seed/factory_cards.json');
const outputPath = path.join(root, 'supabase/migrations/0030_seed_factory_cards.sql');

/** @param {string} value */
function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '');
}

/** @param {string} value */
function sqlString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

const cards = JSON.parse(readFileSync(sourcePath, 'utf8'));
if (!Array.isArray(cards) || cards.length < 250) {
  throw new Error(`Expected at least 250 factory cards, found ${cards?.length ?? 0}`);
}

const seen = new Map();
const rows = [];

for (const [index, card] of cards.entries()) {
  const en = String(card.en ?? '').trim();
  const es = String(card.es ?? '').trim();
  if (!en || !es) {
    throw new Error(`Factory card #${index + 1} is missing an English or Spanish value`);
  }
  let id = `f-${slugify(en)}`;
  if (seen.has(id)) {
    const next = seen.get(id) + 1;
    seen.set(id, next);
    id = `${id}-${next}`;
  } else {
    seen.set(id, 1);
  }
  rows.push(`  (${sqlString(id)}, ${sqlString(en)}, ${sqlString(es)})`);
}

const sql = `-- ============================================================================
-- Sort It Out — factory card dictionary seed (generated file, do not edit by hand)
--
-- Source:    supabase/seed/factory_cards.json
-- Regenerate: pnpm seed:factory
-- Cards:     ${rows.length}
--
-- Every factory card is original to this project and carries both an English and a
-- Spanish rendering of the same canonical concept.
-- ============================================================================

insert into public.factory_cards (id, text_en, text_es) values
${rows.join(',\n')}
on conflict (id) do update
  set text_en = excluded.text_en,
      text_es = excluded.text_es;
`;

writeFileSync(outputPath, sql, 'utf8');
console.log(`Wrote ${rows.length} factory cards to ${path.relative(root, outputPath)}`);
