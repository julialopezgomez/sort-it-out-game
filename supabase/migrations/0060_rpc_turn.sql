-- ============================================================================
-- Sort It Out — 0060_rpc_turn.sql
-- Card preparation, private ordering, submission, scoring, pausing, skipping,
-- deadline expiry and finishing.
--
-- GitHub Pages cannot run a background worker, so there is no scheduler. Instead
-- `advance_game_if_needed` is idempotent and safe to call from any client at any time:
-- it takes the game row lock, decides for itself whether a deadline has elapsed, and
-- performs each transition exactly once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Internal: current turn of a game
-- ---------------------------------------------------------------------------
create or replace function public._current_turn(p_game_id uuid)
returns public.game_turns
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_turn public.game_turns;
begin
  select t.* into v_turn
  from public.game_turns t
  join public.games g on g.current_turn_id = t.id
  where g.id = p_game_id;

  if not found then
    perform public._fail('NO_ACTIVE_TURN');
  end if;

  return v_turn;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: compute the deadline for a timed phase
-- ---------------------------------------------------------------------------
create or replace function public._deadline(p_seconds integer)
returns timestamptz
language sql
volatile
set search_path = public, pg_temp
as $$
  select case when p_seconds is null then null else now() + make_interval(secs => p_seconds) end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: replace a ranking's items with the given canonical order.
-- Validates against the turn's actual cards, so a modified client cannot inject a
-- duplicate, a foreign card or a card that does not exist.
-- ---------------------------------------------------------------------------
create or replace function public._write_ranking_items(
  p_ranking_id uuid,
  p_turn_id uuid,
  p_order text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_matched integer;
begin
  if p_order is null or array_length(p_order, 1) <> 5 then
    perform public._fail('INVALID_ORDER');
  end if;

  -- distinct?
  if (select count(distinct x) from unnest(p_order) as x) <> 5 then
    perform public._fail('INVALID_ORDER');
  end if;

  -- every canonical id must belong to this turn
  select count(*) into v_matched
  from unnest(p_order) as x
  join public.turn_cards tc on tc.turn_id = p_turn_id and tc.canonical_id = x;

  if v_matched <> 5 then
    perform public._fail('INVALID_ORDER');
  end if;

  -- Delete-then-insert: a positional UPDATE would transiently violate the
  -- (ranking_id, position) unique index.
  delete from public.ranking_items where ranking_id = p_ranking_id;

  insert into public.ranking_items (ranking_id, turn_card_id, position)
  select p_ranking_id, tc.id, ord.position
  from unnest(p_order) with ordinality as ord(canonical_id, position)
  join public.turn_cards tc on tc.turn_id = p_turn_id and tc.canonical_id = ord.canonical_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: seed a ranking with the current slot order (a valid starting order)
-- ---------------------------------------------------------------------------
create or replace function public._seed_ranking(p_ranking_id uuid, p_turn_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.ranking_items where ranking_id = p_ranking_id) then
    return;
  end if;

  insert into public.ranking_items (ranking_id, turn_card_id, position)
  select p_ranking_id, tc.id, tc.slot
  from public.turn_cards tc
  where tc.turn_id = p_turn_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- CARD PREPARATION (Ranker only, phase = preparing_cards)
-- ---------------------------------------------------------------------------
create or replace function public._require_ranker_preparing(
  p_room_code text,
  p_session_token text,
  out o_game public.games,
  out o_player public.players,
  out o_turn public.game_turns
)
returns record
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  select * into o_game from public.games
  where room_code = public._canonical_room_code(p_room_code) for update;
  if not found then
    perform public._fail('ROOM_NOT_FOUND');
  end if;

  select * into o_player from public.players
  where game_id = o_game.id and session_hash = public._hash_token(p_session_token);
  if not found then
    perform public._fail('NOT_IN_ROOM');
  end if;

  if o_game.phase <> 'preparing_cards' then
    perform public._fail('WRONG_PHASE');
  end if;

  o_turn := public._current_turn(o_game.id);

  if o_turn.ranker_player_id <> o_player.id then
    perform public._fail('NOT_RANKER');
  end if;

  update public.players set last_seen_at = now() where id = o_player.id;
end;
$$;

create or replace function public.replace_card_random(
  p_room_code text,
  p_session_token text,
  p_slot integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx record;
begin
  if p_slot is null or p_slot < 1 or p_slot > 5 then
    perform public._fail('INVALID_SLOT');
  end if;

  select * into v_ctx from public._require_ranker_preparing(p_room_code, p_session_token);
  perform public._rate_limit('redraw', (v_ctx.o_game).id::text, 400, 60);

  perform public._fill_slots((v_ctx.o_game).id, (v_ctx.o_turn).id, array[p_slot], false);

  perform public._emit((v_ctx.o_game).id, 'cards_changed',
    jsonb_build_object('phase', 'preparing_cards'));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.choose_custom_card(
  p_room_code text,
  p_session_token text,
  p_slot integer,
  p_custom_card_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx record;
  v_canonical text;
begin
  if p_slot is null or p_slot < 1 or p_slot > 5 then
    perform public._fail('INVALID_SLOT');
  end if;

  select * into v_ctx from public._require_ranker_preparing(p_room_code, p_session_token);
  perform public._rate_limit('redraw', (v_ctx.o_game).id::text, 400, 60);

  if not exists (
    select 1 from public.game_custom_cards
    where id = p_custom_card_id and game_id = (v_ctx.o_game).id and is_enabled
  ) then
    perform public._fail('CARD_NOT_FOUND');
  end if;

  v_canonical := 'c:' || p_custom_card_id::text;

  if exists (
    select 1 from public.turn_cards
    where turn_id = (v_ctx.o_turn).id and canonical_id = v_canonical and slot <> p_slot
  ) then
    perform public._fail('CARD_ALREADY_IN_USE');
  end if;

  delete from public.turn_cards where turn_id = (v_ctx.o_turn).id and slot = p_slot;

  insert into public.turn_cards (turn_id, slot, source, custom_card_id, canonical_id)
  values ((v_ctx.o_turn).id, p_slot, 'custom', p_custom_card_id, v_canonical);

  perform public._emit((v_ctx.o_game).id, 'cards_changed',
    jsonb_build_object('phase', 'preparing_cards'));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.create_manual_card(
  p_room_code text,
  p_session_token text,
  p_slot integer,
  p_text_en text,
  p_text_es text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx record;
  v_en text;
  v_es text;
  v_key text;
  v_card_id uuid;
  v_canonical text;
  v_created boolean := false;
begin
  if p_slot is null or p_slot < 1 or p_slot > 5 then
    perform public._fail('INVALID_SLOT');
  end if;

  select * into v_ctx from public._require_ranker_preparing(p_room_code, p_session_token);

  if not (v_ctx.o_game).allow_manual_cards then
    perform public._fail('MANUAL_CARDS_DISABLED');
  end if;

  perform public._rate_limit('manual_card', (v_ctx.o_game).id::text, 200, 600);

  v_en := public._clean_text(p_text_en);
  v_es := public._clean_text(p_text_es);

  if v_en is null and v_es is null then
    perform public._fail('CARD_NEEDS_TEXT');
  end if;
  if coalesce(char_length(v_en), 0) > 80 or coalesce(char_length(v_es), 0) > 80 then
    perform public._fail('CARD_TOO_LONG');
  end if;

  v_key := public._custom_card_key(v_en, v_es);

  insert into public.game_custom_cards (game_id, text_en, text_es, normalized_key, created_by_player)
  values ((v_ctx.o_game).id, v_en, v_es, v_key, (v_ctx.o_player).id)
  on conflict (game_id, normalized_key) do nothing
  returning id into v_card_id;

  if v_card_id is null then
    -- A normalized duplicate already exists: reuse it rather than creating a twin.
    select id into v_card_id from public.game_custom_cards
    where game_id = (v_ctx.o_game).id and normalized_key = v_key;
  else
    v_created := true;
  end if;

  v_canonical := 'c:' || v_card_id::text;

  if exists (
    select 1 from public.turn_cards
    where turn_id = (v_ctx.o_turn).id and canonical_id = v_canonical and slot <> p_slot
  ) then
    perform public._fail('CARD_ALREADY_IN_USE');
  end if;

  delete from public.turn_cards where turn_id = (v_ctx.o_turn).id and slot = p_slot;

  insert into public.turn_cards (turn_id, slot, source, custom_card_id, canonical_id)
  values ((v_ctx.o_turn).id, p_slot, 'custom', v_card_id, v_canonical);

  perform public._emit((v_ctx.o_game).id, 'dictionary_changed',
    jsonb_build_object('phase', 'preparing_cards'));

  return jsonb_build_object('ok', true, 'created', v_created, 'cardId', v_card_id);
end;
$$;

create or replace function public.redraw_all_cards(
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
  v_ctx record;
begin
  select * into v_ctx from public._require_ranker_preparing(p_room_code, p_session_token);
  perform public._rate_limit('redraw', (v_ctx.o_game).id::text, 400, 60);

  delete from public.turn_cards where turn_id = (v_ctx.o_turn).id;
  perform public._fill_slots((v_ctx.o_game).id, (v_ctx.o_turn).id, array[1, 2, 3, 4, 5], false);

  perform public._emit((v_ctx.o_game).id, 'cards_changed',
    jsonb_build_object('phase', 'preparing_cards'));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.redraw_custom_cards(
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
  v_ctx record;
begin
  select * into v_ctx from public._require_ranker_preparing(p_room_code, p_session_token);
  perform public._rate_limit('redraw', (v_ctx.o_game).id::text, 400, 60);

  -- Deliberately "more than five", not "at least five": drawing 5 out of exactly 5 is
  -- not a redraw, it is a shuffle, and the UI promises a real choice.
  if public._count_eligible_cards((v_ctx.o_game).id, true) <= 5 then
    perform public._fail('NOT_ENOUGH_CUSTOM_CARDS');
  end if;

  delete from public.turn_cards where turn_id = (v_ctx.o_turn).id;
  perform public._fill_slots((v_ctx.o_game).id, (v_ctx.o_turn).id, array[1, 2, 3, 4, 5], true);

  perform public._emit((v_ctx.o_game).id, 'cards_changed',
    jsonb_build_object('phase', 'preparing_cards'));

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- accept_cards — locks the five cards and starts the Ranker's private ordering
-- (and only now does the Ranker timer begin).
-- ---------------------------------------------------------------------------
create or replace function public.accept_cards(
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
  v_ctx record;
  v_game public.games;
  v_turn public.game_turns;
  v_count integer;
  v_ranking_id uuid;
begin
  select * into v_ctx from public._require_ranker_preparing(p_room_code, p_session_token);
  v_game := v_ctx.o_game;
  v_turn := v_ctx.o_turn;

  select count(*) into v_count from public.turn_cards where turn_id = v_turn.id;
  if v_count <> 5 then
    perform public._fail('CARDS_INCOMPLETE');
  end if;

  perform public._assert_transition(v_game.phase, 'ranker_ordering');

  insert into public.rankings (turn_id, player_id, role)
  values (v_turn.id, (v_ctx.o_player).id, 'ranker')
  on conflict (turn_id, player_id) do nothing;

  select id into v_ranking_id from public.rankings
  where turn_id = v_turn.id and player_id = (v_ctx.o_player).id;

  -- The initial displayed sequence is itself a valid order, so a timeout can never
  -- leave the Ranker with nothing submitted.
  perform public._seed_ranking(v_ranking_id, v_turn.id);

  update public.game_turns set cards_accepted_at = now() where id = v_turn.id;

  update public.games
  set phase = 'ranker_ordering',
      phase_started_at = now(),
      phase_deadline_at = public._deadline(v_game.ranker_seconds),
      remaining_ms = null,
      last_activity_at = now()
  where id = v_game.id;

  perform public._emit(v_game.id, 'phase_changed', jsonb_build_object(
    'phase', 'ranker_ordering',
    'turnNumber', v_turn.turn_number
  ));

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: Ranker done -> Guessers ordering
-- ---------------------------------------------------------------------------
create or replace function public._enter_guessing(p_game_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
  v_turn public.game_turns;
  v_guessers integer;
  v_player uuid;
  v_ranking_id uuid;
begin
  select * into v_game from public.games where id = p_game_id for update;
  v_turn := public._current_turn(p_game_id);

  perform public._assert_transition(v_game.phase, 'guessers_ordering');

  update public.game_turns
  set ranker_submitted_at = coalesce(ranker_submitted_at, now()),
      guessing_started_at = now()
  where id = v_turn.id;

  -- Pre-create a ranking row per eligible Guesser so drafts survive a refresh or a
  -- reconnect. submitted_at stays null: a seeded order is NOT a submission.
  v_guessers := 0;
  for v_player in select player_id from public._eligible_guessers(v_turn.id) loop
    insert into public.rankings (turn_id, player_id, role)
    values (v_turn.id, v_player, 'guesser')
    on conflict (turn_id, player_id) do nothing;

    select id into v_ranking_id from public.rankings
    where turn_id = v_turn.id and player_id = v_player;
    perform public._seed_ranking(v_ranking_id, v_turn.id);

    v_guessers := v_guessers + 1;
  end loop;

  update public.game_turns set eligible_guesser_count = v_guessers where id = v_turn.id;

  if v_guessers = 0 then
    -- Nobody to guess (can happen if everyone else joined during this turn).
    update public.games
    set phase = 'guessers_ordering', phase_started_at = now(), phase_deadline_at = null
    where id = p_game_id;
    perform public._enter_reveal(p_game_id);
    return;
  end if;

  update public.games
  set phase = 'guessers_ordering',
      phase_started_at = now(),
      phase_deadline_at = public._deadline(v_game.guesser_seconds),
      remaining_ms = null,
      last_activity_at = now()
  where id = p_game_id;

  perform public._emit(p_game_id, 'phase_changed', jsonb_build_object(
    'phase', 'guessers_ordering',
    'turnNumber', v_turn.turn_number,
    'eligibleGuessers', v_guessers
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: score the turn. Idempotent at two levels — the turn's scored_at guard and
-- the unique index on score_events(turn_id, player_id, event_type).
-- ---------------------------------------------------------------------------
create or replace function public._score_turn(p_turn_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_turn public.game_turns;
  v_ranker_ranking uuid;
  v_row record;
  v_raw integer;
  v_awarded integer;
  v_penalty boolean;
  v_submitted boolean;
  v_group integer := 0;
  v_game_pts integer := 0;
  v_count integer := 0;
  v_event_id uuid;
begin
  select * into v_turn from public.game_turns where id = p_turn_id for update;
  if not found then
    perform public._fail('NO_ACTIVE_TURN');
  end if;

  if v_turn.scored_at is not null then
    return;   -- already scored; nothing to do
  end if;

  if v_turn.skipped then
    -- A skipped Ranker turn produces no group points and no game points at all.
    update public.game_turns
    set status = 'skipped', completed_at = now(), scored_at = now(),
        eligible_guesser_count = 0, possible_points = 0, group_points = 0, game_points = 0
    where id = p_turn_id;
    return;
  end if;

  select id into v_ranker_ranking from public.rankings
  where turn_id = p_turn_id and role = 'ranker';

  for v_row in
    select p.id as player_id, p.pending_zero_score_penalties as pending,
           r.id as ranking_id, r.submitted_at
    from public._eligible_guessers(p_turn_id) eg
    join public.players p on p.id = eg.player_id
    left join public.rankings r on r.turn_id = p_turn_id and r.player_id = p.id
    order by p.rotation_position
  loop
    v_count := v_count + 1;
    v_submitted := v_row.submitted_at is not null;

    if v_submitted and v_ranker_ranking is not null then
      select count(*) into v_raw
      from public.ranking_items gi
      join public.ranking_items ri
        on ri.turn_card_id = gi.turn_card_id
       and ri.position = gi.position
       and ri.ranking_id = v_ranker_ranking
      where gi.ranking_id = v_row.ranking_id;
    else
      v_raw := 0;
    end if;

    -- A pending skipped-Ranker penalty forces the awarded score to zero. It is consumed
    -- exactly once, on the first eligible Guesser turn after the skip.
    if v_row.pending > 0 then
      v_penalty := true;
      v_awarded := 0;
    else
      v_penalty := false;
      v_awarded := v_raw;
    end if;

    insert into public.score_events (
      game_id, turn_id, player_id, event_type, raw_score, awarded_score,
      penalty_applied, submitted, group_points_delta, game_points_delta, detail
    )
    values (
      v_turn.game_id, p_turn_id, v_row.player_id, 'guess_scored', v_raw, v_awarded,
      v_penalty, v_submitted, v_awarded, 5 - v_awarded,
      jsonb_build_object('turnNumber', v_turn.turn_number)
    )
    on conflict do nothing
    returning id into v_event_id;

    if v_event_id is not null then
      update public.players
      set total_score = total_score + v_awarded,
          scored_guesser_turns = scored_guesser_turns + 1,
          pending_zero_score_penalties = case when v_penalty
            then pending_zero_score_penalties - 1 else pending_zero_score_penalties end,
          consumed_penalties = case when v_penalty
            then consumed_penalties + 1 else consumed_penalties end
      where id = v_row.player_id;

      v_group := v_group + v_awarded;
      v_game_pts := v_game_pts + (5 - v_awarded);
      v_event_id := null;
    end if;

    if v_row.ranking_id is not null then
      update public.rankings
      set raw_score = v_raw,
          awarded_score = v_awarded,
          penalty_applied = v_penalty,
          scored_at = now(),
          is_locked = true
      where id = v_row.ranking_id;
    end if;
  end loop;

  update public.game_turns
  set status = 'scored',
      scored_at = now(),
      revealed_at = coalesce(revealed_at, now()),
      eligible_guesser_count = v_count,
      possible_points = v_count * 5,
      group_points = v_group,
      game_points = v_game_pts
  where id = p_turn_id;

  update public.games
  set group_points = group_points + v_group,
      game_points = game_points + v_game_pts,
      possible_points = possible_points + (v_count * 5),
      last_activity_at = now()
  where id = v_turn.game_id;

  update public.players
  set ranker_turns_completed = ranker_turns_completed + 1
  where id = v_turn.ranker_player_id;

  insert into public.score_events (
    game_id, turn_id, player_id, event_type, group_points_delta, game_points_delta, detail
  )
  values (
    v_turn.game_id, p_turn_id, null, 'turn_scored', v_group, v_game_pts,
    jsonb_build_object('turnNumber', v_turn.turn_number, 'eligibleGuessers', v_count)
  )
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: Guessers done -> reveal
-- ---------------------------------------------------------------------------
create or replace function public._enter_reveal(p_game_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
  v_turn public.game_turns;
begin
  select * into v_game from public.games where id = p_game_id for update;
  v_turn := public._current_turn(p_game_id);

  perform public._assert_transition(v_game.phase, 'reveal');
  perform public._score_turn(v_turn.id);

  update public.games
  set phase = 'reveal',
      phase_started_at = now(),
      phase_deadline_at = now() + make_interval(secs => public._reveal_seconds()),
      remaining_ms = null,
      last_activity_at = now()
  where id = p_game_id;

  perform public._emit(p_game_id, 'reveal_ready', jsonb_build_object(
    'phase', 'reveal',
    'turnNumber', v_turn.turn_number
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: reveal -> next turn (or finish)
-- ---------------------------------------------------------------------------
create or replace function public._advance_turn(p_game_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
begin
  select * into v_game from public.games where id = p_game_id for update;

  perform public._assert_transition(v_game.phase, 'next_turn');

  update public.game_turns
  set completed_at = coalesce(completed_at, now())
  where id = v_game.current_turn_id;

  update public.games set phase = 'next_turn' where id = p_game_id;

  perform public._begin_next_turn(p_game_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- persist_ranking — debounced draft save. Never submits.
-- ---------------------------------------------------------------------------
create or replace function public.persist_ranking(
  p_room_code text,
  p_session_token text,
  p_order text[]
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
  v_turn public.game_turns;
  v_ranking public.rankings;
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

  if v_game.phase not in ('ranker_ordering', 'guessers_ordering') then
    perform public._fail('WRONG_PHASE');
  end if;

  v_turn := public._current_turn(v_game.id);

  select * into v_ranking from public.rankings
  where turn_id = v_turn.id and player_id = v_player.id;
  if not found then
    perform public._fail('NOT_ORDERING');
  end if;

  if v_ranking.is_locked or v_ranking.submitted_at is not null then
    perform public._fail('ALREADY_SUBMITTED');
  end if;

  if (v_ranking.role = 'ranker') <> (v_game.phase = 'ranker_ordering') then
    perform public._fail('WRONG_PHASE');
  end if;

  perform public._write_ranking_items(v_ranking.id, v_turn.id, p_order);
  update public.players set last_seen_at = now() where id = v_player.id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_ranking — the explicit, final, locking submission.
-- ---------------------------------------------------------------------------
create or replace function public.submit_ranking(
  p_room_code text,
  p_session_token text,
  p_order text[]
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
  v_turn public.game_turns;
  v_ranking public.rankings;
  v_outstanding integer;
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

  -- Resolve any elapsed deadline first, so a late submission cannot sneak in.
  perform public._advance_if_expired(v_game.id);
  select * into v_game from public.games where id = v_game.id for update;

  if v_game.phase not in ('ranker_ordering', 'guessers_ordering') then
    perform public._fail('DEADLINE_PASSED');
  end if;

  v_turn := public._current_turn(v_game.id);

  select * into v_ranking from public.rankings
  where turn_id = v_turn.id and player_id = v_player.id;
  if not found then
    perform public._fail('NOT_ORDERING');
  end if;

  if v_ranking.submitted_at is not null then
    perform public._fail('ALREADY_SUBMITTED');
  end if;

  if (v_ranking.role = 'ranker') <> (v_game.phase = 'ranker_ordering') then
    perform public._fail('WRONG_PHASE');
  end if;

  perform public._write_ranking_items(v_ranking.id, v_turn.id, p_order);

  update public.rankings
  set submitted_at = now(), is_locked = true
  where id = v_ranking.id;

  update public.players set last_seen_at = now() where id = v_player.id;

  if v_ranking.role = 'ranker' then
    perform public._enter_guessing(v_game.id);
  else
    perform public._emit(v_game.id, 'submission_changed', jsonb_build_object(
      'phase', v_game.phase,
      'turnNumber', v_turn.turn_number
    ));

    select count(*) into v_outstanding
    from public._eligible_guessers(v_turn.id) eg
    left join public.rankings r on r.turn_id = v_turn.id and r.player_id = eg.player_id
    where r.submitted_at is null;

    if v_outstanding = 0 then
      perform public._enter_reveal(v_game.id);
    end if;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pausing
-- ---------------------------------------------------------------------------
create or replace function public._pause(p_game_id uuid, p_reason public.pause_reason)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
  v_remaining integer;
begin
  select * into v_game from public.games where id = p_game_id for update;

  if v_game.phase = 'paused' then
    return;
  end if;

  perform public._assert_transition(v_game.phase, 'paused');

  -- Preserve the exact remainder. Unlimited phases stay unlimited (no fake deadline).
  if v_game.phase_deadline_at is null then
    v_remaining := null;
  else
    v_remaining := greatest(0, floor(extract(epoch from (v_game.phase_deadline_at - now())) * 1000)::int);
  end if;

  update public.games
  set paused_from_phase = v_game.phase,
      phase = 'paused',
      paused_at = now(),
      pause_reason_code = p_reason,
      remaining_ms = v_remaining,
      phase_deadline_at = null,
      last_activity_at = now()
  where id = p_game_id;

  perform public._emit(p_game_id, 'paused', jsonb_build_object(
    'phase', 'paused',
    'reason', p_reason
  ));
end;
$$;

create or replace function public._resume(p_game_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
  v_target public.game_phase;
begin
  select * into v_game from public.games where id = p_game_id for update;

  if v_game.phase <> 'paused' then
    return;
  end if;

  v_target := coalesce(v_game.paused_from_phase, 'preparing_cards');
  perform public._assert_transition('paused', v_target);

  update public.games
  set phase = v_target,
      paused_at = null,
      paused_from_phase = null,
      pause_reason_code = null,
      phase_started_at = now(),
      -- New server-side deadline from the preserved remainder. The browser clock is
      -- never consulted.
      phase_deadline_at = case
        when v_game.remaining_ms is null then null
        else now() + make_interval(secs => v_game.remaining_ms / 1000.0)
      end,
      remaining_ms = null,
      last_activity_at = now()
  where id = p_game_id;

  perform public._emit(p_game_id, 'resumed', jsonb_build_object(
    'phase', v_target
  ));
end;
$$;

create or replace function public.pause_game(p_room_code text, p_session_token text)
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
  if v_game.phase in ('lobby', 'finished', 'cancelled', 'paused') then
    perform public._fail('WRONG_PHASE');
  end if;

  perform public._pause(v_game.id, 'manual');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.resume_game(p_room_code text, p_session_token text)
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
  if v_game.phase <> 'paused' then
    perform public._fail('WRONG_PHASE');
  end if;

  perform public._resume(v_game.id);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- skip_ranker_turn
--   * the current Ranker may always skip their own turn;
--   * the Host may skip only while that Ranker is disconnected.
-- Either way the Ranker earns a pending zero-score penalty.
-- ---------------------------------------------------------------------------
create or replace function public.skip_ranker_turn(p_room_code text, p_session_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
  v_player public.players;
  v_turn public.game_turns;
  v_ranker public.players;
  v_kind public.skip_kind;
  v_effective public.game_phase;
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

  v_effective := coalesce(
    case when v_game.phase = 'paused' then v_game.paused_from_phase else v_game.phase end,
    v_game.phase
  );

  if v_effective not in ('preparing_cards', 'ranker_ordering') then
    perform public._fail('WRONG_PHASE');
  end if;

  v_turn := public._current_turn(v_game.id);
  select * into v_ranker from public.players where id = v_turn.ranker_player_id;

  if v_player.id = v_turn.ranker_player_id then
    v_kind := 'voluntary';
  elsif v_player.is_host then
    if public._is_connected(v_ranker.last_seen_at) then
      perform public._fail('RANKER_CONNECTED');
    end if;
    v_kind := 'host_disconnected';
  else
    perform public._fail('NOT_ALLOWED');
  end if;

  update public.game_turns
  set status = 'skipped',
      skipped = true,
      skip_kind = v_kind,
      completed_at = now(),
      scored_at = now(),
      eligible_guesser_count = 0,
      possible_points = 0,
      group_points = 0,
      game_points = 0
  where id = v_turn.id;

  update public.players
  set ranker_turns_skipped = ranker_turns_skipped + 1,
      pending_zero_score_penalties = pending_zero_score_penalties + 1
  where id = v_turn.ranker_player_id;

  insert into public.score_events (game_id, turn_id, player_id, event_type, detail)
  values (v_game.id, v_turn.id, v_turn.ranker_player_id, 'turn_skipped',
          jsonb_build_object('turnNumber', v_turn.turn_number, 'kind', v_kind))
  on conflict do nothing;

  -- The paused game must come back to life before it can advance.
  if v_game.phase = 'paused' then
    update public.games
    set phase = v_game.paused_from_phase,
        paused_at = null,
        paused_from_phase = null,
        pause_reason_code = null,
        remaining_ms = null,
        phase_deadline_at = null
    where id = v_game.id;
  end if;

  update public.games set phase = 'next_turn' where id = v_game.id;

  perform public._emit(v_game.id, 'turn_skipped', jsonb_build_object(
    'phase', 'next_turn',
    'turnNumber', v_turn.turn_number,
    'kind', v_kind
  ));

  perform public._begin_next_turn(v_game.id);

  return jsonb_build_object('ok', true, 'kind', v_kind);
end;
$$;

-- ---------------------------------------------------------------------------
-- advance_game_if_needed — the whole scheduler, in one idempotent function.
-- ---------------------------------------------------------------------------
create or replace function public._advance_if_expired(p_game_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
  v_turn public.game_turns;
  v_ranker public.players;
  v_ranking public.rankings;
  v_outstanding integer;
  v_guard integer := 0;
begin
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 8;

    select * into v_game from public.games where id = p_game_id for update;
    if not found then
      return;
    end if;

    if v_game.phase in ('lobby', 'finished', 'cancelled') then
      return;
    end if;

    -- Auto-resume, but only when the pause was caused by the Ranker vanishing.
    -- A manual pause is never lifted by the machine.
    if v_game.phase = 'paused' then
      if v_game.pause_reason_code = 'ranker_disconnected' and v_game.current_turn_id is not null then
        select p.* into v_ranker
        from public.players p
        join public.game_turns t on t.ranker_player_id = p.id
        where t.id = v_game.current_turn_id;

        if found and public._is_connected(v_ranker.last_seen_at) then
          perform public._resume(p_game_id);
          continue;
        end if;
      end if;
      return;
    end if;

    if v_game.current_turn_id is null then
      return;
    end if;

    select * into v_turn from public.game_turns where id = v_game.current_turn_id;
    select * into v_ranker from public.players where id = v_turn.ranker_player_id;

    -- The Ranker is the only player the game can be blocked on. Pausing for a missing
    -- Guesser would let one flat battery stall everyone, so we don't.
    if v_game.phase in ('preparing_cards', 'ranker_ordering')
       and not public._is_connected(v_ranker.last_seen_at) then
      perform public._pause(p_game_id, 'ranker_disconnected');
      return;
    end if;

    if v_game.phase = 'ranker_ordering' then
      if v_game.phase_deadline_at is not null and now() >= v_game.phase_deadline_at then
        -- Timeout submits the most recently persisted valid order.
        select * into v_ranking from public.rankings
        where turn_id = v_turn.id and role = 'ranker';

        if found and v_ranking.submitted_at is null then
          update public.rankings
          set submitted_at = now(), is_locked = true, auto_submitted = true
          where id = v_ranking.id;
        end if;

        perform public._enter_guessing(p_game_id);
        continue;
      end if;
      return;
    end if;

    if v_game.phase = 'guessers_ordering' then
      select count(*) into v_outstanding
      from public._eligible_guessers(v_turn.id) eg
      left join public.rankings r on r.turn_id = v_turn.id and r.player_id = eg.player_id
      where r.submitted_at is null;

      if v_outstanding = 0
         or (v_game.phase_deadline_at is not null and now() >= v_game.phase_deadline_at) then
        perform public._enter_reveal(p_game_id);
        continue;
      end if;
      return;
    end if;

    if v_game.phase = 'reveal' then
      if v_game.phase_deadline_at is not null and now() >= v_game.phase_deadline_at then
        perform public._advance_turn(p_game_id);
        continue;
      end if;
      return;
    end if;

    if v_game.phase = 'next_turn' then
      perform public._begin_next_turn(p_game_id);
      continue;
    end if;

    return;
  end loop;
end;
$$;

create or replace function public.advance_game_if_needed(
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
begin
  select * into v_game from public.games
  where room_code = public._canonical_room_code(p_room_code);
  if not found then
    perform public._fail('ROOM_NOT_FOUND');
  end if;

  select * into v_player from public.players
  where game_id = v_game.id and session_hash = public._hash_token(p_session_token);
  if not found then
    perform public._fail('NOT_IN_ROOM');
  end if;

  perform public._rate_limit('advance', v_player.id::text, 120, 60);
  perform public._advance_if_expired(v_game.id);

  select * into v_game from public.games where id = v_game.id;

  return jsonb_build_object(
    'phase', v_game.phase,
    'turnNumber', v_game.current_turn_number,
    'serverNow', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MSOF')
  );
end;
$$;

-- Host may cut the 10 second reveal short.
create or replace function public.advance_reveal_now(p_room_code text, p_session_token text)
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
  if v_game.phase <> 'reveal' then
    perform public._fail('WRONG_PHASE');
  end if;

  perform public._advance_turn(v_game.id);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant execute on function public.replace_card_random(text, text, integer) to anon, authenticated;
grant execute on function public.choose_custom_card(text, text, integer, uuid) to anon, authenticated;
grant execute on function public.create_manual_card(text, text, integer, text, text) to anon, authenticated;
grant execute on function public.redraw_all_cards(text, text) to anon, authenticated;
grant execute on function public.redraw_custom_cards(text, text) to anon, authenticated;
grant execute on function public.accept_cards(text, text) to anon, authenticated;
grant execute on function public.persist_ranking(text, text, text[]) to anon, authenticated;
grant execute on function public.submit_ranking(text, text, text[]) to anon, authenticated;
grant execute on function public.pause_game(text, text) to anon, authenticated;
grant execute on function public.resume_game(text, text) to anon, authenticated;
grant execute on function public.skip_ranker_turn(text, text) to anon, authenticated;
grant execute on function public.advance_game_if_needed(text, text) to anon, authenticated;
grant execute on function public.advance_reveal_now(text, text) to anon, authenticated;
