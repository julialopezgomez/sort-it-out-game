-- ============================================================================
-- Sort It Out — 0050_rpc_lobby.sql
-- Room lifecycle: create, join, reconnect, heartbeat, settings, dictionary import,
-- and starting the game.
--
-- Every function here:
--   * takes the invisible browser credential (p_session_token) and only ever stores
--     its sha256 hash;
--   * locks public.games FOR UPDATE before mutating, which serializes all concurrent
--     writes for one room;
--   * validates room / player / phase / role before doing anything;
--   * raises a stable ASCII error code that the client localizes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Internal: begin the next Ranker turn, or finish the game.
--
-- The next Ranker is "the lowest rotation_position who has not been Ranker yet in the
-- current cycle". Expressing it as a query rather than modular arithmetic is what makes
-- late joiners work: they are appended with a high rotation_position, so they slot in at
-- the end of the cycle in progress (including the final cycle) and keep that fixed place
-- in every later cycle.
-- ---------------------------------------------------------------------------
create or replace function public._begin_next_turn(p_game_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
  v_cycle integer;
  v_ranker uuid;
  v_turn_id uuid;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then
    perform public._fail('ROOM_NOT_FOUND');
  end if;

  v_cycle := greatest(v_game.current_cycle, 1);

  select p.id into v_ranker
  from public.players p
  where p.game_id = p_game_id
    and p.left_at is null
    and not exists (
      select 1 from public.game_turns t
      where t.game_id = p_game_id
        and t.cycle_number = v_cycle
        and t.ranker_player_id = p.id
    )
  order by p.rotation_position
  limit 1;

  if v_ranker is null then
    -- Cycle complete.
    if v_game.current_cycle >= v_game.total_cycles then
      perform public._finish_game(p_game_id);
      return;
    end if;

    v_cycle := v_game.current_cycle + 1;

    select p.id into v_ranker
    from public.players p
    where p.game_id = p_game_id and p.left_at is null
    order by p.rotation_position
    limit 1;

    if v_ranker is null then
      perform public._finish_game(p_game_id);
      return;
    end if;
  end if;

  perform public._assert_transition(
    case when v_game.phase = 'next_turn' then 'next_turn'::public.game_phase else v_game.phase end,
    'preparing_cards'
  );

  insert into public.game_turns (game_id, turn_number, cycle_number, ranker_player_id, status)
  values (p_game_id, v_game.current_turn_number + 1, v_cycle, v_ranker, 'active')
  returning id into v_turn_id;

  -- Five distinct cards from the combined factory + custom pool.
  perform public._fill_slots(p_game_id, v_turn_id, array[1, 2, 3, 4, 5], false);

  update public.games
  set phase = 'preparing_cards',
      current_cycle = v_cycle,
      current_turn_number = v_game.current_turn_number + 1,
      current_turn_id = v_turn_id,
      phase_started_at = now(),
      phase_deadline_at = null,   -- card preparation is never timed
      paused_at = null,
      paused_from_phase = null,
      pause_reason_code = null,
      remaining_ms = null,
      last_activity_at = now()
  where id = p_game_id;

  perform public._emit(p_game_id, 'turn_started', jsonb_build_object(
    'phase', 'preparing_cards',
    'turnNumber', v_game.current_turn_number + 1,
    'cycleNumber', v_cycle
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- create_room
-- ---------------------------------------------------------------------------
create or replace function public.create_room(
  p_session_token text,
  p_display_name text,
  p_language text,
  p_settings jsonb default '{}'::jsonb,
  p_custom_cards jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_hash text;
  v_code text;
  v_game_id uuid;
  v_player_id uuid;
  v_cycles integer;
  v_ranker_seconds integer;
  v_guesser_seconds integer;
  v_allow_manual boolean;
  v_attempt integer := 0;
  v_imported jsonb;
begin
  v_hash := public._hash_token(p_session_token);
  if coalesce(p_session_token, '') = '' then
    perform public._fail('MISSING_SESSION');
  end if;

  perform public._rate_limit('create_room', v_hash, 8, 600);

  v_name := public._clean_text(p_display_name);
  if v_name is null or char_length(v_name) > 24 then
    perform public._fail('INVALID_NAME');
  end if;

  if coalesce(p_language, 'en') not in ('en', 'es') then
    perform public._fail('INVALID_LANGUAGE');
  end if;

  v_cycles          := coalesce((p_settings ->> 'totalCycles')::int, 2);
  v_ranker_seconds  := nullif(p_settings ->> 'rankerSeconds', '')::int;
  v_guesser_seconds := nullif(p_settings ->> 'guesserSeconds', '')::int;
  v_allow_manual    := coalesce((p_settings ->> 'allowManualCards')::boolean, true);

  if v_cycles < 1 or v_cycles > 10 then
    perform public._fail('INVALID_SETTINGS');
  end if;
  if (v_ranker_seconds is not null and (v_ranker_seconds < 5 or v_ranker_seconds > 3600))
     or (v_guesser_seconds is not null and (v_guesser_seconds < 5 or v_guesser_seconds > 3600)) then
    perform public._fail('INVALID_SETTINGS');
  end if;

  -- Find a free room code. Collisions are astronomically unlikely but cheap to retry.
  loop
    v_attempt := v_attempt + 1;
    v_code := public._random_room_code();
    exit when not exists (select 1 from public.games where room_code = v_code);
    if v_attempt > 25 then
      perform public._fail('ROOM_CODE_EXHAUSTED');
    end if;
  end loop;

  insert into public.games (
    room_code, phase, total_cycles, ranker_seconds, guesser_seconds, allow_manual_cards
  )
  values (v_code, 'lobby', v_cycles, v_ranker_seconds, v_guesser_seconds, v_allow_manual)
  returning id into v_game_id;

  insert into public.players (
    game_id, display_name, normalized_name, language, session_hash, is_host,
    rotation_position, eligible_from_turn
  )
  values (
    v_game_id, v_name, public._fold_text(v_name), coalesce(p_language, 'en')::public.ui_language,
    v_hash, true, 1, 0
  )
  returning id into v_player_id;

  update public.games
  set host_player_id = v_player_id, rotation_size = 1
  where id = v_game_id;

  if p_custom_cards is not null and jsonb_typeof(p_custom_cards) = 'array'
     and jsonb_array_length(p_custom_cards) > 0 then
    v_imported := public._insert_custom_cards(v_game_id, v_player_id, p_custom_cards);
  else
    v_imported := jsonb_build_object('inserted', 0, 'duplicates', 0, 'invalid', 0);
  end if;

  perform public._emit(v_game_id, 'room_created', jsonb_build_object('phase', 'lobby'));

  return jsonb_build_object(
    'roomCode', v_code,
    'gameId', v_game_id,
    'playerId', v_player_id,
    'import', v_imported
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: insert custom cards, normalizing and de-duplicating.
-- Accepts [{ "en": "...", "es": "..." }, ...].
-- ---------------------------------------------------------------------------
create or replace function public._insert_custom_cards(
  p_game_id uuid,
  p_player_id uuid,
  p_cards jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_en text;
  v_es text;
  v_key text;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_invalid integer := 0;
  v_id uuid;
begin
  if jsonb_typeof(p_cards) <> 'array' then
    perform public._fail('INVALID_PAYLOAD');
  end if;

  if jsonb_array_length(p_cards) > 2000 then
    perform public._fail('TOO_MANY_CARDS');
  end if;

  for v_row in select value from jsonb_array_elements(p_cards) loop
    v_en := public._clean_text(v_row ->> 'en');
    v_es := public._clean_text(v_row ->> 'es');

    if (v_en is null and v_es is null)
       or coalesce(char_length(v_en), 0) > 80
       or coalesce(char_length(v_es), 0) > 80 then
      v_invalid := v_invalid + 1;
      continue;
    end if;

    v_key := public._custom_card_key(v_en, v_es);

    insert into public.game_custom_cards (game_id, text_en, text_es, normalized_key, created_by_player)
    values (p_game_id, v_en, v_es, v_key, p_player_id)
    on conflict (game_id, normalized_key) do nothing
    returning id into v_id;

    if v_id is null then
      v_duplicates := v_duplicates + 1;
    else
      v_inserted := v_inserted + 1;
      v_id := null;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_duplicates, 'invalid', v_invalid);
end;
$$;

-- ---------------------------------------------------------------------------
-- join_room — also the reconnect and name-reclaim path.
--
-- Identity model (documented in docs/SECURITY.md): room code + exact display name is
-- enough to reclaim a *disconnected* identity. That is a deliberate family-game
-- tradeoff, chosen so a child with a flat battery can rejoin from a different phone
-- without anyone managing codes or passwords.
-- ---------------------------------------------------------------------------
create or replace function public.join_room(
  p_room_code text,
  p_session_token text,
  p_display_name text,
  p_language text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_game public.games;
  v_hash text;
  v_name text;
  v_folded text;
  v_existing public.players;
  v_player_id uuid;
  v_player_count integer;
  v_mode text;
  v_position integer;
begin
  if coalesce(p_session_token, '') = '' then
    perform public._fail('MISSING_SESSION');
  end if;

  v_code := public._canonical_room_code(p_room_code);
  if char_length(v_code) <> 6 then
    perform public._fail('INVALID_ROOM_CODE');
  end if;

  v_hash := public._hash_token(p_session_token);
  perform public._rate_limit('join_room', v_hash, 40, 600);

  v_name := public._clean_text(p_display_name);
  if v_name is null or char_length(v_name) > 24 then
    perform public._fail('INVALID_NAME');
  end if;

  if coalesce(p_language, 'en') not in ('en', 'es') then
    perform public._fail('INVALID_LANGUAGE');
  end if;

  select * into v_game from public.games where room_code = v_code for update;
  if not found then
    perform public._fail('ROOM_NOT_FOUND');
  end if;

  if v_game.phase in ('finished', 'cancelled') then
    perform public._fail('GAME_OVER');
  end if;

  v_folded := public._fold_text(v_name);

  select * into v_existing
  from public.players
  where game_id = v_game.id and normalized_name = v_folded;

  if found then
    if v_existing.session_hash = v_hash then
      v_mode := 'resumed';
    elsif public._is_connected(v_existing.last_seen_at) then
      perform public._fail('NAME_TAKEN');
    else
      v_mode := 'reclaimed';
    end if;

    update public.players
    set session_hash = v_hash,
        language = coalesce(p_language, 'en')::public.ui_language,
        display_name = v_name,
        last_seen_at = now(),
        left_at = null
    where id = v_existing.id;

    v_player_id := v_existing.id;
  else
    select count(*) into v_player_count from public.players where game_id = v_game.id;
    if v_player_count >= 30 then
      perform public._fail('ROOM_FULL');
    end if;

    v_position := v_game.rotation_size + 1;

    insert into public.players (
      game_id, display_name, normalized_name, language, session_hash, is_host,
      rotation_position, eligible_from_turn
    )
    values (
      v_game.id, v_name, v_folded, coalesce(p_language, 'en')::public.ui_language, v_hash,
      false, v_position,
      -- Late joiners never join a turn already in progress: they become Guessers from
      -- the next turn onward, and their average shows "—" until they play one.
      v_game.current_turn_number
    )
    returning id into v_player_id;

    update public.games
    set rotation_size = v_position, last_activity_at = now()
    where id = v_game.id;

    v_mode := 'joined';
  end if;

  perform public._emit(v_game.id, 'players_changed', jsonb_build_object(
    'phase', v_game.phase,
    'mode', v_mode
  ));

  return jsonb_build_object(
    'roomCode', v_code,
    'gameId', v_game.id,
    'playerId', v_player_id,
    'mode', v_mode
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- heartbeat — presence only. Deliberately does not lock the game row: 30 players
-- pinging every 10s must not serialize against each other.
-- ---------------------------------------------------------------------------
create or replace function public.heartbeat(
  p_room_code text,
  p_session_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_game public.games;
  v_player public.players;
  v_was_connected boolean;
begin
  v_code := public._canonical_room_code(p_room_code);
  perform public._rate_limit('heartbeat', public._hash_token(p_session_token), 60, 60);

  select * into v_game from public.games where room_code = v_code;
  if not found then
    perform public._fail('ROOM_NOT_FOUND');
  end if;

  select * into v_player
  from public.players
  where game_id = v_game.id and session_hash = public._hash_token(p_session_token);
  if not found then
    perform public._fail('NOT_IN_ROOM');
  end if;

  v_was_connected := public._is_connected(v_player.last_seen_at);

  update public.players set last_seen_at = now() where id = v_player.id;

  -- Only announce the edges, otherwise 30 players would flood Realtime.
  if not v_was_connected then
    perform public._emit(v_game.id, 'presence_changed', jsonb_build_object(
      'phase', v_game.phase
    ));
  end if;

  return jsonb_build_object(
    'serverNow', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MSOF'),
    'phase', v_game.phase,
    'turnNumber', v_game.current_turn_number
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- set_player_language — each player's UI language is theirs alone.
-- ---------------------------------------------------------------------------
create or replace function public.set_player_language(
  p_room_code text,
  p_session_token text,
  p_language text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
  v_player public.players;
begin
  if coalesce(p_language, '') not in ('en', 'es') then
    perform public._fail('INVALID_LANGUAGE');
  end if;

  select * into v_game from public.games where room_code = public._canonical_room_code(p_room_code);
  if not found then
    perform public._fail('ROOM_NOT_FOUND');
  end if;

  select * into v_player from public.players
  where game_id = v_game.id and session_hash = public._hash_token(p_session_token);
  if not found then
    perform public._fail('NOT_IN_ROOM');
  end if;

  update public.players
  set language = p_language::public.ui_language, last_seen_at = now()
  where id = v_player.id;

  return jsonb_build_object('language', p_language);
end;
$$;

-- ---------------------------------------------------------------------------
-- update_settings — host only, lobby only.
-- ---------------------------------------------------------------------------
create or replace function public.update_settings(
  p_room_code text,
  p_session_token text,
  p_settings jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
  v_player public.players;
  v_cycles integer;
  v_ranker integer;
  v_guesser integer;
  v_manual boolean;
begin
  select * into v_game from public.games
  where room_code = public._canonical_room_code(p_room_code) for update;
  if not found then
    perform public._fail('ROOM_NOT_FOUND');
  end if;

  select * into v_player from public.players
  where game_id = v_game.id and session_hash = public._hash_token(p_session_token);
  if not found then
    perform public._fail('NOT_IN_ROOM');
  end if;
  if not v_player.is_host then
    perform public._fail('NOT_HOST');
  end if;
  if v_game.phase <> 'lobby' then
    perform public._fail('WRONG_PHASE');
  end if;

  v_cycles  := coalesce((p_settings ->> 'totalCycles')::int, v_game.total_cycles);
  v_ranker  := case when p_settings ? 'rankerSeconds'
                    then nullif(p_settings ->> 'rankerSeconds', '')::int
                    else v_game.ranker_seconds end;
  v_guesser := case when p_settings ? 'guesserSeconds'
                    then nullif(p_settings ->> 'guesserSeconds', '')::int
                    else v_game.guesser_seconds end;
  v_manual  := coalesce((p_settings ->> 'allowManualCards')::boolean, v_game.allow_manual_cards);

  if v_cycles < 1 or v_cycles > 10 then
    perform public._fail('INVALID_SETTINGS');
  end if;
  if (v_ranker is not null and (v_ranker < 5 or v_ranker > 3600))
     or (v_guesser is not null and (v_guesser < 5 or v_guesser > 3600)) then
    perform public._fail('INVALID_SETTINGS');
  end if;

  update public.games
  set total_cycles = v_cycles,
      ranker_seconds = v_ranker,
      guesser_seconds = v_guesser,
      allow_manual_cards = v_manual,
      last_activity_at = now()
  where id = v_game.id;

  perform public._emit(v_game.id, 'settings_changed', jsonb_build_object(
    'phase', 'lobby'
  ));

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- import_custom_cards — host only, lobby only.
-- ---------------------------------------------------------------------------
create or replace function public.import_custom_cards(
  p_room_code text,
  p_session_token text,
  p_cards jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
  v_player public.players;
  v_result jsonb;
begin
  select * into v_game from public.games
  where room_code = public._canonical_room_code(p_room_code) for update;
  if not found then
    perform public._fail('ROOM_NOT_FOUND');
  end if;

  select * into v_player from public.players
  where game_id = v_game.id and session_hash = public._hash_token(p_session_token);
  if not found then
    perform public._fail('NOT_IN_ROOM');
  end if;
  if not v_player.is_host then
    perform public._fail('NOT_HOST');
  end if;
  if v_game.phase <> 'lobby' then
    perform public._fail('WRONG_PHASE');
  end if;

  perform public._rate_limit('import_cards', v_game.id::text, 20, 600);

  v_result := public._insert_custom_cards(v_game.id, v_player.id, p_cards);

  perform public._emit(v_game.id, 'dictionary_changed', jsonb_build_object(
    'phase', v_game.phase
  ));

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- start_game — host only. Randomizes the rotation, which is what makes the first
-- Ranker random *on the server* rather than in a browser.
-- ---------------------------------------------------------------------------
create or replace function public.start_game(
  p_room_code text,
  p_session_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
  v_player public.players;
  v_count integer;
begin
  select * into v_game from public.games
  where room_code = public._canonical_room_code(p_room_code) for update;
  if not found then
    perform public._fail('ROOM_NOT_FOUND');
  end if;

  select * into v_player from public.players
  where game_id = v_game.id and session_hash = public._hash_token(p_session_token);
  if not found then
    perform public._fail('NOT_IN_ROOM');
  end if;
  if not v_player.is_host then
    perform public._fail('NOT_HOST');
  end if;
  if v_game.phase <> 'lobby' then
    perform public._fail('WRONG_PHASE');
  end if;

  select count(*) into v_count from public.players where game_id = v_game.id and left_at is null;
  if v_count < 2 then
    perform public._fail('NEED_TWO_PLAYERS');
  end if;

  if public._count_eligible_cards(v_game.id, false) < 5 then
    perform public._fail('NOT_ENOUGH_CARDS');
  end if;

  -- Shuffle the rotation in two steps so the (game_id, rotation_position) unique index
  -- is never transiently violated: park everything in negative space, then reassign.
  update public.players
  set rotation_position = -rotation_position - 1
  where game_id = v_game.id;

  update public.players p
  set rotation_position = shuffled.rn
  from (
    select id, row_number() over (order by random()) as rn
    from public.players
    where game_id = v_game.id
  ) shuffled
  where p.id = shuffled.id;

  update public.games
  set rotation_size = v_count,
      current_cycle = 1,
      started_at = now(),
      phase = 'lobby',            -- _begin_next_turn performs the real transition
      last_activity_at = now()
  where id = v_game.id;

  perform public._begin_next_turn(v_game.id);

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: only the public entry points.
-- ---------------------------------------------------------------------------
grant execute on function public.create_room(text, text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.join_room(text, text, text, text) to anon, authenticated;
grant execute on function public.heartbeat(text, text) to anon, authenticated;
grant execute on function public.set_player_language(text, text, text) to anon, authenticated;
grant execute on function public.update_settings(text, text, jsonb) to anon, authenticated;
grant execute on function public.import_custom_cards(text, text, jsonb) to anon, authenticated;
grant execute on function public.start_game(text, text) to anon, authenticated;
