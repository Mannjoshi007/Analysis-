-- ─────────────────────────────────────────────────────────────
-- KC DAQ Motor Analysis — Supabase Schema
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ynhdsdlkmkumcozccrdg/sql
-- ─────────────────────────────────────────────────────────────

-- Enable UUID extension (usually already enabled)
create extension if not exists "pgcrypto";

-- ─── test_sessions table ────────────────────────────────────
create table if not exists public.test_sessions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  name          text not null default 'Unnamed Test',
  filename      text not null default '',
  is_public     boolean not null default true,

  -- Quick-access columns (indexed for fast queries)
  motor_class   text,
  total_impulse double precision,
  peak_thrust   double precision,
  avg_thrust    double precision,
  burn_time     double precision,
  avg_temp      double precision,
  isp           double precision,
  sample_rate   double precision,
  burn_samples  integer,
  total_samples integer,
  profile_type  text,
  snr_db        double precision,

  -- Full computed stats (JSON)
  stats         jsonb,

  -- Raw data for chart re-rendering on shared reports
  raw_data      jsonb
);

-- ─── Indexes ────────────────────────────────────────────────
create index if not exists idx_test_sessions_created_at on public.test_sessions(created_at desc);
create index if not exists idx_test_sessions_motor_class on public.test_sessions(motor_class);

-- ─── Row Level Security ─────────────────────────────────────
-- Since this is public (no auth), allow all reads and inserts
alter table public.test_sessions enable row level security;

-- Allow anyone to read public sessions
create policy "Public sessions are readable by anyone"
  on public.test_sessions for select
  using (is_public = true);

-- Allow anyone to insert new sessions (no auth required)
create policy "Anyone can insert sessions"
  on public.test_sessions for insert
  with check (true);

-- Allow anyone to delete sessions (you can tighten this later with auth)
create policy "Anyone can delete sessions"
  on public.test_sessions for delete
  using (true);

-- ─── Verification ───────────────────────────────────────────
-- After running, verify with:
-- select count(*) from public.test_sessions;
