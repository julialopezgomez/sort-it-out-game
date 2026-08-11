-- ============================================================================
-- Sync production with the current factory card dictionary.
--
-- Existing cards are disabled rather than deleted because completed or in-progress
-- turns may still reference them. The canonical source remains
-- supabase/seed/factory_cards.json.
-- ============================================================================

update public.factory_cards
set is_enabled = false
where id in (
  'f-cilantro',
  'f-notifications',
  'f-bright-lights',
  'f-unread-emails'
);

insert into public.factory_cards (id, text_en, text_es, is_enabled) values
  ('f-pineapple-on-pizza', 'Pineapple on pizza', 'Pizza con piña', true),
  ('f-coriander', 'Coriander', 'Cilantro', true),
  ('f-listening-to-the-radio', 'Listening to the radio', 'Escuchar la radio', true),
  ('f-spotify-playlists', 'Spotify playlists', 'Listas de reproducción de Spotify', true)
on conflict (id) do update
  set text_en = excluded.text_en,
      text_es = excluded.text_es,
      is_enabled = true;
