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
grant usage on schema public to service_role;
grant all on table voice_tracker_activities to service_role;

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

-- Behavior Intelligence: long-term memory for the reasoning engine.
-- "statement" is free text (not an enum/fixed relationship type) because
-- Gemini generates hypotheses open-endedly -- the schema can't predict what
-- shape a relationship will take, only how to track its lifecycle/evidence.
create table if not exists voice_tracker_hypotheses (
  id text primary key,
  statement text not null,
  confidence text not null, -- 'low' | 'medium' | 'high'
  status text not null default 'candidate', -- 'candidate' | 'confirmed' | 'retired'
  evidence text,
  created_at timestamptz default now(),
  last_reviewed_at timestamptz default now()
);

alter table voice_tracker_hypotheses enable row level security;
grant usage on schema public to service_role;
grant all on table voice_tracker_hypotheses to service_role;

-- Context the reasoning engine asked for directly (mood, energy, reasons) that
-- can't be inferred from timestamps alone -- feeds back into the next
-- reasoning pass so the same question is never asked twice.
create table if not exists voice_tracker_context_answers (
  id text primary key,
  question text not null,
  answer text not null,
  hypothesis_id text references voice_tracker_hypotheses(id) on delete set null,
  created_at timestamptz default now()
);

alter table voice_tracker_context_answers enable row level security;
grant usage on schema public to service_role;
grant all on table voice_tracker_context_answers to service_role;
