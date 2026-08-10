-- ============================================================================
-- Sort It Out — 0020_security.sql
--
-- The browser only ever holds the *public* anon key, so the database has to assume
-- every request is hostile-ish. The rule enforced here is blunt and easy to audit:
--
--   anon and authenticated get NO direct access to any game table (not even SELECT),
--   with a single exception: public.room_events, which carries no secrets at all.
--
-- Everything else happens through SECURITY DEFINER RPCs (0040-0070) that validate
-- room, player identity, phase and role before touching a row.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Blanket revokes. Supabase grants broad table access to anon/authenticated by
-- default; take it all back.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- New objects created later must not silently re-grant.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- The RPCs are called *as* anon, so the role still needs to reach the schema itself.
grant usage on schema public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security. Enabled everywhere. Because SECURITY DEFINER functions are
-- owned by the privileged migration role (and that role is not RLS-forced), the RPCs
-- keep working while direct client access stays at zero.
-- ---------------------------------------------------------------------------
alter table public.games              enable row level security;
alter table public.players            enable row level security;
alter table public.factory_cards      enable row level security;
alter table public.game_custom_cards  enable row level security;
alter table public.game_turns         enable row level security;
alter table public.turn_cards         enable row level security;
alter table public.rankings           enable row level security;
alter table public.ranking_items      enable row level security;
alter table public.score_events       enable row level security;
alter table public.room_events        enable row level security;
alter table public.game_results       enable row level security;
alter table public.rate_limits        enable row level security;

-- Force RLS so that even a mistakenly-granted future privilege cannot leak
-- secret rankings through a plain SELECT.
alter table public.rankings           force row level security;
alter table public.ranking_items      force row level security;
alter table public.turn_cards         force row level security;

-- ---------------------------------------------------------------------------
-- The one readable table: room_events.
--
-- Realtime evaluates RLS as the subscribing role, so anon needs SELECT here for
-- `postgres_changes` to deliver anything. This is safe *by construction*: RPCs are
-- forbidden (by convention and by review) from writing names, card text, rankings or
-- scores into room_events.payload. Payloads only ever carry counters and phase names,
-- which is exactly enough for a client to know "refetch now".
-- ---------------------------------------------------------------------------
drop policy if exists room_events_read on public.room_events;
create policy room_events_read
  on public.room_events
  for select
  to anon, authenticated
  using (true);

grant select on public.room_events to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'room_events'
    ) then
      execute 'alter publication supabase_realtime add table public.room_events';
    end if;
  else
    -- Local / self-hosted Postgres without Supabase Realtime installed.
    create publication supabase_realtime for table public.room_events;
  end if;
end $$;

-- Realtime needs the full row to build the change payload.
alter table public.room_events replica identity full;
