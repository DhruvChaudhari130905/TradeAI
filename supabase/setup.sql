-- ==============================================
-- TradeAI — Full Database Setup
-- Run this in the Supabase Dashboard SQL Editor
-- ==============================================

-- === 1. PROFILES ===
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique,
  avatar_url text,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "Users can delete own profile" on public.profiles;
create policy "Users can delete own profile" on public.profiles for delete using (auth.uid() = id);

-- === 2. TRADES ===
create table if not exists public.trades (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  pair text not null,
  market text not null check (market in ('forex', 'crypto')),
  direction text not null check (direction in ('long', 'short')),
  entry_price numeric not null,
  exit_price numeric,
  stop_loss numeric,
  take_profit numeric,
  lot_size numeric,
  risk_reward_ratio numeric,
  outcome text check (outcome in ('win', 'loss', 'breakeven', 'open')),
  pnl_usd numeric,
  pnl_pips numeric,
  entry_time timestamptz,
  exit_time timestamptz,
  session text check (session in ('london', 'new_york', 'asian', 'overlap', 'other')),
  notes text,
  screenshot_urls text[],
  tags text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.trades enable row level security;
drop policy if exists "Users can view own trades" on public.trades;
create policy "Users can view own trades" on public.trades for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own trades" on public.trades;
create policy "Users can insert own trades" on public.trades for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own trades" on public.trades;
create policy "Users can update own trades" on public.trades for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete own trades" on public.trades;
create policy "Users can delete own trades" on public.trades for delete using (auth.uid() = user_id);

-- Auto-update updated_at trigger
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
drop trigger if exists set_updated_at on public.trades;
create trigger set_updated_at before update on public.trades for each row execute function public.handle_updated_at();

-- === 3. TRADE REVIEWS ===
create table if not exists public.trade_reviews (
  id uuid default gen_random_uuid() primary key,
  trade_id uuid references public.trades(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  prop_firm_evaluator jsonb,
  trading_psychologist jsonb,
  institutional_trader jsonb,
  quantitative_analyst jsonb,
  risk_manager jsonb,
  composite_score numeric,
  created_at timestamptz default now()
);
alter table public.trade_reviews enable row level security;
drop policy if exists "Users can view own reviews" on public.trade_reviews;
create policy "Users can view own reviews" on public.trade_reviews for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own reviews" on public.trade_reviews;
create policy "Users can insert own reviews" on public.trade_reviews for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own reviews" on public.trade_reviews;
create policy "Users can update own reviews" on public.trade_reviews for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete own reviews" on public.trade_reviews;
create policy "Users can delete own reviews" on public.trade_reviews for delete using (auth.uid() = user_id);

-- === 4. BACKTEST RUNS ===
create table if not exists public.backtest_runs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  strategy_name text,
  strategy_doc_url text,
  market text not null check (market in ('forex', 'crypto')),
  pair text not null,
  timeframe text not null,
  date_from date,
  date_to date,
  starting_capital numeric default 10000,
  status text default 'pending' check (status in ('pending', 'running', 'complete', 'error')),
  result jsonb,
  ai_report text,
  created_at timestamptz default now()
);
alter table public.backtest_runs enable row level security;
drop policy if exists "Users can view own backtests" on public.backtest_runs;
create policy "Users can view own backtests" on public.backtest_runs for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own backtests" on public.backtest_runs;
create policy "Users can insert own backtests" on public.backtest_runs for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own backtests" on public.backtest_runs;
create policy "Users can update own backtests" on public.backtest_runs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete own backtests" on public.backtest_runs;
create policy "Users can delete own backtests" on public.backtest_runs for delete using (auth.uid() = user_id);

-- === 5. OHLCV CACHE ===
create table if not exists public.ohlcv_cache (
  id uuid default gen_random_uuid() primary key,
  pair text not null,
  market text not null check (market in ('forex', 'crypto')),
  timeframe text not null,
  date_from date not null,
  date_to date not null,
  data jsonb not null,
  fetched_at timestamptz default now()
);
alter table public.ohlcv_cache enable row level security;
drop policy if exists "Authenticated users can read ohlcv_cache" on public.ohlcv_cache;
create policy "Authenticated users can read ohlcv_cache" on public.ohlcv_cache for select using (auth.role() = 'authenticated');
alter table public.ohlcv_cache drop constraint if exists ohlcv_cache_pair_market_tf_dates_unique;
alter table public.ohlcv_cache add constraint ohlcv_cache_pair_market_tf_dates_unique unique (pair, market, timeframe, date_from, date_to);

-- === 5b. REPLAY SESSIONS (manual replay trading) ===
create table if not exists public.replay_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  pair text not null,
  market text not null check (market in ('forex', 'crypto')),
  timeframes jsonb not null default '[]'::jsonb,          -- e.g. ["15m","4H","1D"], primary (lowest) first
  date_from date not null,
  date_to date not null,
  starting_balance numeric not null default 10000,
  leverage numeric not null default 100,
  spread_pips numeric not null default 1,
  status text not null default 'active' check (status in ('active', 'complete', 'abandoned')),
  cursor_index int not null default 0,                    -- index into primary-TF candle array
  balance numeric not null default 10000,                 -- realized balance
  positions jsonb not null default '[]'::jsonb,
  orders jsonb not null default '[]'::jsonb,
  drawings jsonb not null default '[]'::jsonb,
  indicator_configs jsonb not null default '[]'::jsonb,
  closed_trades jsonb not null default '[]'::jsonb,
  equity_curve jsonb not null default '[]'::jsonb,        -- [{time, equity, balance}]
  chat_messages jsonb not null default '[]'::jsonb,       -- [{role, content, created_at}]
  personality_reviews jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.replay_sessions enable row level security;
drop policy if exists "Users can view own replay sessions" on public.replay_sessions;
create policy "Users can view own replay sessions" on public.replay_sessions for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own replay sessions" on public.replay_sessions;
create policy "Users can insert own replay sessions" on public.replay_sessions for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own replay sessions" on public.replay_sessions;
create policy "Users can update own replay sessions" on public.replay_sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete own replay sessions" on public.replay_sessions;
create policy "Users can delete own replay sessions" on public.replay_sessions for delete using (auth.uid() = user_id);

drop trigger if exists set_updated_at on public.replay_sessions;
create trigger set_updated_at before update on public.replay_sessions for each row execute function public.handle_updated_at();

-- Trades: distinguish live vs backtested trades, link to replay session
alter table public.trades add column if not exists source text not null default 'live';
alter table public.trades drop constraint if exists trades_source_check;
alter table public.trades add constraint trades_source_check check (source in ('live', 'backtest'));
alter table public.trades add column if not exists session_id uuid references public.replay_sessions(id) on delete set null;

create index if not exists trades_session_id_idx on public.trades(session_id);

-- === 6. DASHBOARD INSIGHTS ===
create table if not exists public.dashboard_insights (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  insights jsonb not null default '[]'::jsonb,
  created_at timestamptz default now() not null,
  constraint dashboard_insights_user_id_key unique (user_id)
);
alter table public.dashboard_insights enable row level security;
drop policy if exists "Users can read own insights" on public.dashboard_insights;
create policy "Users can read own insights" on public.dashboard_insights for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own insights" on public.dashboard_insights;
create policy "Users can insert own insights" on public.dashboard_insights for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own insights" on public.dashboard_insights;
create policy "Users can update own insights" on public.dashboard_insights for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete own insights" on public.dashboard_insights;
create policy "Users can delete own insights" on public.dashboard_insights for delete using (auth.uid() = user_id);

-- === 7. STORAGE BUCKETS ===

-- Trade screenshots bucket (public read, authenticated write)
insert into storage.buckets (id, name, public)
values ('trade-screenshots', 'trade-screenshots', true)
on conflict (id) do nothing;

drop policy if exists "Users can upload trade screenshots" on storage.objects;
create policy "Users can upload trade screenshots"
  on storage.objects for insert
  with check (bucket_id = 'trade-screenshots' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "Users can update their own screenshots" on storage.objects;
create policy "Users can update their own screenshots"
  on storage.objects for update
  using (bucket_id = 'trade-screenshots' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "Users can delete their own screenshots" on storage.objects;
create policy "Users can delete their own screenshots"
  on storage.objects for delete
  using (bucket_id = 'trade-screenshots' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "Trade screenshots are publicly readable" on storage.objects;
create policy "Trade screenshots are publicly readable"
  on storage.objects for select
  using (bucket_id = 'trade-screenshots');

-- Strategy docs bucket (private, authenticated read/write only)
insert into storage.buckets (id, name, public)
values ('strategy-docs', 'strategy-docs', false)
on conflict (id) do nothing;

drop policy if exists "Users can upload strategy docs" on storage.objects;
create policy "Users can upload strategy docs"
  on storage.objects for insert
  with check (bucket_id = 'strategy-docs' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "Users can read their own strategy docs" on storage.objects;
create policy "Users can read their own strategy docs"
  on storage.objects for select
  using (bucket_id = 'strategy-docs' and auth.uid()::text = (storage.foldername(name))[1]);

-- Avatars bucket
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Avatar images are publicly accessible" on storage.objects;
create policy "Avatar images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'avatars');
-- Auto-create a profiles row whenever a user signs up.
-- Replaces the app-side insert, which fails under RLS when email
-- confirmation is pending (no session → auth.uid() is null).

create schema if not exists auth;  -- noop guard, auth schema always exists

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill any users who signed up before this trigger existed
insert into public.profiles (id, username)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

-- ==============================================
-- Migration 010 — Cache fetched OHLCV on the session row
-- ==============================================

alter table public.replay_sessions add column if not exists candles jsonb;
