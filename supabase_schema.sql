-- MannMitra check-in history table.
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> Run.

create table if not exists public.checkins (
  id             uuid primary key default gen_random_uuid(),
  anon_id        text not null,
  created_at     timestamptz not null default now(),
  mood           int,
  exam           text,
  days_to_exam   int,
  sleep_hours    numeric,
  journal        text,
  emotion        text,
  wellness_score int,
  wellness_state text,
  triggers       jsonb not null default '[]'::jsonb,
  source         text,
  crisis         boolean not null default false
);

-- Fast lookups of one user's recent history.
create index if not exists checkins_anon_created_idx
  on public.checkins (anon_id, created_at desc);

-- Lock the table down: enable RLS and add NO public policies.
-- The backend uses the secret service_role key, which bypasses RLS,
-- so only the server can read/write. The public anon key cannot.
alter table public.checkins enable row level security;
