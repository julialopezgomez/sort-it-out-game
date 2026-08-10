-- ============================================================================
-- Sort It Out — 0010_schema.sql
-- Enums, tables, constraints and indexes.
--
-- Design notes
-- ------------
-- * Postgres is the only source of truth. Clients never compute scores, deadlines,
--   roles or phases; they submit intent to RPCs and read back role-filtered state.
-- * A "canonical card id" is a text handle that is stable across languages:
--       'f:<factory slug>'   or   'c:<custom card uuid>'
--   Clients order canonical ids; the database resolves them to turn_cards rows.
-- * Only public.room_events is exposed to Realtime, and it never carries secrets.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.game_phase as enum (
    'lobby',
    'preparing_cards',
    'ranker_ordering',
    'guessers_ordering',
    'reveal',
    'paused',
    'next_turn',
    'finished',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pause_reason as enum ('manual', 'ranker_disconnected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.card_source as enum ('factory', 'custom');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ranking_role as enum ('ranker', 'guesser');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.turn_status as enum ('active', 'scored', 'skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.skip_kind as enum ('voluntary', 'host_disconnected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ui_language as enum ('en', 'es');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------
create table if not exists public.games (
  id                    uuid primary key default gen_random_uuid(),
  room_code             text not null,
  phase                 public.game_phase not null default 'lobby',

  -- settings (host editable while in lobby)
  total_cycles          integer not null default 2,
  ranker_seconds        integer,               -- null = unlimited
  guesser_seconds       integer,               -- null = unlimited
  allow_manual_cards    boolean not null default true,

  -- progress
  current_cycle         integer not null default 0,
  current_turn_number   integer not null default 0,
  current_turn_id       uuid,
  rotation_size         integer not null default 0,   -- next rotation_position to hand out

  -- timing. phase_deadline_at is null for unlimited phases.
  phase_started_at      timestamptz,
  phase_deadline_at     timestamptz,

  -- pausing
  paused_at             timestamptz,
  paused_from_phase     public.game_phase,
  pause_reason_code     public.pause_reason,
  remaining_ms          integer,               -- preserved remainder, null when unlimited

  -- cooperative totals
  group_points          integer not null default 0,
  game_points           integer not null default 0,
  possible_points       integer not null default 0,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  started_at            timestamptz,
  finished_at           timestamptz,
  last_activity_at      timestamptz not null default now(),

  constraint games_room_code_format check (room_code ~ '^[A-Z2-9]{6}$'),
  constraint games_total_cycles_range check (total_cycles between 1 and 10),
  constraint games_ranker_seconds_range check (ranker_seconds is null or ranker_seconds between 5 and 3600),
  constraint games_guesser_seconds_range check (guesser_seconds is null or guesser_seconds between 5 and 3600),
  constraint games_remaining_ms_positive check (remaining_ms is null or remaining_ms >= 0)
);

create unique index if not exists games_room_code_key on public.games (room_code);
create index if not exists games_phase_idx on public.games (phase);
create index if not exists games_last_activity_idx on public.games (last_activity_at desc);

-- ---------------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------------
create table if not exists public.players (
  id                            uuid primary key default gen_random_uuid(),
  game_id                       uuid not null references public.games (id) on delete cascade,
  display_name                  text not null,
  normalized_name               text not null,
  language                      public.ui_language not null default 'en',
  -- sha256 of the invisible browser credential. Never the credential itself.
  session_hash                  text not null,
  is_host                       boolean not null default false,

  rotation_position             integer not null,
  -- A player is eligible to guess on turns with turn_number > eligible_from_turn.
  eligible_from_turn            integer not null default 0,

  pending_zero_score_penalties  integer not null default 0,
  total_score                   integer not null default 0,
  scored_guesser_turns          integer not null default 0,
  ranker_turns_completed        integer not null default 0,
  ranker_turns_skipped          integer not null default 0,
  consumed_penalties            integer not null default 0,

  last_seen_at                  timestamptz not null default now(),
  created_at                    timestamptz not null default now(),
  left_at                       timestamptz,

  constraint players_display_name_length check (char_length(display_name) between 1 and 24),
  constraint players_penalties_non_negative check (pending_zero_score_penalties >= 0),
  constraint players_scores_non_negative check (total_score >= 0 and scored_guesser_turns >= 0)
);

create unique index if not exists players_game_name_key
  on public.players (game_id, normalized_name);
create unique index if not exists players_game_rotation_key
  on public.players (game_id, rotation_position);
create index if not exists players_game_idx on public.players (game_id);
create index if not exists players_last_seen_idx on public.players (game_id, last_seen_at desc);

-- games.host_player_id added after players exists
alter table public.games
  add column if not exists host_player_id uuid references public.players (id) on delete set null;

-- "Play again" chains one game to the next. Members learn the new room code through
-- get_game_state; it is never broadcast over Realtime.
alter table public.games
  add column if not exists next_game_id uuid references public.games (id) on delete set null;

-- ---------------------------------------------------------------------------
-- factory_cards — immutable bilingual dictionary shipped with the app
-- ---------------------------------------------------------------------------
create table if not exists public.factory_cards (
  id          text primary key,
  text_en     text not null,
  text_es     text not null,
  is_enabled  boolean not null default true,
  created_at  timestamptz not null default now(),

  constraint factory_cards_text_en_len check (char_length(text_en) between 1 and 80),
  constraint factory_cards_text_es_len check (char_length(text_es) between 1 and 80)
);

create index if not exists factory_cards_enabled_idx on public.factory_cards (is_enabled);

-- ---------------------------------------------------------------------------
-- game_custom_cards — per-game custom dictionary (imported CSV + manual terms)
-- ---------------------------------------------------------------------------
create table if not exists public.game_custom_cards (
  id                  uuid primary key default gen_random_uuid(),
  game_id             uuid not null references public.games (id) on delete cascade,
  text_en             text,
  text_es             text,
  normalized_key      text not null,
  created_by_player   uuid references public.players (id) on delete set null,
  is_enabled          boolean not null default true,
  created_at          timestamptz not null default now(),

  constraint custom_cards_at_least_one_language
    check (coalesce(text_en, '') <> '' or coalesce(text_es, '') <> ''),
  constraint custom_cards_text_en_len check (text_en is null or char_length(text_en) <= 80),
  constraint custom_cards_text_es_len check (text_es is null or char_length(text_es) <= 80)
);

create unique index if not exists custom_cards_game_key_uniq
  on public.game_custom_cards (game_id, normalized_key);
create index if not exists custom_cards_game_idx on public.game_custom_cards (game_id, is_enabled);

-- ---------------------------------------------------------------------------
-- game_turns
-- ---------------------------------------------------------------------------
create table if not exists public.game_turns (
  id                      uuid primary key default gen_random_uuid(),
  game_id                 uuid not null references public.games (id) on delete cascade,
  turn_number             integer not null,
  cycle_number            integer not null,
  ranker_player_id        uuid not null references public.players (id) on delete cascade,
  status                  public.turn_status not null default 'active',

  cards_accepted_at       timestamptz,
  ranker_submitted_at     timestamptz,
  guessing_started_at     timestamptz,
  revealed_at             timestamptz,
  completed_at            timestamptz,

  skipped                 boolean not null default false,
  skip_kind               public.skip_kind,

  eligible_guesser_count  integer not null default 0,
  possible_points         integer not null default 0,
  group_points            integer not null default 0,
  game_points             integer not null default 0,
  scored_at               timestamptz,

  created_at              timestamptz not null default now(),

  constraint game_turns_turn_number_positive check (turn_number > 0),
  constraint game_turns_cycle_positive check (cycle_number > 0)
);

create unique index if not exists game_turns_game_turn_key
  on public.game_turns (game_id, turn_number);
create index if not exists game_turns_game_idx on public.game_turns (game_id);
create index if not exists game_turns_ranker_idx on public.game_turns (ranker_player_id);

alter table public.games
  drop constraint if exists games_current_turn_fk;
alter table public.games
  add constraint games_current_turn_fk
  foreign key (current_turn_id) references public.game_turns (id) on delete set null;

-- ---------------------------------------------------------------------------
-- turn_cards — the five slots of a turn
-- ---------------------------------------------------------------------------
create table if not exists public.turn_cards (
  id                uuid primary key default gen_random_uuid(),
  turn_id           uuid not null references public.game_turns (id) on delete cascade,
  slot              integer not null,
  source            public.card_source not null,
  factory_card_id   text references public.factory_cards (id) on delete restrict,
  custom_card_id    uuid references public.game_custom_cards (id) on delete restrict,
  canonical_id      text not null,
  created_at        timestamptz not null default now(),

  constraint turn_cards_slot_range check (slot between 1 and 5),
  constraint turn_cards_exactly_one_source check (
    (source = 'factory' and factory_card_id is not null and custom_card_id is null)
    or
    (source = 'custom' and custom_card_id is not null and factory_card_id is null)
  )
);

create unique index if not exists turn_cards_turn_slot_key on public.turn_cards (turn_id, slot);
create unique index if not exists turn_cards_turn_canonical_key
  on public.turn_cards (turn_id, canonical_id);

-- ---------------------------------------------------------------------------
-- rankings / ranking_items
-- ---------------------------------------------------------------------------
create table if not exists public.rankings (
  id                uuid primary key default gen_random_uuid(),
  turn_id           uuid not null references public.game_turns (id) on delete cascade,
  player_id         uuid not null references public.players (id) on delete cascade,
  role              public.ranking_role not null,
  submitted_at      timestamptz,
  is_locked         boolean not null default false,
  auto_submitted    boolean not null default false,

  raw_score         integer,
  awarded_score     integer,
  penalty_applied   boolean not null default false,
  scored_at         timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint rankings_raw_score_range check (raw_score is null or raw_score between 0 and 5),
  constraint rankings_awarded_score_range check (awarded_score is null or awarded_score between 0 and 5)
);

create unique index if not exists rankings_turn_player_key on public.rankings (turn_id, player_id);
create index if not exists rankings_turn_idx on public.rankings (turn_id);

create table if not exists public.ranking_items (
  id            uuid primary key default gen_random_uuid(),
  ranking_id    uuid not null references public.rankings (id) on delete cascade,
  turn_card_id  uuid not null references public.turn_cards (id) on delete cascade,
  position      integer not null,

  constraint ranking_items_position_range check (position between 1 and 5)
);

create unique index if not exists ranking_items_ranking_card_key
  on public.ranking_items (ranking_id, turn_card_id);
create unique index if not exists ranking_items_ranking_position_key
  on public.ranking_items (ranking_id, position);

-- ---------------------------------------------------------------------------
-- score_events — append-only audit trail; also the scoring idempotency guard
-- ---------------------------------------------------------------------------
create table if not exists public.score_events (
  id                  uuid primary key default gen_random_uuid(),
  game_id             uuid not null references public.games (id) on delete cascade,
  turn_id             uuid not null references public.game_turns (id) on delete cascade,
  player_id           uuid references public.players (id) on delete cascade,
  event_type          text not null,
  raw_score           integer,
  awarded_score       integer,
  penalty_applied     boolean not null default false,
  submitted           boolean not null default false,
  group_points_delta  integer not null default 0,
  game_points_delta   integer not null default 0,
  detail              jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- One scoring event per (turn, player, type): makes calculate_score idempotent even if
-- two clients race to trigger the same transition.
create unique index if not exists score_events_turn_player_type_key
  on public.score_events (turn_id, coalesce(player_id, '00000000-0000-0000-0000-000000000000'::uuid), event_type);
create index if not exists score_events_game_idx on public.score_events (game_id, created_at);

-- ---------------------------------------------------------------------------
-- room_events — the ONLY Realtime-published table. Non-secret notifications only.
--
-- Note what is NOT here: no room_code, no player names, no card text, no scores.
-- Clients subscribe by game_id (a uuid they can only learn from an authorized RPC),
-- and every event is just a hint to refetch.
-- ---------------------------------------------------------------------------
create table if not exists public.room_events (
  id          bigserial primary key,
  game_id     uuid not null references public.games (id) on delete cascade,
  event_type  text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists room_events_game_idx on public.room_events (game_id, id desc);
create index if not exists room_events_created_idx on public.room_events (created_at);

-- ---------------------------------------------------------------------------
-- game_results — durable summary of a finished game, retrievable by room code
-- ---------------------------------------------------------------------------
create table if not exists public.game_results (
  game_id     uuid primary key references public.games (id) on delete cascade,
  room_code   text not null,
  summary     jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists game_results_room_code_idx on public.game_results (room_code);

-- ---------------------------------------------------------------------------
-- rate_limits — crude fixed-window counters, enough to blunt accidental abuse
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  bucket        text not null,
  subject       text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (bucket, subject, window_start)
);

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists games_touch_updated_at on public.games;
create trigger games_touch_updated_at
  before update on public.games
  for each row execute function public.touch_updated_at();

drop trigger if exists rankings_touch_updated_at on public.rankings;
create trigger rankings_touch_updated_at
  before update on public.rankings
  for each row execute function public.touch_updated_at();
