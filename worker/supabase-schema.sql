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
