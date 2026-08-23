-- ==============================================
-- Migration 010 — Cache fetched OHLCV on the session row
-- Run in Supabase Dashboard SQL Editor
-- ==============================================
-- Written once after the first Twelve Data fetch. Resumed sessions load
-- candles from this column instead of hitting the API again (zero credits).

alter table public.replay_sessions add column if not exists candles jsonb;
