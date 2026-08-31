-- ---------------------------------------------------------------------------
-- 0130 — Running out of time submits the order on screen
--
-- Until now only the Ranker's order survived an expired clock. A Guesser who ran out of
-- time submitted nothing and scored 0, which made the timeout feel like a punishment for
-- being slow rather than the end of a phase.
--
-- Two changes, which only make sense together:
--
--  1. An expired Guesser deadline submits each outstanding Guesser's saved draft — the
--     order they last touched, or the one they were dealt if they never touched it.
--  2. A Guesser's dealt order is therefore no longer the Ranker's dealt order. Each
--     Guesser is seeded with a private shuffle that shares no position with the Ranker's
--     submitted order, so a player who does nothing at all still scores 0 and can never
--     back into a perfect guess.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Internal: a Guesser's starting layout
--
-- Random, private to that Guesser, and deliberately disjoint from the Ranker's order:
-- no card sits in the position the Ranker actually gave it.
-- ---------------------------------------------------------------------------
create or replace function public._seed_guesser_ranking(
  p_ranking_id uuid,
  p_turn_id uuid,
  p_ranker_ranking_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_cards uuid[];
  v_ranker uuid[];
  v_try uuid[];
  v_attempt integer := 0;
  v_clash boolean;
  v_i integer;
begin
  if exists (select 1 from public.ranking_items where ranking_id = p_ranking_id) then
    return;
  end if;

  select array_agg(tc.id order by tc.slot) into v_cards
  from public.turn_cards tc
  where tc.turn_id = p_turn_id;

  if v_cards is null then
    return;
  end if;

  if p_ranker_ranking_id is not null then
    select array_agg(ri.turn_card_id order by ri.position) into v_ranker
    from public.ranking_items ri
    where ri.ranking_id = p_ranker_ranking_id;
  end if;

  loop
    v_attempt := v_attempt + 1;

    select array_agg(c order by random()) into v_try from unnest(v_cards) as c;

    -- Nothing to avoid: any shuffle will do.
    exit when v_ranker is null
           or array_length(v_ranker, 1) is distinct from array_length(v_try, 1);

    v_clash := false;
    for v_i in 1 .. array_length(v_try, 1) loop
      if v_try[v_i] = v_ranker[v_i] then
        v_clash := true;
        exit;
      end if;
    end loop;

    exit when not v_clash;

    -- About one shuffle in three works, so this is only ever reached in theory. Rotating
    -- the Ranker's own order by one moves every card, which ends the search for good.
    if v_attempt >= 20 then
      v_try := v_ranker[2:] || v_ranker[1:1];
      exit;
    end if;
  end loop;

  insert into public.ranking_items (ranking_id, turn_card_id, position)
  select p_ranking_id, u.card, u.ord
  from unnest(v_try) with ordinality as u(card, ord);
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: Ranker done -> Guessers ordering
--
-- Unchanged except for the seeded layout each Guesser starts from.
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
  v_ranker_ranking_id uuid;
begin
  select * into v_game from public.games where id = p_game_id for update;
  v_turn := public._current_turn(p_game_id);

  perform public._assert_transition(v_game.phase, 'guessers_ordering');

  update public.game_turns
  set ranker_submitted_at = coalesce(ranker_submitted_at, now()),
      guessing_started_at = now()
  where id = v_turn.id;

  select id into v_ranker_ranking_id from public.rankings
  where turn_id = v_turn.id and role = 'ranker';

  -- Pre-create a ranking row per eligible Guesser so drafts survive a refresh or a
  -- reconnect. submitted_at stays null until the Guesser submits or the clock runs out.
  v_guessers := 0;
  for v_player in select player_id from public._eligible_guessers(v_turn.id) loop
    insert into public.rankings (turn_id, player_id, role)
    values (v_turn.id, v_player, 'guesser')
    on conflict (turn_id, player_id) do nothing;

    select id into v_ranking_id from public.rankings
    where turn_id = v_turn.id and player_id = v_player;
    perform public._seed_guesser_ranking(v_ranking_id, v_turn.id, v_ranker_ranking_id);

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
-- advance_game_if_needed's engine
--
-- Unchanged except for the guessers_ordering branch, which now submits the outstanding
-- drafts before revealing, exactly as the ranker_ordering branch already did.
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
  v_expired boolean;
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

      v_expired := v_game.phase_deadline_at is not null and now() >= v_game.phase_deadline_at;

      if v_outstanding = 0 or v_expired then
        if v_expired then
          -- Same deal as the Ranker: the order on screen when the clock ran out is the
          -- order that counts. Untouched, that is the seeded layout, which shares no
          -- position with the Ranker's order and therefore scores 0.
          update public.rankings r
          set submitted_at = now(), is_locked = true, auto_submitted = true
          where r.turn_id = v_turn.id
            and r.role = 'guesser'
            and r.submitted_at is null
            and r.player_id in (select eg.player_id from public._eligible_guessers(v_turn.id) eg);
        end if;

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
