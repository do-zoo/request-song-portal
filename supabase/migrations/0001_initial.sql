-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Event status and request status enums
create type event_status as enum ('open', 'closed', 'paused');
create type request_status as enum ('pending', 'playing', 'played', 'skipped');

-- Events created by host
create table events (
  id            uuid primary key default gen_random_uuid(),
  pin           varchar(6) not null unique,
  name          varchar(100) not null,
  spotify_token jsonb,
  status        event_status not null default 'paused',
  settings      jsonb not null default '{"max_requests":3,"cooldown_minutes":10,"max_duration_ms":600000,"allow_explicit":true}',
  created_at    timestamptz not null default now()
);

-- Participant sessions per event
create table event_participants (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  nickname      varchar(30) not null,
  session_token varchar not null unique,
  request_count int not null default 0,
  last_played_at timestamptz,
  joined_at     timestamptz not null default now(),
  unique (event_id, nickname)
);

-- Song requests queue
create table song_requests (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  participant_id    uuid not null references event_participants(id) on delete cascade,
  spotify_track_id  varchar not null,
  track_name        varchar not null,
  artist_name       varchar not null,
  album_art_url     varchar not null,
  duration_ms       int not null,
  requested_by      varchar not null,
  status            request_status not null default 'pending',
  position          int not null default 0,
  requested_at      timestamptz not null default now()
);

create index song_requests_event_status on song_requests(event_id, status);

-- Blacklisted tracks per event
create table blacklisted_tracks (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  spotify_track_id  varchar not null,
  track_name        varchar not null,
  added_at          timestamptz not null default now(),
  unique (event_id, spotify_track_id)
);

-- IP/session rate limiting
create table rate_limits (
  id           uuid primary key default gen_random_uuid(),
  identifier   varchar not null,
  action       varchar not null,
  count        int not null default 1,
  window_start timestamptz not null default now()
);

create index rate_limits_lookup on rate_limits(identifier, action, window_start);

-- RLS: Enable on all tables. Service role bypasses everything.
-- Anon key needs SELECT on song_requests for Supabase Realtime subscriptions.
alter table events enable row level security;
alter table event_participants enable row level security;
alter table song_requests enable row level security;
alter table blacklisted_tracks enable row level security;
alter table rate_limits enable row level security;

-- Allow anon to read song_requests (needed for Supabase Realtime with anon key)
create policy "anon can read song_requests"
  on song_requests for select using (true);

-- Allow anon to read blacklisted_tracks
create policy "anon can read blacklisted_tracks"
  on blacklisted_tracks for select using (true);
