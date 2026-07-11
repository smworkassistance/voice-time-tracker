-- Voice Time Tracker: activity log table.
-- Run this once in the Supabase SQL Editor for the shreemant-tools project.

create table if not exists activities (
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

create index if not exists activities_day_key_idx on activities (day_key);

-- RLS enabled with zero policies = denies all access via the public anon/authenticated
-- keys. Only the Worker's service_role key (which always bypasses RLS) can reach this
-- table, so even if the anon key ever leaked, this data stays inaccessible.
alter table activities enable row level security;
