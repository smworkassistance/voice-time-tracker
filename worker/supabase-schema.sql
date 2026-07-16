-- Voice Time Tracker: activity log table.
-- Run this once in the Supabase SQL Editor for the "chain-app" project.
-- Table is namespaced (voice_tracker_ prefix) so it can't collide with that
-- project's existing tables.

create table if not exists voice_tracker_activities (
  id text primary key,
  day_key date not null,
  name text not null,
  tag text,
  raw_text text,
  start_ms bigint not null,
  end_ms bigint not null,
  duration_ms bigint not null,
  created_at timestamptz default now()
);

create index if not exists voice_tracker_activities_day_key_idx on voice_tracker_activities (day_key);

-- RLS enabled with zero policies = denies all access via the public anon/authenticated
-- keys. Only the Worker's service_role key (which always bypasses RLS) can reach this
-- table, so even if the anon key ever leaked, this data stays inaccessible.
alter table voice_tracker_activities enable row level security;

-- Single-row table mirroring whatever activity is CURRENTLY running (not yet a
-- finished lap), so a second device can pick up "something is running" without
-- waiting for it to end. Always exactly one row, id = 'singleton'.
create table if not exists voice_tracker_current_state (
  id text primary key,
  activity_id text,
  name text,
  tag text,
  raw_text text,
  start_ms bigint,
  updated_at bigint not null
);

alter table voice_tracker_current_state enable row level security;
grant usage on schema public to service_role;
grant all on table voice_tracker_current_state to service_role;
