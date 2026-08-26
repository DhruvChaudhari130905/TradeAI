-- ==============================================
-- Migration 011 — Shared OHLCV candle cache
-- Run in Supabase Dashboard SQL Editor
-- ==============================================
-- Historical candles are immutable: fetch from Twelve Data once, then serve
-- every later session (any user) from this table with zero API credits.
-- Clients get read access only; writes happen exclusively from server code
-- via the service-role client, which bypasses RLS.

create table if not exists public.candle_cache (
  id uuid primary key default gen_random_uuid(),
  pair text not null,
  market text not null,
  timeframe text not null,
  candles jsonb not null default '[]'::jsonb,
  range_from date not null,
  range_to date not null,
  newest_candle_at date,
  updated_at timestamptz not null default now(),
  unique (pair, market, timeframe)
);

alter table public.candle_cache enable row level security;

create policy "candle_cache_public_read"
  on public.candle_cache for select
  using (true);
