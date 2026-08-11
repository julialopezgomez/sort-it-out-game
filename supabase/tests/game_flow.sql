-- ============================================================================
-- Sort It Out — database integration tests
--
-- These exercise the real RPCs against a real Postgres. They are the authoritative
-- tests for anything the database decides: scoring, penalties, rotation, deadlines,
-- pausing and secrecy.
--
--   pnpm db:test          (see docs/TESTING.md)
--
-- Everything runs inside one transaction and is rolled back, so the database is left
-- exactly as it was. Session tokens follow the convention 't-<lowercase name>'.
--
-- Time travel: the whole script runs in a single transaction, so now() is frozen.
-- To simulate an elapsed deadline or a silent player we move the stored timestamp into
-- the past rather than waiting.
-- ============================================================================

\set ON_ERROR_STOP on
\timing off
set client_min_messages = notice;

begin;

-- ---------------------------------------------------------------------------
-- helpers local to the test run
-- ---------------------------------------------------------------------------
create or replace function pg_temp.ranker_token(p_code text)
returns text language sql as $$
  select 't-' || lower(p.display_name)
  from public.games g
  join public.game_turns t on t.id = g.current_turn_id
  join public.players p on p.id = t.ranker_player_id
  where g.room_code = p_code;
$$;

create or replace function pg_temp.turn_order(p_code text)
returns text[] language sql as $$
  select array_agg(tc.canonical_id order by tc.slot)
  from public.games g
  join public.turn_cards tc on tc.turn_id = g.current_turn_id
  where g.room_code = p_code;
$$;

-- a cyclic shift by one has no fixed points, so it always scores exactly 0
create or replace function pg_temp.rotated(p_order text[])
returns text[] language sql as $$
  select p_order[2:5] || p_order[1:1];
$$;

create or replace function pg_temp.phase(p_code text)
returns text language sql as $$
  select phase::text from public.games where room_code = p_code;
$$;

-- every non-Ranker who owes a guess submits the Ranker's exact order
create or replace function pg_temp.all_guessers_submit_exact(p_code text)
returns void language plpgsql as $$
declare
  v_order text[] := pg_temp.turn_order(p_code);
  v_tok text;
begin
  for v_tok in
    select 't-' || lower(p.display_name)
    from public.games g
    join public._eligible_guessers(g.current_turn_id) eg on true
    join public.players p on p.id = eg.player_id
    where g.room_code = p_code
  loop
    perform public.submit_ranking(p_code, v_tok, v_order);
  end loop;
end;
$$;

-- ===========================================================================
-- TEST A — a complete 3 player, 1 cycle game with perfect guessing
-- ===========================================================================
-- rate limits are per-credential; each scenario starts from a clean slate
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_tok text;
  v_order text[];
  v_turn integer;
  v_g public.games;
  v_p public.players;
  v_summary jsonb;
begin
  v_code := (public.create_room(
    't-alice', 'Alice', 'en',
    '{"totalCycles":1,"guesserSeconds":60,"allowManualCards":true}'::jsonb
  ) ->> 'roomCode');

  perform public.join_room(v_code, 't-bob', 'Bob', 'es');
  perform public.join_room(v_code, 't-carol', 'Carol', 'en');

  assert pg_temp.phase(v_code) = 'lobby', 'A: should still be in the lobby';

  perform public.start_game(v_code, 't-alice');
  assert pg_temp.phase(v_code) = 'preparing_cards', 'A: start_game must begin card preparation';

  -- 3 players x 1 cycle = 3 turns
  for v_turn in 1..3 loop
    v_tok := pg_temp.ranker_token(v_code);

    -- card preparation has no deadline
    select * into v_g from public.games where room_code = v_code;
    assert v_g.phase_deadline_at is null, 'A: card preparation must never be timed';
    assert (select count(*) from public.turn_cards where turn_id = v_g.current_turn_id) = 5,
      'A: a turn must always have exactly five cards';

    perform public.accept_cards(v_code, v_tok);
    assert pg_temp.phase(v_code) = 'ranker_ordering', 'A: accept_cards -> ranker_ordering';

    v_order := pg_temp.turn_order(v_code);
    perform public.submit_ranking(v_code, v_tok, v_order);
    assert pg_temp.phase(v_code) = 'guessers_ordering', 'A: ranker submit -> guessers_ordering';

    perform pg_temp.all_guessers_submit_exact(v_code);
    assert pg_temp.phase(v_code) = 'reveal',
      format('A: all submissions in -> reveal (turn %s, got %s)', v_turn, pg_temp.phase(v_code));

    select * into v_g from public.games where room_code = v_code;
    if v_turn < 3 then
      -- reveal auto-advances after its deadline
      update public.games set phase_deadline_at = now() - interval '1 second' where id = v_g.id;
      perform public.advance_game_if_needed(v_code, 't-alice');
      assert pg_temp.phase(v_code) = 'preparing_cards',
        format('A: reveal -> next turn (turn %s, got %s)', v_turn, pg_temp.phase(v_code));
    end if;
  end loop;

  -- last reveal: the game must finish rather than start a fourth turn
  select * into v_g from public.games where room_code = v_code;
  update public.games set phase_deadline_at = now() - interval '1 second' where id = v_g.id;
  perform public.advance_game_if_needed(v_code, 't-alice');
  assert pg_temp.phase(v_code) = 'finished',
    format('A: one cycle of three players is three turns then finished, got %s', pg_temp.phase(v_code));

  select * into v_g from public.games where room_code = v_code;
  -- 3 turns x 2 guessers x 5 positions, all correct
  assert v_g.possible_points = 30, format('A: possible points 30, got %s', v_g.possible_points);
  assert v_g.group_points = 30, format('A: group points 30, got %s', v_g.group_points);
  assert v_g.game_points = 0, format('A: game points 0, got %s', v_g.game_points);

  for v_p in select * from public.players where game_id = v_g.id loop
    assert v_p.ranker_turns_completed = 1,
      format('A: %s should have been Ranker once, got %s', v_p.display_name, v_p.ranker_turns_completed);
    assert v_p.scored_guesser_turns = 2,
      format('A: %s should have 2 scored guesser turns, got %s', v_p.display_name, v_p.scored_guesser_turns);
    assert v_p.total_score = 10,
      format('A: %s should have 10 points, got %s', v_p.display_name, v_p.total_score);
  end loop;

  -- the durable summary must exist and agree
  assert (select (summary -> 'cooperative' ->> 'verdict') from public.game_results
          where game_id = v_g.id) = 'group', 'A: cooperative verdict should be a group victory';
  assert (select (summary -> 'cooperative' ->> 'groupSuccessPercent')::numeric
          from public.game_results where game_id = v_g.id) = 100,
    'A: group success should be 100%';

  v_summary := public.get_game_result(v_code);
  assert v_summary ->> 'roomCode' = v_code,
    'A: a completed result must be retrievable through the public lookup RPC';

  raise notice 'TEST A passed — full cycle, scoring, cooperative totals, finish';
end $$;

-- ===========================================================================
-- TEST B — a non-submitter scores zero and hands five points to the game
-- ===========================================================================
-- rate limits are per-credential; each scenario starts from a clean slate
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_tok text;
  v_order text[];
  v_g public.games;
  v_lazy public.players;
  v_turn_id uuid;
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en',
    '{"totalCycles":1,"guesserSeconds":30}'::jsonb) ->> 'roomCode');
  perform public.join_room(v_code, 't-bob', 'Bob', 'en');
  perform public.join_room(v_code, 't-carol', 'Carol', 'en');
  perform public.start_game(v_code, 't-alice');

  v_tok := pg_temp.ranker_token(v_code);
  perform public.accept_cards(v_code, v_tok);
  v_order := pg_temp.turn_order(v_code);
  perform public.submit_ranking(v_code, v_tok, v_order);

  select * into v_g from public.games where room_code = v_code;
  v_turn_id := v_g.current_turn_id;

  -- exactly one of the two guessers answers, and answers perfectly
  select p.* into v_lazy
  from public._eligible_guessers(v_turn_id) eg
  join public.players p on p.id = eg.player_id
  order by p.display_name
  limit 1;

  perform public.submit_ranking(v_code, 't-' || lower((
    select p.display_name from public._eligible_guessers(v_turn_id) eg
    join public.players p on p.id = eg.player_id
    where p.id <> v_lazy.id limit 1
  )), v_order);

  assert pg_temp.phase(v_code) = 'guessers_ordering', 'B: one guesser is still outstanding';

  -- the guesser deadline elapses with no submission from v_lazy
  update public.games set phase_deadline_at = now() - interval '1 second' where id = v_g.id;
  perform public.advance_game_if_needed(v_code, 't-alice');
  assert pg_temp.phase(v_code) = 'reveal', 'B: an elapsed guesser deadline must reveal';

  select * into v_lazy from public.players where id = v_lazy.id;
  assert v_lazy.total_score = 0, format('B: non-submitter scores 0, got %s', v_lazy.total_score);
  assert v_lazy.scored_guesser_turns = 1,
    'B: a missed turn still counts in the average denominator';

  select * into v_g from public.games where room_code = v_code;
  assert v_g.possible_points = 10, format('B: possible 10, got %s', v_g.possible_points);
  assert v_g.group_points = 5, format('B: group 5, got %s', v_g.group_points);
  assert v_g.game_points = 5, format('B: game 5, got %s', v_g.game_points);

  raise notice 'TEST B passed — non-submitter zero, cooperative split';
end $$;

-- ===========================================================================
-- TEST C — a voluntary skip creates a penalty that is consumed exactly once
-- ===========================================================================
-- rate limits are per-credential; each scenario starts from a clean slate
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_tok text;
  v_skipper uuid;
  v_order text[];
  v_g public.games;
  v_p public.players;
  v_turn_id uuid;
  v_ranking public.rankings;
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en',
    '{"totalCycles":2}'::jsonb) ->> 'roomCode');
  perform public.join_room(v_code, 't-bob', 'Bob', 'en');
  perform public.join_room(v_code, 't-carol', 'Carol', 'en');
  perform public.start_game(v_code, 't-alice');

  -- the first Ranker gives up their own turn
  v_tok := pg_temp.ranker_token(v_code);
  select t.ranker_player_id into v_skipper
  from public.games g join public.game_turns t on t.id = g.current_turn_id
  where g.room_code = v_code;

  perform public.skip_ranker_turn(v_code, v_tok);

  select * into v_p from public.players where id = v_skipper;
  assert v_p.ranker_turns_skipped = 1, 'C: skip must be recorded';
  assert v_p.pending_zero_score_penalties = 1, 'C: skip must create exactly one pending penalty';

  select * into v_g from public.games where room_code = v_code;
  assert v_g.phase = 'preparing_cards', 'C: a skip advances straight to the next Ranker';
  assert (select count(*) from public.game_turns where game_id = v_g.id and skipped) = 1,
    'C: the skipped turn is recorded as skipped';
  assert v_g.possible_points = 0 and v_g.group_points = 0 and v_g.game_points = 0,
    'C: a skipped Ranker turn produces no group and no game points';

  -- next turn: the skipper guesses perfectly but must still be awarded zero
  v_tok := pg_temp.ranker_token(v_code);
  perform public.accept_cards(v_code, v_tok);
  v_order := pg_temp.turn_order(v_code);
  perform public.submit_ranking(v_code, v_tok, v_order);

  select current_turn_id into v_turn_id from public.games where room_code = v_code;
  perform pg_temp.all_guessers_submit_exact(v_code);

  select * into v_ranking from public.rankings where turn_id = v_turn_id and player_id = v_skipper;
  assert v_ranking.raw_score = 5, format('C: raw score should still be 5, got %s', v_ranking.raw_score);
  assert v_ranking.awarded_score = 0, format('C: awarded score forced to 0, got %s', v_ranking.awarded_score);
  assert v_ranking.penalty_applied, 'C: the reveal must be able to explain the forced zero';

  select * into v_p from public.players where id = v_skipper;
  assert v_p.pending_zero_score_penalties = 0, 'C: the penalty is consumed';
  assert v_p.consumed_penalties = 1, 'C: consumption is recorded';
  assert v_p.total_score = 0, 'C: the forced zero counts in the total';
  assert v_p.scored_guesser_turns = 1, 'C: the penalty turn counts in the denominator';

  -- cooperative: the penalised player gives 0 to the group and 5 to the game
  select group_points, game_points into strict v_g.group_points, v_g.game_points
  from public.game_turns where id = v_turn_id;
  assert v_g.group_points = 5, format('C: group points 5, got %s', v_g.group_points);
  assert v_g.game_points = 5, format('C: game points 5, got %s', v_g.game_points);

  -- and the penalty must not apply a second time
  select current_turn_id into v_turn_id from public.games where room_code = v_code;
  update public.games set phase_deadline_at = now() - interval '1 second' where room_code = v_code;
  perform public.advance_game_if_needed(v_code, 't-alice');

  v_tok := pg_temp.ranker_token(v_code);
  perform public.accept_cards(v_code, v_tok);
  v_order := pg_temp.turn_order(v_code);
  perform public.submit_ranking(v_code, v_tok, v_order);
  select current_turn_id into v_turn_id from public.games where room_code = v_code;

  if exists (select 1 from public._eligible_guessers(v_turn_id) where player_id = v_skipper) then
    perform pg_temp.all_guessers_submit_exact(v_code);
    select * into v_ranking from public.rankings where turn_id = v_turn_id and player_id = v_skipper;
    assert v_ranking.awarded_score = 5,
      format('C: the second turn must score normally, got %s', v_ranking.awarded_score);
  end if;

  raise notice 'TEST C passed — skip penalty created, applied once, then cleared';
end $$;

-- ===========================================================================
-- TEST D — Ranker deadline expiry submits the last persisted order
-- ===========================================================================
-- rate limits are per-credential; each scenario starts from a clean slate
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_tok text;
  v_order text[];
  v_shuffled text[];
  v_g public.games;
  v_saved text[];
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en',
    '{"totalCycles":1,"rankerSeconds":30}'::jsonb) ->> 'roomCode');
  perform public.join_room(v_code, 't-bob', 'Bob', 'en');
  perform public.start_game(v_code, 't-alice');

  v_tok := pg_temp.ranker_token(v_code);
  perform public.accept_cards(v_code, v_tok);

  select * into v_g from public.games where room_code = v_code;
  assert v_g.phase_deadline_at is not null, 'D: the Ranker timer starts only after accept_cards';

  v_order := pg_temp.turn_order(v_code);
  v_shuffled := pg_temp.rotated(v_order);
  perform public.persist_ranking(v_code, v_tok, v_shuffled);

  -- time runs out
  update public.games set phase_deadline_at = now() - interval '1 second' where id = v_g.id;
  perform public.advance_game_if_needed(v_code, 't-bob');

  assert pg_temp.phase(v_code) = 'guessers_ordering', 'D: expiry must move the game on';

  select array_agg(tc.canonical_id order by ri.position) into v_saved
  from public.rankings r
  join public.ranking_items ri on ri.ranking_id = r.id
  join public.turn_cards tc on tc.id = ri.turn_card_id
  where r.turn_id = v_g.current_turn_id and r.role = 'ranker';

  assert v_saved = v_shuffled, 'D: expiry must submit the most recently persisted order';
  assert (select auto_submitted from public.rankings
          where turn_id = v_g.current_turn_id and role = 'ranker'), 'D: flagged as auto-submitted';

  raise notice 'TEST D passed — timeout submits the last persisted valid order';
end $$;

-- ===========================================================================
-- TEST E — pausing: Ranker disconnect auto-pauses and auto-resumes;
--          a manual pause never auto-resumes; remaining time is preserved
-- ===========================================================================
-- rate limits are per-credential; each scenario starts from a clean slate
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_tok text;
  v_ranker uuid;
  v_g public.games;
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en',
    '{"totalCycles":1,"rankerSeconds":60}'::jsonb) ->> 'roomCode');
  perform public.join_room(v_code, 't-bob', 'Bob', 'en');
  perform public.start_game(v_code, 't-alice');

  v_tok := pg_temp.ranker_token(v_code);
  perform public.accept_cards(v_code, v_tok);

  select t.ranker_player_id into v_ranker
  from public.games g join public.game_turns t on t.id = g.current_turn_id
  where g.room_code = v_code;

  -- the Ranker goes quiet
  update public.players set last_seen_at = now() - interval '5 minutes' where id = v_ranker;
  perform public.advance_game_if_needed(v_code, 't-alice');

  select * into v_g from public.games where room_code = v_code;
  assert v_g.phase = 'paused', 'E: a missing Ranker pauses the game';
  assert v_g.pause_reason_code = 'ranker_disconnected', 'E: the reason is recorded';
  assert v_g.remaining_ms between 1 and 60000, format('E: remaining time preserved, got %s', v_g.remaining_ms);
  assert v_g.phase_deadline_at is null, 'E: a paused game has no live deadline';

  -- the Ranker comes back
  update public.players set last_seen_at = now() where id = v_ranker;
  perform public.advance_game_if_needed(v_code, 't-alice');

  select * into v_g from public.games where room_code = v_code;
  assert v_g.phase = 'ranker_ordering', 'E: reconnect auto-resumes a disconnect pause';
  assert v_g.phase_deadline_at > now(), 'E: a fresh server deadline is issued on resume';
  assert v_g.phase_deadline_at <= now() + interval '60 seconds',
    'E: the resumed deadline uses the preserved remainder, not the full duration';

  -- a manual pause is different: it must survive advance_game_if_needed forever
  perform public.pause_game(v_code, 't-alice');
  select * into v_g from public.games where room_code = v_code;
  assert v_g.pause_reason_code = 'manual', 'E: manual pause reason';

  perform public.advance_game_if_needed(v_code, 't-alice');
  assert pg_temp.phase(v_code) = 'paused', 'E: a manually paused game must never auto-resume';

  perform public.resume_game(v_code, 't-alice');
  assert pg_temp.phase(v_code) = 'ranker_ordering', 'E: the Host can resume';

  raise notice 'TEST E passed — auto-pause, auto-resume, manual pause, preserved remainder';
end $$;

-- ===========================================================================
-- TEST F — only the Host may skip, and only a disconnected Ranker
-- ===========================================================================
-- rate limits are per-credential; each scenario starts from a clean slate
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_ranker uuid;
  v_ranker_tok text;
  v_other_tok text;
  v_failed boolean;
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en',
    '{"totalCycles":1}'::jsonb) ->> 'roomCode');
  perform public.join_room(v_code, 't-bob', 'Bob', 'en');
  perform public.join_room(v_code, 't-carol', 'Carol', 'en');
  perform public.start_game(v_code, 't-alice');

  v_ranker_tok := pg_temp.ranker_token(v_code);
  select t.ranker_player_id into v_ranker
  from public.games g join public.game_turns t on t.id = g.current_turn_id
  where g.room_code = v_code;

  -- the Host cannot skip a Ranker who is present
  if v_ranker_tok <> 't-alice' then
    v_failed := false;
    begin
      perform public.skip_ranker_turn(v_code, 't-alice');
    exception when others then
      v_failed := (sqlerrm = 'RANKER_CONNECTED');
    end;
    assert v_failed, 'F: the Host must not skip a connected Ranker';
  end if;

  -- a plain player may never skip somebody else's turn
  select 't-' || lower(display_name) into v_other_tok
  from public.players
  where game_id = (select id from public.games where room_code = v_code)
    and not is_host and id <> v_ranker
  limit 1;

  if v_other_tok is not null then
    v_failed := false;
    begin
      perform public.skip_ranker_turn(v_code, v_other_tok);
    exception when others then
      v_failed := (sqlerrm = 'NOT_ALLOWED');
    end;
    assert v_failed, 'F: a non-host, non-ranker must not skip';
  end if;

  -- once the Ranker is gone, the Host may move the game along
  update public.players set last_seen_at = now() - interval '5 minutes' where id = v_ranker;
  perform public.advance_game_if_needed(v_code, 't-alice');
  assert pg_temp.phase(v_code) = 'paused', 'F: the game waits for the Ranker';

  perform public.skip_ranker_turn(v_code, 't-alice');
  assert pg_temp.phase(v_code) = 'preparing_cards', 'F: the Host skip resumes play';
  assert (select pending_zero_score_penalties from public.players where id = v_ranker) = 1,
    'F: a host-initiated skip also carries the penalty';

  raise notice 'TEST F passed — skip permissions and host rescue';
end $$;

-- ===========================================================================
-- TEST G — a Guesser can never obtain the secret order before the reveal
-- ===========================================================================
-- rate limits are per-credential; each scenario starts from a clean slate
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_tok text;
  v_other text;
  v_state jsonb;
  v_order text[];
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en',
    '{"totalCycles":1}'::jsonb) ->> 'roomCode');
  perform public.join_room(v_code, 't-bob', 'Bob', 'es');
  perform public.start_game(v_code, 't-alice');

  v_tok := pg_temp.ranker_token(v_code);
  v_other := case when v_tok = 't-alice' then 't-bob' else 't-alice' end;

  -- during card preparation the Guesser must not even see the concepts
  v_state := public.get_game_state(v_code, v_other);
  assert v_state -> 'turn' -> 'cards' = 'null'::jsonb or v_state -> 'turn' -> 'cards' is null,
    'G: Guessers must not see the cards while the Ranker prepares';
  assert v_state -> 'reveal' = 'null'::jsonb or v_state -> 'reveal' is null,
    'G: no reveal payload before the reveal';

  perform public.accept_cards(v_code, v_tok);
  v_state := public.get_game_state(v_code, v_other);
  assert v_state -> 'turn' -> 'cards' = 'null'::jsonb or v_state -> 'turn' -> 'cards' is null,
    'G: still hidden while the Ranker orders';

  v_order := pg_temp.turn_order(v_code);
  perform public.submit_ranking(v_code, v_tok, v_order);

  -- now the Guesser gets the five canonical ids, but NOT the order
  v_state := public.get_game_state(v_code, v_other);
  assert jsonb_array_length(v_state -> 'turn' -> 'cards') = 5, 'G: five cards are handed out';
  assert v_state -> 'reveal' = 'null'::jsonb or v_state -> 'reveal' is null,
    'G: the secret order is not in the payload during guessing';

  perform public.submit_ranking(v_code, v_other, pg_temp.rotated(v_order));

  v_state := public.get_game_state(v_code, v_other);
  assert jsonb_array_length(v_state -> 'reveal' -> 'rankerOrder') = 5,
    'G: the order is published at the reveal';
  assert (v_state -> 'reveal' ->> 'myAwardedScore')::int = 0,
    'G: a cyclic shift has no exact matches';

  raise notice 'TEST G passed — the secret order stays secret until the reveal';
end $$;

-- ===========================================================================
-- TEST H — a modified client cannot submit a bogus order
-- ===========================================================================
-- rate limits are per-credential; each scenario starts from a clean slate
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_tok text;
  v_order text[];
  v_err text;
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en', '{"totalCycles":1}'::jsonb) ->> 'roomCode');
  perform public.join_room(v_code, 't-bob', 'Bob', 'en');
  perform public.start_game(v_code, 't-alice');

  v_tok := pg_temp.ranker_token(v_code);
  perform public.accept_cards(v_code, v_tok);
  v_order := pg_temp.turn_order(v_code);

  -- duplicates
  v_err := null;
  begin
    perform public.submit_ranking(v_code, v_tok, array[v_order[1], v_order[1], v_order[2], v_order[3], v_order[4]]);
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'INVALID_ORDER', format('H: duplicates rejected, got %s', v_err);

  -- a card that is not in this turn
  v_err := null;
  begin
    perform public.submit_ranking(v_code, v_tok, array[v_order[1], v_order[2], v_order[3], v_order[4], 'f-not-a-real-card']);
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'INVALID_ORDER', format('H: foreign card rejected, got %s', v_err);

  -- wrong length
  v_err := null;
  begin
    perform public.submit_ranking(v_code, v_tok, array[v_order[1], v_order[2]]);
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'INVALID_ORDER', format('H: short order rejected, got %s', v_err);

  -- a Guesser cannot submit while the Ranker is still ordering
  v_err := null;
  begin
    perform public.submit_ranking(v_code,
      case when v_tok = 't-alice' then 't-bob' else 't-alice' end, v_order);
  exception when others then v_err := sqlerrm; end;
  assert v_err in ('NOT_ORDERING', 'WRONG_PHASE'), format('H: early guess rejected, got %s', v_err);

  -- and the Ranker cannot submit twice
  perform public.submit_ranking(v_code, v_tok, v_order);
  v_err := null;
  begin
    perform public.submit_ranking(v_code, v_tok, v_order);
  exception when others then v_err := sqlerrm; end;
  assert v_err in ('ALREADY_SUBMITTED', 'WRONG_PHASE'), format('H: double submit rejected, got %s', v_err);

  raise notice 'TEST H passed — payload validation is server-side';
end $$;

-- ===========================================================================
-- TEST I — joining after the start: next turn only, appended to the rotation,
--          still gets a Ranker turn in the final cycle, average shows as unknown
-- ===========================================================================
-- rate limits are per-credential; each scenario starts from a clean slate
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_tok text;
  v_order text[];
  v_late uuid;
  v_g public.games;
  v_turn_id uuid;
  v_state jsonb;
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en', '{"totalCycles":1}'::jsonb) ->> 'roomCode');
  perform public.join_room(v_code, 't-bob', 'Bob', 'en');
  perform public.start_game(v_code, 't-alice');

  select current_turn_id into v_turn_id from public.games where room_code = v_code;

  -- Dave arrives while turn 1 is being prepared
  perform public.join_room(v_code, 't-dave', 'Dave', 'en');
  select id into v_late from public.players
  where game_id = (select id from public.games where room_code = v_code)
    and normalized_name = 'dave';

  assert (select eligible_from_turn from public.players where id = v_late) = 1,
    'I: a late joiner is not eligible for the turn in progress';
  assert not exists (select 1 from public._eligible_guessers(v_turn_id) where player_id = v_late),
    'I: and owes no guess on it';
  assert (select rotation_position from public.players where id = v_late) = 3,
    'I: a late joiner goes to the end of the rotation';

  v_state := public.get_game_state(v_code, 't-dave');
  assert (v_state -> 'me' -> 'average') = 'null'::jsonb,
    'I: the average is unknown, not 0.00, until a Guesser turn is played';
  assert (
    select (p ->> 'joinsNextTurn')::boolean
    from jsonb_array_elements(v_state -> 'players') p
    where p ->> 'displayName' = 'Dave'
  ), 'I: the player list shows "joins next turn"';

  -- turn 1
  v_tok := pg_temp.ranker_token(v_code);
  perform public.accept_cards(v_code, v_tok);
  v_order := pg_temp.turn_order(v_code);
  perform public.submit_ranking(v_code, v_tok, v_order);
  perform pg_temp.all_guessers_submit_exact(v_code);

  assert (select scored_guesser_turns from public.players where id = v_late) = 0,
    'I: turns played before joining never enter the denominator';

  -- from turn 2 onward Dave is a normal Guesser, and Dave closes the cycle as Ranker
  update public.games set phase_deadline_at = now() - interval '1 second' where room_code = v_code;
  perform public.advance_game_if_needed(v_code, 't-alice');
  select current_turn_id into v_turn_id from public.games where room_code = v_code;
  assert exists (select 1 from public._eligible_guessers(v_turn_id) where player_id = v_late),
    'I: eligible from the next turn';

  v_tok := pg_temp.ranker_token(v_code);
  perform public.accept_cards(v_code, v_tok);
  v_order := pg_temp.turn_order(v_code);
  perform public.submit_ranking(v_code, v_tok, v_order);
  perform pg_temp.all_guessers_submit_exact(v_code);
  update public.games set phase_deadline_at = now() - interval '1 second' where room_code = v_code;
  perform public.advance_game_if_needed(v_code, 't-alice');

  select * into v_g from public.games where room_code = v_code;
  assert v_g.phase = 'preparing_cards',
    format('I: the late joiner still gets a Ranker turn in the final cycle, got %s', v_g.phase);
  assert (select ranker_player_id from public.game_turns where id = v_g.current_turn_id) = v_late,
    'I: and it is at the end of the cycle';

  raise notice 'TEST I passed — late joining, rotation placement, denominators';
end $$;

-- ===========================================================================
-- TEST J — reconnection and name reclaiming
-- ===========================================================================
-- rate limits are per-credential; each scenario starts from a clean slate
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_bob uuid;
  v_err text;
  v_res jsonb;
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en', '{}'::jsonb) ->> 'roomCode');
  perform public.join_room(v_code, 't-bob', 'Bob', 'en');
  select id into v_bob from public.players
  where game_id = (select id from public.games where room_code = v_code) and normalized_name = 'bob';

  -- the same browser returning is a plain resume
  v_res := public.join_room(v_code, 't-bob', 'Bob', 'en');
  assert v_res ->> 'mode' = 'resumed', format('J: same credential resumes, got %s', v_res ->> 'mode');

  -- a different browser cannot steal a connected name
  v_err := null;
  begin
    perform public.join_room(v_code, 't-impostor', 'bob', 'en');
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'NAME_TAKEN', format('J: connected names are protected, got %s', v_err);

  -- room codes and names are case- and whitespace-insensitive
  v_err := null;
  begin
    perform public.join_room(lower(v_code), 't-impostor', '  BOB  ', 'en');
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'NAME_TAKEN', 'J: normalization must not open a loophole';

  -- once Bob is disconnected, a new device may reclaim the name (documented tradeoff)
  update public.players set last_seen_at = now() - interval '5 minutes' where id = v_bob;
  v_res := public.join_room(v_code, 't-bob-phone', 'Bob', 'es');
  assert v_res ->> 'mode' = 'reclaimed', format('J: disconnected names can be reclaimed, got %s', v_res ->> 'mode');
  assert (v_res ->> 'playerId')::uuid = v_bob, 'J: reclaiming keeps the same player, and the same score';
  assert (select language from public.players where id = v_bob) = 'es',
    'J: the reclaiming device brings its own language';

  -- the old credential is now worthless
  v_err := null;
  begin
    perform public.get_game_state(v_code, 't-bob');
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'NOT_IN_ROOM', 'J: a replaced credential no longer works';

  raise notice 'TEST J passed — resume, reclaim, and name protection';
end $$;

-- ===========================================================================
-- TEST K — scoring happens exactly once, however many clients race
-- ===========================================================================
-- rate limits are per-credential; each scenario starts from a clean slate
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_tok text;
  v_order text[];
  v_g public.games;
  v_turn_id uuid;
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en',
    '{"totalCycles":1,"guesserSeconds":30}'::jsonb) ->> 'roomCode');
  perform public.join_room(v_code, 't-bob', 'Bob', 'en');
  perform public.join_room(v_code, 't-carol', 'Carol', 'en');
  perform public.start_game(v_code, 't-alice');

  v_tok := pg_temp.ranker_token(v_code);
  perform public.accept_cards(v_code, v_tok);
  v_order := pg_temp.turn_order(v_code);
  perform public.submit_ranking(v_code, v_tok, v_order);
  select current_turn_id into v_turn_id from public.games where room_code = v_code;

  perform pg_temp.all_guessers_submit_exact(v_code);
  select * into v_g from public.games where room_code = v_code;
  assert v_g.group_points = 10, format('K: 10 group points once, got %s', v_g.group_points);

  -- every client in the room now hammers the advance RPC
  perform public.advance_game_if_needed(v_code, 't-alice');
  perform public.advance_game_if_needed(v_code, 't-bob');
  perform public.advance_game_if_needed(v_code, 't-carol');
  perform public._score_turn(v_turn_id);
  perform public._score_turn(v_turn_id);

  select * into v_g from public.games where room_code = v_code;
  assert v_g.group_points = 10, format('K: still 10 group points, got %s', v_g.group_points);
  assert (select count(*) from public.score_events
          where turn_id = v_turn_id and event_type = 'guess_scored') = 2,
    'K: exactly one score event per guesser';
  assert (select total_score from public.players
          where game_id = v_g.id and normalized_name <> lower(substring(v_tok from 3))
          order by total_score desc limit 1) = 5,
    'K: nobody is paid twice';

  raise notice 'TEST K passed — idempotent scoring under concurrent advance calls';
end $$;

-- ===========================================================================
-- TEST L — custom dictionary: import, de-duplication, manual cards, redraw rules
-- ===========================================================================
-- rate limits are per-credential; each scenario starts from a clean slate
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_gid uuid;
  v_tok text;
  v_res jsonb;
  v_err text;
  v_card uuid;
  v_before text;
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en', '{"totalCycles":1}'::jsonb,
    '[{"en":"Board games","es":null},
      {"en":"board  games","es":null},
      {"en":null,"es":"La siesta"},
      {"en":"Going camping","es":"Ir de camping"},
      {"en":"","es":""},
      {"en":"Rainy afternoons","es":"Tardes lluviosas"}]'::jsonb) ->> 'roomCode');

  select id into v_gid from public.games where room_code = v_code;

  assert (select count(*) from public.game_custom_cards where game_id = v_gid) = 4,
    format('L: 4 cards survive normalization, got %s',
           (select count(*) from public.game_custom_cards where game_id = v_gid));

  perform public.join_room(v_code, 't-bob', 'Bob', 'en');

  -- a further import that only adds duplicates
  v_res := public.import_custom_cards(v_code, 't-alice',
    '[{"en":"BOARD GAMES","es":""},{"en":"Something new","es":null}]'::jsonb);
  assert (v_res ->> 'duplicates')::int = 1, 'L: normalized duplicates are reported';
  assert (v_res ->> 'inserted')::int = 1, 'L: and new rows still land';

  -- a non-host cannot import
  v_err := null;
  begin
    perform public.import_custom_cards(v_code, 't-bob', '[{"en":"Nope","es":null}]'::jsonb);
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'NOT_HOST', format('L: only the Host imports, got %s', v_err);

  perform public.start_game(v_code, 't-alice');
  v_tok := pg_temp.ranker_token(v_code);

  -- custom-only redraw needs MORE than five custom cards; we have exactly five
  assert public._count_eligible_cards(v_gid, true) = 5, 'L: five custom cards for this check';
  v_err := null;
  begin
    perform public.redraw_custom_cards(v_code, v_tok);
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'NOT_ENOUGH_CUSTOM_CARDS',
    format('L: custom-only redraw is unavailable at five cards, got %s', v_err);

  -- a manual one-language card joins the dictionary and takes its slot immediately
  select canonical_id into v_before from public.turn_cards
  where turn_id = (select current_turn_id from public.games where room_code = v_code) and slot = 2;

  v_res := public.create_manual_card(v_code, v_tok, 2, 'Sudden silence at the table', null);
  assert (v_res ->> 'created')::boolean, 'L: a new manual card is created';
  v_card := (v_res ->> 'cardId')::uuid;

  assert (select canonical_id from public.turn_cards
          where turn_id = (select current_turn_id from public.games where room_code = v_code) and slot = 2)
         = 'c:' || v_card::text, 'L: the manual card is used at once';
  assert public._count_eligible_cards(v_gid, true) = 6, 'L: it is added to the game dictionary';

  -- now custom-only redraw becomes possible
  perform public.redraw_custom_cards(v_code, v_tok);
  assert (select count(*) from public.turn_cards tc
          where tc.turn_id = (select current_turn_id from public.games where room_code = v_code)
            and tc.source = 'custom') = 5,
    'L: a custom-only redraw uses custom cards exclusively';

  -- redraws never produce duplicates
  perform public.redraw_all_cards(v_code, v_tok);
  assert (select count(distinct canonical_id) from public.turn_cards
          where turn_id = (select current_turn_id from public.games where room_code = v_code)) = 5,
    'L: five distinct cards after redraw all';

  perform public.replace_card_random(v_code, v_tok, 3);
  assert (select count(distinct canonical_id) from public.turn_cards
          where turn_id = (select current_turn_id from public.games where room_code = v_code)) = 5,
    'L: five distinct cards after a single replacement';

  -- a Guesser cannot touch the Ranker's cards
  v_err := null;
  begin
    perform public.replace_card_random(v_code,
      case when v_tok = 't-alice' then 't-bob' else 't-alice' end, 1);
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'NOT_RANKER', format('L: only the Ranker prepares cards, got %s', v_err);

  -- the exported dictionary is what the Host will download
  v_res := public.export_custom_dictionary(v_code, 't-alice');
  assert jsonb_array_length(v_res -> 'cards') = 6, 'L: export contains the whole dictionary';

  raise notice 'TEST L passed — dictionary import, dedupe, manual cards, redraw rules';
end $$;

-- ===========================================================================
-- TEST M — the two-player minimum, room capacity, and manual-card setting
-- ===========================================================================
-- rate limits are per-credential; each scenario starts from a clean slate
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_err text;
  v_i integer;
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en', '{"allowManualCards":false}'::jsonb) ->> 'roomCode');

  v_err := null;
  begin
    perform public.start_game(v_code, 't-alice');
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'NEED_TWO_PLAYERS', format('M: a solo game cannot start, got %s', v_err);

  -- fill the room to its 30 player ceiling
  for v_i in 2..30 loop
    perform public.join_room(v_code, 't-p' || v_i, 'P' || v_i, 'en');
  end loop;

  v_err := null;
  begin
    perform public.join_room(v_code, 't-p31', 'P31', 'en');
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'ROOM_FULL', format('M: the 31st player is turned away, got %s', v_err);

  perform public.start_game(v_code, 't-alice');

  v_err := null;
  begin
    perform public.create_manual_card(v_code, pg_temp.ranker_token(v_code), 1, 'Nope', null);
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'MANUAL_CARDS_DISABLED',
    format('M: the Host setting is enforced server-side, got %s', v_err);

  raise notice 'TEST M passed — player limits and settings enforcement';
end $$;

-- ===========================================================================
-- TEST N — play again carries settings, players and dictionary to a new room
-- ===========================================================================
-- rate limits are per-credential; each scenario starts from a clean slate
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_new text;
  v_res jsonb;
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en',
    '{"totalCycles":3,"rankerSeconds":45,"guesserSeconds":300}'::jsonb,
    '[{"en":"Board games","es":"Juegos de mesa"}]'::jsonb) ->> 'roomCode');
  perform public.join_room(v_code, 't-bob', 'Bob', 'es');
  perform public.end_game(v_code, 't-alice');
  assert pg_temp.phase(v_code) = 'cancelled', 'N: ending from the lobby cancels';

  v_res := public.play_again(v_code, 't-alice');
  v_new := v_res ->> 'roomCode';
  assert v_new <> v_code, 'N: play again means a fresh room code';

  assert (select total_cycles from public.games where room_code = v_new) = 3, 'N: settings carry over';
  assert (select guesser_seconds from public.games where room_code = v_new) = 300, 'N: including timers';
  assert (select count(*) from public.players p join public.games g on g.id = p.game_id
          where g.room_code = v_new) = 2, 'N: players carry over';
  assert (select count(*) from public.game_custom_cards c join public.games g on g.id = c.game_id
          where g.room_code = v_new) = 1, 'N: the dictionary carries over';
  assert (select is_host from public.players p join public.games g on g.id = p.game_id
          where g.room_code = v_new and p.normalized_name = 'alice'), 'N: the Host stays the Host';

  -- and the old room tells its members where to go
  assert (public.get_game_state(v_code, 't-bob') -> 'game' ->> 'nextRoomCode') = v_new,
    'N: members discover the new room through the RPC, not through Realtime';
  assert not exists (
    select 1 from public.room_events e
    join public.games g on g.id = e.game_id
    where g.room_code = v_code and e.payload::text like '%' || v_new || '%'
  ), 'N: a room code must never appear in a world-readable Realtime row';

  raise notice 'TEST N passed — play again';
end $$;

-- ===========================================================================
-- TEST O — illegal transitions are refused
-- ===========================================================================
delete from public.rate_limits;

do $$
begin
  assert public._can_transition('lobby', 'preparing_cards');
  assert public._can_transition('guessers_ordering', 'reveal');
  assert public._can_transition('paused', 'ranker_ordering');
  assert not public._can_transition('lobby', 'reveal'), 'O: cannot skip straight to a reveal';
  assert not public._can_transition('finished', 'preparing_cards'), 'O: a finished game is final';
  assert not public._can_transition('reveal', 'guessers_ordering'), 'O: no going back to guessing';
  assert not public._can_transition('cancelled', 'lobby'), 'O: cancelled is terminal';
  raise notice 'TEST O passed — transition table';
end $$;

-- ===========================================================================
-- TEST P — the anon role, which is what every browser actually is, has no direct
--          reach into any game table. This is the guarantee that makes it safe to
--          ship the public API key inside the JavaScript bundle.
-- ===========================================================================
delete from public.rate_limits;

do $$
declare
  v_table text;
  v_outcome text;
  v_cnt bigint;
begin
  foreach v_table in array array[
    'games', 'players', 'game_turns', 'turn_cards', 'rankings', 'ranking_items',
    'game_custom_cards', 'factory_cards', 'score_events', 'game_results', 'rate_limits'
  ]
  loop
    v_outcome := 'READABLE';
    begin
      set local role anon;
      execute format('select count(*) from public.%I', v_table) into v_cnt;
    exception
      when insufficient_privilege then v_outcome := 'DENIED';
      when others then v_outcome := 'ERROR ' || sqlstate;
    end;
    reset role;

    assert v_outcome = 'DENIED',
      format('P: anon must not be able to select from %s (got %s)', v_table, v_outcome);
  end loop;

  -- writes are refused too, not just reads
  v_outcome := 'WRITABLE';
  begin
    set local role anon;
    execute 'update public.players set total_score = 999';
  exception
    when insufficient_privilege then v_outcome := 'DENIED';
    when others then v_outcome := 'ERROR ' || sqlstate;
  end;
  reset role;
  assert v_outcome = 'DENIED', format('P: anon must not be able to write scores (got %s)', v_outcome);

  -- the one exception: Realtime notifications, which carry nothing secret
  v_outcome := 'DENIED';
  begin
    set local role anon;
    execute 'select count(*) from public.room_events' into v_cnt;
    v_outcome := 'READABLE';
  exception when others then v_outcome := 'ERROR ' || sqlstate;
  end;
  reset role;
  assert v_outcome = 'READABLE',
    format('P: anon must be able to read room_events or Realtime cannot deliver (got %s)', v_outcome);

  raise notice 'TEST P passed — anon has no direct table access except room_events';
end $$;

-- ===========================================================================
-- TEST Q — the Ranker's reveal breakdown shows every guesser's per-card guess;
--          a Guesser gets none of it
-- ===========================================================================
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_tok text;
  v_order text[];
  v_rotated text[];
  v_other1 text;
  v_other2 text;
  v_state jsonb;
  v_breakdown jsonb;
  v_first_card jsonb;
  v_guesses jsonb;
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en', '{"totalCycles":1}'::jsonb) ->> 'roomCode');
  perform public.join_room(v_code, 't-bob', 'Bob', 'en');
  perform public.join_room(v_code, 't-carol', 'Carol', 'en');
  perform public.start_game(v_code, 't-alice');

  v_tok := pg_temp.ranker_token(v_code);
  perform public.accept_cards(v_code, v_tok);
  v_order := pg_temp.turn_order(v_code);
  perform public.submit_ranking(v_code, v_tok, v_order);
  v_rotated := pg_temp.rotated(v_order);

  select 't-' || lower(display_name) into v_other1
  from public.players
  where game_id = (select id from public.games where room_code = v_code)
    and normalized_name <> lower(substring(v_tok from 3))
  order by rotation_position limit 1;
  select 't-' || lower(display_name) into v_other2
  from public.players
  where game_id = (select id from public.games where room_code = v_code)
    and normalized_name <> lower(substring(v_tok from 3))
    and 't-' || lower(display_name) <> v_other1
  order by rotation_position limit 1;

  -- one guesser matches exactly, the other guesses a cyclic shift (no exact matches)
  perform public.submit_ranking(v_code, v_other1, v_order);
  perform public.submit_ranking(v_code, v_other2, v_rotated);

  v_state := public.get_game_state(v_code, v_tok);
  v_breakdown := v_state -> 'reveal' -> 'rankerBreakdown';

  assert jsonb_array_length(v_breakdown) = 5, 'Q: one breakdown row per card';
  assert (v_breakdown -> 0 ->> 'position')::int = 1, 'Q: rows are ordered by the Ranker''s position';
  assert (v_breakdown -> 4 ->> 'position')::int = 5, 'Q: through to position 5';

  v_first_card := v_breakdown -> 0;
  assert jsonb_array_length(v_first_card -> 'guesses') = 2, 'Q: one guess entry per eligible guesser';

  v_guesses := v_first_card -> 'guesses';
  assert exists (
    select 1 from jsonb_array_elements(v_guesses) g
    where (g ->> 'submitted')::boolean and (g ->> 'correct')::boolean and (g ->> 'position')::int = 1
  ), 'Q: the exact-match guesser is shown as correct at position 1';
  assert exists (
    select 1 from jsonb_array_elements(v_guesses) g
    where (g ->> 'submitted')::boolean and not (g ->> 'correct')::boolean
  ), 'Q: the cyclic-shift guesser is shown as incorrect';

  -- a Guesser must never receive this breakdown
  v_state := public.get_game_state(v_code, v_other1);
  assert v_state -> 'reveal' -> 'rankerBreakdown' = 'null'::jsonb,
    'Q: a Guesser must not receive anyone''s per-card guesses';

  raise notice 'TEST Q passed — Ranker-only per-card guess breakdown';
end $$;

-- ===========================================================================
-- TEST R — a non-submitter appears in the Ranker's breakdown as not submitted,
--          never as a wrong guess with a fabricated position
-- ===========================================================================
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_tok text;
  v_order text[];
  v_g public.games;
  v_state jsonb;
  v_first_card jsonb;
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en',
    '{"totalCycles":1,"guesserSeconds":30}'::jsonb) ->> 'roomCode');
  perform public.join_room(v_code, 't-bob', 'Bob', 'en');
  perform public.join_room(v_code, 't-carol', 'Carol', 'en');
  perform public.start_game(v_code, 't-alice');

  v_tok := pg_temp.ranker_token(v_code);
  perform public.accept_cards(v_code, v_tok);
  v_order := pg_temp.turn_order(v_code);
  perform public.submit_ranking(v_code, v_tok, v_order);

  -- nobody guesses; the deadline elapses
  select * into v_g from public.games where room_code = v_code;
  update public.games set phase_deadline_at = now() - interval '1 second' where id = v_g.id;
  perform public.advance_game_if_needed(v_code, v_tok);

  v_state := public.get_game_state(v_code, v_tok);
  v_first_card := v_state -> 'reveal' -> 'rankerBreakdown' -> 0;

  assert jsonb_array_length(v_first_card -> 'guesses') = 2, 'R: both non-submitters appear';
  assert not exists (
    select 1 from jsonb_array_elements(v_first_card -> 'guesses') g
    where (g ->> 'submitted')::boolean
  ), 'R: nobody submitted, so nobody is marked submitted';
  assert not exists (
    select 1 from jsonb_array_elements(v_first_card -> 'guesses') g
    where g -> 'position' <> 'null'::jsonb
  ), 'R: a non-submitter never gets a fabricated guessed position';
  assert not exists (
    select 1 from jsonb_array_elements(v_first_card -> 'guesses') g
    where (g ->> 'correct')::boolean
  ), 'R: a non-submitter is never shown as correct';

  raise notice 'TEST R passed — non-submitters show up honestly in the breakdown';
end $$;

-- ===========================================================================
-- TEST S — repeating a previous turn's cards
-- ===========================================================================
delete from public.rate_limits;

do $$
declare
  v_code text;
  v_other_code text;
  v_ranker1 text;
  v_ranker2 text;
  v_order1 text[];
  v_turn1_id uuid;
  v_turn2_id uuid;
  v_list jsonb;
  v_current text[];
  v_err text;
  v_foreign_turn uuid;
begin
  v_code := (public.create_room('t-alice', 'Alice', 'en', '{"totalCycles":2}'::jsonb) ->> 'roomCode');
  perform public.join_room(v_code, 't-bob', 'Bob', 'en');
  perform public.join_room(v_code, 't-carol', 'Carol', 'en');
  perform public.start_game(v_code, 't-alice');

  v_ranker1 := pg_temp.ranker_token(v_code);
  select current_turn_id into v_turn1_id from public.games where room_code = v_code;

  perform public.accept_cards(v_code, v_ranker1);
  v_order1 := pg_temp.turn_order(v_code);
  perform public.submit_ranking(v_code, v_ranker1, v_order1);
  perform pg_temp.all_guessers_submit_exact(v_code);

  update public.games set phase_deadline_at = now() - interval '1 second' where room_code = v_code;
  perform public.advance_game_if_needed(v_code, 't-alice');

  -- turn 2: the new Ranker can see turn 1's five cards, in the Ranker's own order
  v_ranker2 := pg_temp.ranker_token(v_code);
  select current_turn_id into v_turn2_id from public.games where room_code = v_code;

  v_list := public.list_previous_turn_card_sets(v_code, v_ranker2);
  assert jsonb_array_length(v_list) = 1, 'S: exactly one prior turn is listed';
  assert (v_list -> 0 ->> 'turnId')::uuid = v_turn1_id, 'S: it is turn 1';
  assert (v_list -> 0 ->> 'turnNumber')::int = 1, 'S: with the right turn number';
  assert jsonb_array_length(v_list -> 0 -> 'cards') = 5, 'S: and its five cards';

  -- the current turn itself must never appear in its own list
  assert not exists (
    select 1 from jsonb_array_elements(v_list) e where (e ->> 'turnId')::uuid = v_turn2_id
  ), 'S: the in-progress turn is excluded from its own list';

  perform public.repeat_previous_turn_cards(v_code, v_ranker2, v_turn1_id);

  select array_agg(tc.canonical_id order by tc.slot) into v_current
  from public.games g join public.turn_cards tc on tc.turn_id = g.current_turn_id
  where g.room_code = v_code;
  assert v_current = v_order1, 'S: the current turn now has turn 1''s exact five cards';

  -- turn 1's own cards are untouched
  assert (
    select array_agg(tc.canonical_id order by tc.slot) from public.turn_cards tc
    where tc.turn_id = v_turn1_id
  ) = v_order1, 'S: repeating never mutates the source turn';

  -- a modified client cannot repeat a turn from a different game
  v_other_code := (public.create_room('t-dave', 'Dave', 'en', '{}'::jsonb) ->> 'roomCode');
  perform public.join_room(v_other_code, 't-erin', 'Erin', 'en');
  perform public.start_game(v_other_code, 't-dave');
  select current_turn_id into v_foreign_turn from public.games where room_code = v_other_code;

  v_err := null;
  begin
    perform public.repeat_previous_turn_cards(v_code, v_ranker2, v_foreign_turn);
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'CARD_NOT_FOUND', format('S: a foreign-game turn is rejected, got %s', v_err);

  -- and cannot repeat the current turn onto itself
  v_err := null;
  begin
    perform public.repeat_previous_turn_cards(v_code, v_ranker2, v_turn2_id);
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'CARD_NOT_FOUND', format('S: repeating the current turn itself is rejected, got %s', v_err);

  -- only the Ranker of the CURRENT turn may do this
  v_err := null;
  begin
    perform public.repeat_previous_turn_cards(v_code, (
      select 't-' || lower(p.display_name) from public.players p
      where p.game_id = (select id from public.games where room_code = v_code)
        and p.id <> (select ranker_player_id from public.game_turns where id = v_turn2_id)
      limit 1
    ), v_turn1_id);
  exception when others then v_err := sqlerrm; end;
  assert v_err in ('NOT_RANKER', 'WRONG_PHASE'), format('S: only the current Ranker may repeat, got %s', v_err);

  raise notice 'TEST S passed — repeating a previous turn''s cards';
end $$;

rollback;

\echo ''
\echo 'All database integration tests passed.'
