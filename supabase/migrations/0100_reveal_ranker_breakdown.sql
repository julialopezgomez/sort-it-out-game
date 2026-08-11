-- ============================================================================
-- Add a per-card, per-guesser breakdown to the reveal, visible only to the Ranker.
--
-- Guessers still only ever see their own comparison (myComparison). This adds a second
-- view of the same reveal, for the Ranker only: for each of their five cards, who
-- guessed what position, and whether it was correct.
-- ============================================================================

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

    v_cards_public := v_effective in ('guessers_ordering', 'reveal')
                      or v_me.id = v_turn.ranker_player_id;

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
        'mySubmitted', coalesce(v_my_ranking.submitted_at is not null, false),
        -- Ranker only: for each of their cards, every guesser's guessed position and
        -- whether it was correct. A Guesser never receives anyone else's actual order,
        -- so this stays null for everyone except the Ranker.
        'rankerBreakdown', case
          when v_me.id = v_turn.ranker_player_id then coalesce((
            select jsonb_agg(
              public._card_json(tc.id, v_me.language) || jsonb_build_object(
                'position', ranker_item.position,
                'guesses', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'playerId', p.id,
                      'displayName', p.display_name,
                      'position', case when r.submitted_at is not null then gi.position else null end,
                      'correct', case
                        when r.submitted_at is not null and gi.position is not null
                        then gi.position = ranker_item.position
                        else false
                      end,
                      'submitted', r.submitted_at is not null
                    )
                    order by p.rotation_position
                  )
                  from public.rankings r
                  join public.players p on p.id = r.player_id
                  left join public.ranking_items gi
                    on gi.ranking_id = r.id and gi.turn_card_id = tc.id
                  where r.turn_id = v_turn.id and r.role = 'guesser'
                ), '[]'::jsonb)
              )
              order by ranker_item.position
            )
            from public.turn_cards tc
            join public.ranking_items ranker_item
              on ranker_item.turn_card_id = tc.id and ranker_item.ranking_id = v_ranker_ranking
            where tc.turn_id = v_turn.id
          ), '[]'::jsonb)
          else null
        end
      );
    end if;
  end if;

  -- ---------------------------------------------------------------- dictionary
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
