-- ============================================================================
-- Repeat a previous turn's five cards.
--
-- During card preparation, the Ranker can reuse the exact five concepts from an earlier
-- turn in this game instead of drawing a fresh hand — for instance to see how they would
-- have ranked a set that was originally dealt to someone else. This only ever reuses the
-- *set of concepts*; it never exposes any past Ranker's actual order, which stays exactly
-- as hidden as it always was (get_game_state never republishes an old turn's reveal).
--
-- Cheap by construction: a game has at most 30 players x 10 cycles = 300 turns ever, and
-- both queries below are simple indexed joins scoped to one game_id.
-- ============================================================================

create or replace function public.list_previous_turn_card_sets(
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
  v_result jsonb;
begin
  select * into v_ctx from public._require_ranker_preparing(p_room_code, p_session_token);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'turnId', t.id,
      'turnNumber', t.turn_number,
      'cycleNumber', t.cycle_number,
      'rankerDisplayName', p.display_name,
      'skipped', t.skipped,
      'cards', (
        select jsonb_agg(public._card_json(tc.id, (v_ctx.o_player).language) order by tc.slot)
        from public.turn_cards tc
        where tc.turn_id = t.id
      )
    )
    order by t.turn_number desc
  ), '[]'::jsonb)
  into v_result
  from public.game_turns t
  join public.players p on p.id = t.ranker_player_id
  where t.game_id = (v_ctx.o_game).id
    and t.id <> (v_ctx.o_turn).id
    and (select count(*) from public.turn_cards tc where tc.turn_id = t.id) = 5;

  return v_result;
end;
$$;

create or replace function public.repeat_previous_turn_cards(
  p_room_code text,
  p_session_token text,
  p_source_turn_id uuid
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

  -- Must be a real turn in this same game, not the turn in progress, and must still have
  -- its full five cards on record (every turn does, by construction, but this stays
  -- defensive rather than assuming it).
  perform 1
  from public.game_turns t
  where t.id = p_source_turn_id
    and t.game_id = (v_ctx.o_game).id
    and t.id <> (v_ctx.o_turn).id
    and (select count(*) from public.turn_cards tc where tc.turn_id = t.id) = 5;

  if not found then
    perform public._fail('CARD_NOT_FOUND');
  end if;

  delete from public.turn_cards where turn_id = (v_ctx.o_turn).id;

  insert into public.turn_cards (turn_id, slot, source, factory_card_id, custom_card_id, canonical_id)
  select (v_ctx.o_turn).id, src.slot, src.source, src.factory_card_id, src.custom_card_id, src.canonical_id
  from public.turn_cards src
  where src.turn_id = p_source_turn_id;

  perform public._emit((v_ctx.o_game).id, 'cards_changed', jsonb_build_object('phase', 'preparing_cards'));

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.list_previous_turn_card_sets(text, text) to anon, authenticated;
grant execute on function public.repeat_previous_turn_cards(text, text, uuid) to anon, authenticated;
