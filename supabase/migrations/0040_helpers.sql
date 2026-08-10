-- ============================================================================
-- Sort It Out — 0040_helpers.sql
-- Internal helper functions. All are SECURITY DEFINER with a pinned search_path and
-- are NOT granted to anon/authenticated: only the public RPCs in 0050-0070 call them.
-- ============================================================================

-- Uniform machine-readable failure. The client maps the code to a localized string,
-- which is why the message must stay a stable ASCII token.
create or replace function public._fail(p_code text)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  raise exception '%', p_code using errcode = 'P0001';
end;
$$;

-- How long a player may be silent before we treat them as disconnected.
create or replace function public._disconnect_seconds()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$ select 30; $$;

-- Seconds a reveal screen stays up before the game moves on by itself.
create or replace function public._reveal_seconds()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$ select 10; $$;

-- ---------------------------------------------------------------------------
-- Text normalization
-- ---------------------------------------------------------------------------

-- Display/storage form: trimmed, inner whitespace collapsed, NFKC normalized.
create or replace function public._clean_text(p_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(btrim(regexp_replace(normalize(coalesce(p_value, ''), NFKC), '\s+', ' ', 'g')), '');
$$;

-- Comparison form: cleaned + case folded. Used for both names and card de-duplication.
create or replace function public._fold_text(p_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(coalesce(public._clean_text(p_value), ''));
$$;

-- A custom card's identity is the pair of its two folded languages, so
-- ("Board games", null) and ("board  games", "") collapse to the same card.
create or replace function public._custom_card_key(p_en text, p_es text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select public._fold_text(p_en) || '|' || public._fold_text(p_es);
$$;

-- ---------------------------------------------------------------------------
-- Session credentials
-- ---------------------------------------------------------------------------

-- Only ever store the hash of the invisible browser credential.
create or replace function public._hash_token(p_token text)
returns text
language sql
immutable
set search_path = public, pg_temp, extensions
as $$
  select encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- Room codes
-- ---------------------------------------------------------------------------

-- Ambiguous glyphs (O, 0, I, 1) are excluded so codes can be read aloud or copied
-- from a photo without confusion.
create or replace function public._random_room_code()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  i integer;
begin
  for i in 1..6 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  end loop;
  return v_code;
end;
$$;

-- Room codes are case-insensitive for players; internally they are always uppercase.
create or replace function public._canonical_room_code(p_code text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window counters)
-- ---------------------------------------------------------------------------
create or replace function public._rate_limit(
  p_bucket text,
  p_subject text,
  p_max integer,
  p_window_seconds integer
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_subject is null or p_subject = '' then
    return;
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, v_window, 1)
  on conflict (bucket, subject, window_start)
    do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;

  if v_hits > p_max then
    perform public._fail('RATE_LIMITED');
  end if;

  -- Opportunistic housekeeping so the table cannot grow without bound.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < clock_timestamp() - interval '1 day';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime notifications
--
-- INVARIANT: a row here must never contain a room code, a display name, card text, a
-- ranking or a per-player score. Anyone holding the anon key can read this table, so it
-- deliberately carries nothing but a game id, an event name and counters — exactly enough
-- to tell a client "something changed, refetch through the RPC".
--
-- The room code in particular is excluded on purpose: it is the only thing standing
-- between a stranger and a family's game, so publishing it in a world-readable table
-- would hand out every live room.
-- ---------------------------------------------------------------------------
create or replace function public._emit(
  p_game_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.room_events (game_id, event_type, payload)
  values (p_game_id, p_event_type, coalesce(p_payload, '{}'::jsonb));

  if random() < 0.02 then
    delete from public.room_events where created_at < now() - interval '6 hours';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- State machine — the authoritative transition table.
-- Mirrored one-for-one by src/lib/stateMachine.ts (unit tested there).
-- ---------------------------------------------------------------------------
create or replace function public._can_transition(
  p_from public.game_phase,
  p_to public.game_phase
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select (p_from, p_to) in (
    ('lobby',             'preparing_cards'),
    ('lobby',             'cancelled'),
    ('preparing_cards',   'ranker_ordering'),
    ('preparing_cards',   'next_turn'),        -- ranker turn skipped
    ('preparing_cards',   'paused'),
    ('preparing_cards',   'cancelled'),
    ('ranker_ordering',   'guessers_ordering'),
    ('ranker_ordering',   'next_turn'),        -- ranker turn skipped
    ('ranker_ordering',   'paused'),
    ('ranker_ordering',   'cancelled'),
    ('guessers_ordering', 'reveal'),
    ('guessers_ordering', 'paused'),
    ('guessers_ordering', 'cancelled'),
    ('reveal',            'next_turn'),
    ('reveal',            'paused'),
    ('reveal',            'cancelled'),
    ('next_turn',         'preparing_cards'),
    ('next_turn',         'finished'),
    ('next_turn',         'paused'),
    ('next_turn',         'cancelled'),
    -- The Host may end a game in progress. Players still get their final results, so
    -- this lands on 'finished' rather than 'cancelled' from every in-play phase.
    ('preparing_cards',   'finished'),
    ('ranker_ordering',   'finished'),
    ('guessers_ordering', 'finished'),
    ('reveal',            'finished'),
    ('paused',            'finished'),
    ('paused',            'preparing_cards'),
    ('paused',            'ranker_ordering'),
    ('paused',            'guessers_ordering'),
    ('paused',            'reveal'),
    ('paused',            'next_turn'),
    ('paused',            'cancelled')
  );
$$;

create or replace function public._assert_transition(
  p_from public.game_phase,
  p_to public.game_phase
)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if not public._can_transition(p_from, p_to) then
    perform public._fail('ILLEGAL_TRANSITION');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Card pools
-- ---------------------------------------------------------------------------

-- The combined eligible pool for a game, expressed in canonical-id form.
create or replace function public._eligible_cards(
  p_game_id uuid,
  p_custom_only boolean default false
)
returns table (
  canonical_id text,
  source public.card_source,
  factory_card_id text,
  custom_card_id uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select 'c:' || cc.id::text, 'custom'::public.card_source, null::text, cc.id
  from public.game_custom_cards cc
  where cc.game_id = p_game_id
    and cc.is_enabled
  union all
  select 'f:' || fc.id, 'factory'::public.card_source, fc.id, null::uuid
  from public.factory_cards fc
  where fc.is_enabled
    and not p_custom_only;
$$;

create or replace function public._count_eligible_cards(
  p_game_id uuid,
  p_custom_only boolean default false
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from public._eligible_cards(p_game_id, p_custom_only);
$$;

-- Fill the given slots of a turn with distinct random cards, never colliding with the
-- cards already sitting in the turn's other slots. Authoritative: the client only ever
-- names a slot, never a card.
create or replace function public._fill_slots(
  p_game_id uuid,
  p_turn_id uuid,
  p_slots integer[],
  p_custom_only boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_needed integer := coalesce(array_length(p_slots, 1), 0);
  v_available integer;
begin
  if v_needed = 0 then
    return;
  end if;

  delete from public.turn_cards where turn_id = p_turn_id and slot = any(p_slots);

  select count(*) into v_available
  from public._eligible_cards(p_game_id, p_custom_only) c
  where not exists (
    select 1 from public.turn_cards tc
    where tc.turn_id = p_turn_id and tc.canonical_id = c.canonical_id
  );

  if v_available < v_needed then
    perform public._fail(case when p_custom_only then 'NOT_ENOUGH_CUSTOM_CARDS' else 'NOT_ENOUGH_CARDS' end);
  end if;

  insert into public.turn_cards (turn_id, slot, source, factory_card_id, custom_card_id, canonical_id)
  select p_turn_id, s.slot, p.source, p.factory_card_id, p.custom_card_id, p.canonical_id
  from (
    select slot, row_number() over (order by slot) as rn
    from unnest(p_slots) as slot
  ) s
  join (
    select c.*, row_number() over () as rn
    from (
      select c.*
      from public._eligible_cards(p_game_id, p_custom_only) c
      where not exists (
        select 1 from public.turn_cards tc
        where tc.turn_id = p_turn_id and tc.canonical_id = c.canonical_id
      )
      order by random()
      limit v_needed
    ) c
  ) p on p.rn = s.rn;
end;
$$;

-- ---------------------------------------------------------------------------
-- Eligibility
-- ---------------------------------------------------------------------------

-- Everyone who owes a guess on this turn: in the game, not the Ranker, and already
-- present when the turn began. Connection state deliberately does NOT matter — a
-- disconnected guesser still owes an answer and still scores zero if they miss it.
create or replace function public._eligible_guessers(p_turn_id uuid)
returns table (player_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.game_turns t
  join public.players p on p.game_id = t.game_id
  where t.id = p_turn_id
    and p.id <> t.ranker_player_id
    and p.left_at is null
    and p.eligible_from_turn < t.turn_number;
$$;

create or replace function public._is_connected(p_last_seen timestamptz)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select p_last_seen > now() - make_interval(secs => public._disconnect_seconds());
$$;

-- ---------------------------------------------------------------------------
-- Localized card rendering
--
-- Returns the text to show plus which language it actually came from, so the UI can
-- add a discreet "Shown in English" / "Mostrado en español" note when a custom card
-- has no version in the reader's language.
-- ---------------------------------------------------------------------------
create or replace function public._card_json(
  p_turn_card_id uuid,
  p_language public.ui_language
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'canonicalId', tc.canonical_id,
    'source', tc.source,
    'text', coalesce(preferred.value, fallback.value),
    'shownLanguage', case when preferred.value is not null then p_language::text else fallback.lang end,
    'requestedLanguage', p_language::text
  )
  from public.turn_cards tc
  left join public.factory_cards fc on fc.id = tc.factory_card_id
  left join public.game_custom_cards cc on cc.id = tc.custom_card_id
  cross join lateral (
    select case
      when p_language = 'en' then nullif(coalesce(fc.text_en, cc.text_en), '')
      else nullif(coalesce(fc.text_es, cc.text_es), '')
    end as value
  ) preferred
  cross join lateral (
    select
      case when p_language = 'en' then nullif(coalesce(fc.text_es, cc.text_es), '')
           else nullif(coalesce(fc.text_en, cc.text_en), '') end as value,
      case when p_language = 'en' then 'es' else 'en' end as lang
  ) fallback
  where tc.id = p_turn_card_id;
$$;

-- ---------------------------------------------------------------------------
-- Optional housekeeping. Safe to run from the SQL editor or a pg_cron job.
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_old_data(p_older_than interval default interval '30 days')
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.room_events where created_at < now() - interval '6 hours';
  delete from public.rate_limits where window_start < now() - interval '1 day';

  with gone as (
    delete from public.games
    where last_activity_at < now() - p_older_than
    returning 1
  )
  select count(*) into v_deleted from gone;

  return v_deleted;
end;
$$;
