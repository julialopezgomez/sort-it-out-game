# Factory cards

Do not edit `0030_seed_factory_cards.sql` or `0080_replace_factory_cards.sql`, and do not run
`pnpm seed:factory`. Those already ran against the live database and won't change it again. Use
a new migration file instead.

## Add new cards

1. Add each new card to `supabase/seed/factory_cards.json` as `{ "en": "...", "es": "..." }`.
2. Create a new migration, for example `supabase/migrations/0090_add_factory_cards.sql`:

   ```sql
   insert into public.factory_cards (id, text_en, text_es) values
     ('f-your-new-card', 'Your new card', 'Tu nueva carta')
   on conflict (id) do update
     set text_en = excluded.text_en,
         text_es = excluded.text_es,
         is_enabled = true;
   ```

   Set `id` to `f-` followed by the English text, lowercased, with spaces and punctuation
   replaced by hyphens. Keep both `text_en` and `text_es` between 1 and 80 characters.
3. Commit and push to `main`.

## Fix a translation

1. Find the card's id:

   ```sql
   select id, text_en, text_es from public.factory_cards where text_en ilike '%tofu%';
   ```

2. Create a new migration that updates it by id:

   ```sql
   update public.factory_cards set text_es = 'Agua mineral con gas' where id = 'f-sparkling-water';
   ```

   For several cards at once:

   ```sql
   update public.factory_cards as fc
   set text_en = v.text_en, text_es = v.text_es
   from (values
     ('f-sparkling-water', 'Sparkling water', 'Agua mineral con gas'),
     ('f-ballet', 'Classical ballet', 'Ballet clásico')
   ) as v(id, text_en, text_es)
   where fc.id = v.id;
   ```

3. Update the matching entry in `supabase/seed/factory_cards.json`.
4. Commit and push to `main`.

## Retire a card and add a replacement

```sql
update public.factory_cards set is_enabled = false where id = 'f-the-old-concept';

insert into public.factory_cards (id, text_en, text_es) values
  ('f-the-new-concept', 'The new concept', 'El concepto nuevo')
on conflict (id) do update
  set text_en = excluded.text_en, text_es = excluded.text_es, is_enabled = true;
```
