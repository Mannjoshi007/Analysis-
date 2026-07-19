-- ─────────────────────────────────────────────────────────────
-- KC DAQ Flight Test Analysis — Supabase Schema (Dynamic / Flight Tests)
-- This is ADDITIVE — it does not touch the existing test_sessions table
-- used by the static motor test system. Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ynhdsdlkmkumcozccrdg/sql
-- ─────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ─── flight_sessions table ─────────────────────────────────────
create table if not exists public.flight_sessions (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  name              text not null default 'Unnamed Flight',
  filename          text not null default '',
  is_public         boolean not null default true,

  -- Quick-access columns (indexed for fast queries)
  apogee_m          double precision,
  max_climb_rate    double precision,
  max_descent_rate  double precision,
  max_accel_g       double precision,
  deploy_alt_m      double precision,
  flight_duration   double precision,
  sample_rate       double precision,
  total_samples     integer,
  descent_verdict   text,

  -- Full computed stats (JSON)
  stats             jsonb,

  -- Raw data for chart re-rendering on shared reports
  raw_data          jsonb
);

-- ─── Indexes ────────────────────────────────────────────────
create index if not exists idx_flight_sessions_created_at on public.flight_sessions(created_at desc);

-- ─── Row Level Security ─────────────────────────────────────
-- Same public, no-auth policy shape as test_sessions
alter table public.flight_sessions enable row level security;

create policy "Public flight sessions are readable by anyone"
  on public.flight_sessions for select
  using (is_public = true);

create policy "Anyone can insert flight sessions"
  on public.flight_sessions for insert
  with check (true);

create policy "Anyone can delete flight sessions"
  on public.flight_sessions for delete
  using (true);

-- ─── Verification ───────────────────────────────────────────
-- After running, verify with:
-- select count(*) from public.flight_sessions;
