-- ============================================================================
-- Sort It Out — 0070_rpc_state.sql
-- Finishing a game, the role-filtered state read, results retrieval and "play again".
--
-- get_game_state is the single read path for the whole app. Because anon has no direct
-- SELECT on any game table, this function *is* the privacy boundary: a card is only put
-- in the response once the phase makes it public, and the Ranker's secret order is only
-- included from the reveal onward.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Internal: build the durable end-of-game summary.
--
-- Places use standard competition ranking (1, 2, 2, 4 — never 1, 2, 2, 3), which is
-- exactly what SQL's rank() window function produces.
-- ---------------------------------------------------------------------------
create or replace function public._build_summary(p_game_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
  v_players jsonb;
  v_turns integer;
  v_verdict text;
  v_success numeric;
begin
  select * into v_game from public.games where id = p_game_id;
  if not found then
    perform public._fail('ROOM_NOT_FOUND');
  end if;

  select count(*) into v_turns from public.game_turns
  where game_id = p_game_id and status = 'scored';

  with base as (
    select
      p.id,
      p.display_name,
      p.total_score,
      p.scored_guesser_turns,
      p.ranker_turns_completed,
      p.ranker_turns_skipped,
      p.pending_zero_score_penalties,
      p.consumed_penalties,
      case when p.scored_guesser_turns = 0
        then null
        else p.total_score::numeric / p.scored_guesser_turns end as average
    from public.players p
    where p.game_id = p_game_id
  ),
  ranked as (
    select
      base.*,
      rank() over (order by total_score desc) as total_place,
      rank() over (order by average desc nulls last) as average_place
    from base
  )
  select jsonb_agg(
    jsonb_build_object(
      'playerId', id,
      'displayName', display_name,
      'totalScore', total_score,
      'scoredGuesserTurns', scored_guesser_turns,
      'average', average,
      'rankerTurnsCompleted', ranker_turns_completed,
      'rankerTurnsSkipped', ranker_turns_skipped,
      'pendingPenalties', pending_zero_score_penalties,
      'consumedPenalties', consumed_penalties,
      'totalPlace', total_place,
      'averagePlace', average_place
    )
    order by total_place, display_name
  )
  into v_players
  from ranked;

  v_verdict := case
    when v_game.group_points > v_game.game_points then 'group'
    when v_game.group_points = v_game.game_points then 'draw'
    else 'game'
  end;

  v_success := case
    when v_game.possible_points = 0 then null
    else round(v_game.group_points::numeric * 100 / v_game.possible_points, 2)
  end;

  return jsonb_build_object(
    'gameId', v_game.id,
    'roomCode', v_game.room_code,
    'createdAt', v_game.created_at,
    'startedAt', v_game.started_at,
    'finishedAt', coalesce(v_game.finished_at, now()),
    'settings', jsonb_build_object(
      'totalCycles', v_game.total_cycles,
      'rankerSeconds', v_game.ranker_seconds,
      'guesserSeconds', v_game.guesser_seconds,
      'allowManualCards', v_game.allow_manual_cards
    ),
    'cyclesCompleted', v_game.current_cycle,
    'scoredTurns', v_turns,
    'cooperative', jsonb_build_object(
      'groupPoints', v_game.group_points,
      'gamePoints', v_game.game_points,
      'possiblePoints', v_game.possible_points,
      'groupSuccessPercent', v_success,
      'verdict', v_verdict
    ),
    'players', coalesce(v_players, '[]'::jsonb)
  );
end;
$$;

create or replace function public._finish_game(p_game_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
  v_summary jsonb;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then
    perform public._fail('ROOM_NOT_FOUND');
  end if;

  if v_game.phase = 'finished' then
    return;   -- idempotent
  end if;

  perform public._assert_transition(v_game.phase, 'finished');

  update public.games
  set phase = 'finished',
      finished_at = now(),
      current_turn_id = current_turn_id,
      phase_deadline_at = null,
      remaining_ms = null,
      paused_at = null,
      paused_from_phase = null,
      pause_reason_code = null,
      last_activity_at = now()
  where id = p_game_id;

  v_summary := public._build_summary(p_game_id);

  insert into public.game_results (game_id, room_code, summary)
  values (p_game_id, v_game.room_code, v_summary)
  on conflict (game_id) do update set summary = excluded.summary;

  perform public._emit(p_game_id, 'game_finished', jsonb_build_object('phase', 'finished'));
end;
$$;

-- ---------------------------------------------------------------------------
-- end_game — host only, after confirmation in the UI.
--   * from the lobby the game never really existed  -> 'cancelled'
--   * mid-game the players have earned their results -> 'finished'
-- ---------------------------------------------------------------------------
create or replace function public.end_game(p_room_code text, p_session_token text)
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

  if v_game.phase in ('finished', 'cancelled') then
    return jsonb_build_object('phase', v_game.phase);
  end if;

  if v_game.phase = 'lobby' then
    perform public._assert_transition('lobby', 'cancelled');
    update public.games
    set phase = 'cancelled', finished_at = now(), last_activity_at = now()
    where id = v_game.id;
    perform public._emit(v_game.id, 'game_cancelled', jsonb_build_object('phase', 'cancelled'));
    return jsonb_build_object('phase', 'cancelled');
  end if;

  perform public._finish_game(v_game.id);
  return jsonb_build_object('phase', 'finished');
end;
$$;

-- ---------------------------------------------------------------------------
-- get_game_state — the only read path.
-- ---------------------------------------------------------------------------
create or replace function public.get_game_state(
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
  v_me public.players;
  v_turn public.game_turns;
  v_ranker public.players;
  v_effective public.game_phase;
  v_cards_public boolean;
  v_reveal_public boolean;
  v_my_ranking public.rankings;
  v_ranker_ranking uuid;
  v_players jsonb;
  v_cards jsonb;
  v_my_order jsonb;
  v_turn_json jsonb := null;
  v_reveal jsonb := null;
  v_custom jsonb := null;
  v_result jsonb := null;
  v_submitted integer := 0;
  v_eligible integer := 0;
  v_next_room text := null;
begin
  select * into v_game from public.games
  where room_code = public._canonical_room_code(p_room_code);
  if not found then
    perform public._fail('ROOM_NOT_FOUND');
  end if;

  select * into v_me from public.players
  where game_id = v_game.id and session_hash = public._hash_token(p_session_token);
  if not found then
    perform public._fail('NOT_IN_ROOM');
  end if;

  update public.players set last_seen_at = now() where id = v_me.id;
  v_me.last_seen_at := now();

  v_effective := coalesce(
    case when v_game.phase = 'paused' then v_game.paused_from_phase else v_game.phase end,
    v_game.phase
  );

  -- ---------------------------------------------------------------- players
  select jsonb_agg(
    jsonb_build_object(
      'playerId', p.id,
      'displayName', p.display_name,
      'isHost', p.is_host,
      'connected', public._is_connected(p.last_seen_at),
      'rotationPosition', p.rotation_position,
      -- A player who joined mid-turn shows "Joins next turn" until a turn they can
      -- actually play in begins.
      'joinsNextTurn', (v_game.current_turn_number > 0
                        and p.eligible_from_turn >= v_game.current_turn_number),
      'totalScore', p.total_score,
      'scoredGuesserTurns', p.scored_guesser_turns,
      'average', case when p.scored_guesser_turns = 0 then null
                      else p.total_score::numeric / p.scored_guesser_turns end,
      'rankerTurnsCompleted', p.ranker_turns_completed,
      'rankerTurnsSkipped', p.ranker_turns_skipped,
      'pendingPenalties', p.pending_zero_score_penalties,
      'consumedPenalties', p.consumed_penalties,
      'isRanker', (v_game.current_turn_id is not null and exists (
        select 1 from public.game_turns t
        where t.id = v_game.current_turn_id and t.ranker_player_id = p.id
      )),
      'submitted', coalesce((
        select r.submitted_at is not null from public.rankings r
        where r.turn_id = v_game.current_turn_id and r.player_id = p.id
      ), false)
    )
    order by p.rotation_position
  )
  into v_players
  from public.players p
  where p.game_id = v_game.id;

  -- ---------------------------------------------------------------- turn
  if v_game.current_turn_id is not null then
    select * into v_turn from public.game_turns where id = v_game.current_turn_id;
    select * into v_ranker from public.players where id = v_turn.ranker_player_id;

    -- The five concepts stay hidden from Guessers until the Ranker has locked in an
    -- order; otherwise they would get a head start on thinking.
    v_cards_public := v_effective in ('guessers_ordering', 'reveal')
                      or v_me.id = v_turn.ranker_player_id;

    -- The secret order is only ever released at the reveal.
    v_reveal_public := (v_game.phase = 'reveal') or (v_turn.scored_at is not null);

    if v_cards_public then
      select jsonb_agg(public._card_json(tc.id, v_me.language) || jsonb_build_object('slot', tc.slot)
                       order by tc.slot)
      into v_cards
      from public.turn_cards tc
      where tc.turn_id = v_turn.id;
    end if;

    select * into v_my_ranking from public.rankings
    where turn_id = v_turn.id and player_id = v_me.id;

    if v_my_ranking.id is not null then
      select jsonb_agg(tc.canonical_id order by ri.position)
      into v_my_order
      from public.ranking_items ri
      join public.turn_cards tc on tc.id = ri.turn_card_id
      where ri.ranking_id = v_my_ranking.id;
    end if;

    select count(*) into v_eligible from public._eligible_guessers(v_turn.id);

    select count(*) into v_submitted
    from public._eligible_guessers(v_turn.id) eg
    join public.rankings r on r.turn_id = v_turn.id and r.player_id = eg.player_id
    where r.submitted_at is not null;

    v_turn_json := jsonb_build_object(
      'turnId', v_turn.id,
      'turnNumber', v_turn.turn_number,
      'cycleNumber', v_turn.cycle_number,
      'rankerPlayerId', v_turn.ranker_player_id,
      'rankerDisplayName', v_ranker.display_name,
      'rankerConnected', public._is_connected(v_ranker.last_seen_at),
      'iAmRanker', v_me.id = v_turn.ranker_player_id,
      'iAmEligibleGuesser', exists (
        select 1 from public._eligible_guessers(v_turn.id) eg where eg.player_id = v_me.id
      ),
      'cardsAccepted', v_turn.cards_accepted_at is not null,
      'cards', v_cards,
      'myOrder', v_my_order,
      'iHaveSubmitted', coalesce(v_my_ranking.submitted_at is not null, false),
      'eligibleGuesserCount', v_eligible,
      'submittedCount', v_submitted,
      'skipped', v_turn.skipped,
      'status', v_turn.status
    );

    -- ------------------------------------------------------------- reveal
    if v_reveal_public then
      select id into v_ranker_ranking from public.rankings
      where turn_id = v_turn.id and role = 'ranker';

      v_reveal := jsonb_build_object(
        'turnNumber', v_turn.turn_number,
        'rankerPlayerId', v_turn.ranker_player_id,
        'rankerDisplayName', v_ranker.display_name,
        'rankerOrder', coalesce((
          select jsonb_agg(
            public._card_json(tc.id, v_me.language) || jsonb_build_object('position', ri.position)
            order by ri.position
          )
          from public.ranking_items ri
          join public.turn_cards tc on tc.id = ri.turn_card_id
          where ri.ranking_id = v_ranker_ranking
        ), '[]'::jsonb),
        'turnGroupPoints', v_turn.group_points,
        'turnGamePoints', v_turn.game_points,
        'turnPossiblePoints', v_turn.possible_points,
        'cumulativeGroupPoints', v_game.group_points,
        'cumulativeGamePoints', v_game.game_points,
        'cumulativePossiblePoints', v_game.possible_points,
        -- Everyone sees each player's score for the turn (that is the shared scoreboard),
        -- but nobody sees anyone else's actual ordering.
        'perPlayer', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'playerId', p.id,
              'displayName', p.display_name,
              'rawScore', r.raw_score,
              'awardedScore', r.awarded_score,
              'penaltyApplied', r.penalty_applied,
              'submitted', r.submitted_at is not null
            )
            order by r.awarded_score desc nulls last, p.display_name
          )
          from public.rankings r
          join public.players p on p.id = r.player_id
          where r.turn_id = v_turn.id and r.role = 'guesser'
        ), '[]'::jsonb),
        'myComparison', case
          when v_my_ranking.id is null or v_my_ranking.role = 'ranker' then null
          else coalesce((
            select jsonb_agg(
              public._card_json(tc.id, v_me.language) || jsonb_build_object(
                'myPosition', mine.position,
                'rankerPosition', theirs.position,
                'correct', mine.position = theirs.position
              )
              order by mine.position
            )
            from public.ranking_items mine
            join public.turn_cards tc on tc.id = mine.turn_card_id
            left join public.ranking_items theirs
              on theirs.ranking_id = v_ranker_ranking and theirs.turn_card_id = mine.turn_card_id
            where mine.ranking_id = v_my_ranking.id
          ), '[]'::jsonb)
        end,
        'myRawScore', v_my_ranking.raw_score,
        'myAwardedScore', v_my_ranking.awarded_score,
        'myPenaltyApplied', coalesce(v_my_ranking.penalty_applied, false),
        'mySubmitted', coalesce(v_my_ranking.submitted_at is not null, false)
      );
    end if;
  end if;

  -- ---------------------------------------------------------------- dictionary
  -- The custom dictionary is offered to the Ranker while preparing (to pick from) and
  -- to the Host (to export). Nobody else needs it.
  if (v_effective = 'preparing_cards' and v_game.current_turn_id is not null
      and v_turn.ranker_player_id = v_me.id)
     or v_me.is_host then
    select jsonb_agg(
      jsonb_build_object(
        'id', cc.id,
        'textEn', cc.text_en,
        'textEs', cc.text_es,
        'usedThisTurn', v_game.current_turn_id is not null and exists (
          select 1 from public.turn_cards tc
          where tc.turn_id = v_game.current_turn_id and tc.custom_card_id = cc.id
        ),
        'usedEver', exists (
          select 1 from public.turn_cards tc
          join public.game_turns t on t.id = tc.turn_id
          where t.game_id = v_game.id and tc.custom_card_id = cc.id
        )
      )
      order by coalesce(cc.text_en, cc.text_es)
    )
    into v_custom
    from public.game_custom_cards cc
    where cc.game_id = v_game.id and cc.is_enabled;
  end if;

  -- ---------------------------------------------------------------- result
  if v_game.phase in ('finished', 'cancelled') then
    select summary into v_result from public.game_results where game_id = v_game.id;
    if v_result is null then
      v_result := public._build_summary(v_game.id);
    end if;

    if v_game.next_game_id is not null then
      select room_code into v_next_room from public.games where id = v_game.next_game_id;
    end if;
  end if;

  return jsonb_build_object(
    'serverNow', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MSOF'),
    'game', jsonb_build_object(
      'gameId', v_game.id,
      'roomCode', v_game.room_code,
      'phase', v_game.phase,
      'effectivePhase', v_effective,
      'totalCycles', v_game.total_cycles,
      'currentCycle', v_game.current_cycle,
      'currentTurnNumber', v_game.current_turn_number,
      'rankerSeconds', v_game.ranker_seconds,
      'guesserSeconds', v_game.guesser_seconds,
      'allowManualCards', v_game.allow_manual_cards,
      'deadlineAt', v_game.phase_deadline_at,
      'pausedAt', v_game.paused_at,
      'pauseReason', v_game.pause_reason_code,
      'remainingMs', v_game.remaining_ms,
      'groupPoints', v_game.group_points,
      'gamePoints', v_game.game_points,
      'possiblePoints', v_game.possible_points,
      'startedAt', v_game.started_at,
      'finishedAt', v_game.finished_at,
      'customCardCount', (select count(*) from public.game_custom_cards
                          where game_id = v_game.id and is_enabled),
      'nextRoomCode', v_next_room
    ),
    'me', jsonb_build_object(
      'playerId', v_me.id,
      'displayName', v_me.display_name,
      'language', v_me.language,
      'isHost', v_me.is_host,
      'totalScore', v_me.total_score,
      'scoredGuesserTurns', v_me.scored_guesser_turns,
      'average', case when v_me.scored_guesser_turns = 0 then null
                      else v_me.total_score::numeric / v_me.scored_guesser_turns end,
      'pendingPenalties', v_me.pending_zero_score_penalties,
      'consumedPenalties', v_me.consumed_penalties,
      'rankerTurnsCompleted', v_me.ranker_turns_completed,
      'rankerTurnsSkipped', v_me.ranker_turns_skipped,
      'eligibleFromTurn', v_me.eligible_from_turn
    ),
    'players', coalesce(v_players, '[]'::jsonb),
    'turn', v_turn_json,
    'reveal', v_reveal,
    'customCards', v_custom,
    'result', v_result
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- get_game_result — a completed game can be looked up with its room code alone.
-- Nothing secret survives in a finished game (the orders are already public), so this
-- needs no session. Retention: see cleanup_old_data().
-- ---------------------------------------------------------------------------
create or replace function public.get_game_result(p_room_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_summary jsonb;
begin
  perform public._rate_limit('result_lookup', public._canonical_room_code(p_room_code), 60, 600);

  select gr.summary into v_summary
  from public.game_results gr
  where gr.room_code = public._canonical_room_code(p_room_code)
  order by gr.created_at desc
  limit 1;

  if v_summary is null then
    perform public._fail('RESULT_NOT_FOUND');
  end if;

  return v_summary;
end;
$$;

-- ---------------------------------------------------------------------------
-- export_custom_dictionary — host only. Returns rows ready for CSV serialization.
-- ---------------------------------------------------------------------------
create or replace function public.export_custom_dictionary(
  p_room_code text,
  p_session_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games;
  v_player public.players;
  v_cards jsonb;
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
  if not v_player.is_host then
    perform public._fail('NOT_HOST');
  end if;

  select jsonb_agg(
    jsonb_build_object('en', text_en, 'es', text_es)
    order by coalesce(text_en, text_es)
  )
  into v_cards
  from public.game_custom_cards
  where game_id = v_game.id and is_enabled;

  return jsonb_build_object('roomCode', v_game.room_code, 'cards', coalesce(v_cards, '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- play_again — host only, after the game is over. Same settings, same players, same
-- custom dictionary, fresh room. Everyone's client picks up `nextRoomCode` from
-- get_game_state and follows along.
-- ---------------------------------------------------------------------------
create or replace function public.play_again(p_room_code text, p_session_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.games;
  v_player public.players;
  v_code text;
  v_new_id uuid;
  v_attempt integer := 0;
  v_count integer := 0;
begin
  select * into v_old from public.games
  where room_code = public._canonical_room_code(p_room_code) for update;
  if not found then
    perform public._fail('ROOM_NOT_FOUND');
  end if;

  select * into v_player from public.players
  where game_id = v_old.id and session_hash = public._hash_token(p_session_token);
  if not found then
    perform public._fail('NOT_IN_ROOM');
  end if;
  if not v_player.is_host then
    perform public._fail('NOT_HOST');
  end if;
  if v_old.phase not in ('finished', 'cancelled') then
    perform public._fail('WRONG_PHASE');
  end if;

  -- Already restarted: hand back the same room instead of making another one.
  if v_old.next_game_id is not null then
    select room_code into v_code from public.games where id = v_old.next_game_id;
    if v_code is not null then
      return jsonb_build_object('roomCode', v_code, 'reused', true);
    end if;
  end if;

  perform public._rate_limit('play_again', v_player.id::text, 10, 600);

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
  values (
    v_code, 'lobby', v_old.total_cycles, v_old.ranker_seconds, v_old.guesser_seconds,
    v_old.allow_manual_cards
  )
  returning id into v_new_id;

  insert into public.players (
    game_id, display_name, normalized_name, language, session_hash, is_host,
    rotation_position, eligible_from_turn, last_seen_at
  )
  select
    v_new_id, p.display_name, p.normalized_name, p.language, p.session_hash, p.is_host,
    row_number() over (order by p.rotation_position), 0, p.last_seen_at
  from public.players p
  where p.game_id = v_old.id and p.left_at is null;

  select count(*) into v_count from public.players where game_id = v_new_id;

  update public.games
  set rotation_size = v_count,
      host_player_id = (select id from public.players
                        where game_id = v_new_id and normalized_name = v_player.normalized_name)
  where id = v_new_id;

  insert into public.game_custom_cards (game_id, text_en, text_es, normalized_key, is_enabled)
  select v_new_id, text_en, text_es, normalized_key, is_enabled
  from public.game_custom_cards
  where game_id = v_old.id
  on conflict (game_id, normalized_key) do nothing;

  update public.games set next_game_id = v_new_id where id = v_old.id;

  -- Members discover the new code through get_game_state; Realtime only gets a nudge.
  perform public._emit(v_old.id, 'game_restarted', jsonb_build_object('phase', v_old.phase));

  return jsonb_build_object('roomCode', v_code, 'reused', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_game_record — host only. Removes the durable result row for one game.
-- The Host's local history entry is removed by the browser separately.
-- ---------------------------------------------------------------------------
create or replace function public.delete_game_record(p_room_code text, p_session_token text)
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
  if v_game.phase not in ('finished', 'cancelled') then
    perform public._fail('WRONG_PHASE');
  end if;

  delete from public.game_results where game_id = v_game.id;
  delete from public.games where id = v_game.id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant execute on function public.end_game(text, text) to anon, authenticated;
grant execute on function public.get_game_state(text, text) to anon, authenticated;
grant execute on function public.get_game_result(text) to anon, authenticated;
grant execute on function public.export_custom_dictionary(text, text) to anon, authenticated;
grant execute on function public.play_again(text, text) to anon, authenticated;
grant execute on function public.delete_game_record(text, text) to anon, authenticated;
