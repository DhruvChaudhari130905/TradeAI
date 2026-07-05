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
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
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
create policy "Users can view own trades" on public.trades for select using (auth.uid() = user_id);
create policy "Users can insert own trades" on public.trades for insert with check (auth.uid() = user_id);
create policy "Users can update own trades" on public.trades for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
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
create policy "Users can view own reviews" on public.trade_reviews for select using (auth.uid() = user_id);
create policy "Users can insert own reviews" on public.trade_reviews for insert with check (auth.uid() = user_id);
create policy "Users can update own reviews" on public.trade_reviews for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
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
create policy "Users can view own backtests" on public.backtest_runs for select using (auth.uid() = user_id);
create policy "Users can insert own backtests" on public.backtest_runs for insert with check (auth.uid() = user_id);
create policy "Users can update own backtests" on public.backtest_runs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
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
create policy "Authenticated users can read ohlcv_cache" on public.ohlcv_cache for select using (auth.role() = 'authenticated');
alter table public.ohlcv_cache add constraint ohlcv_cache_pair_market_tf_dates_unique unique (pair, market, timeframe, date_from, date_to);

-- === 6. DASHBOARD INSIGHTS ===
create table if not exists public.dashboard_insights (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  insights jsonb not null default '[]'::jsonb,
  created_at timestamptz default now() not null,
  constraint dashboard_insights_user_id_key unique (user_id)
);
alter table public.dashboard_insights enable row level security;
create policy "Users can read own insights" on public.dashboard_insights for select using (auth.uid() = user_id);
create policy "Users can insert own insights" on public.dashboard_insights for insert with check (auth.uid() = user_id);
create policy "Users can update own insights" on public.dashboard_insights for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own insights" on public.dashboard_insights for delete using (auth.uid() = user_id);

-- === 7. STORAGE BUCKETS ===

-- Trade screenshots bucket (public read, authenticated write)
insert into storage.buckets (id, name, public)
values ('trade-screenshots', 'trade-screenshots', true)
on conflict (id) do nothing;

create policy "Users can upload trade screenshots"
  on storage.objects for insert
  with check (bucket_id = 'trade-screenshots' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update their own screenshots"
  on storage.objects for update
  using (bucket_id = 'trade-screenshots' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete their own screenshots"
  on storage.objects for delete
  using (bucket_id = 'trade-screenshots' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Trade screenshots are publicly readable"
  on storage.objects for select
  using (bucket_id = 'trade-screenshots');

-- Strategy docs bucket (private, authenticated read/write only)
insert into storage.buckets (id, name, public)
values ('strategy-docs', 'strategy-docs', false)
on conflict (id) do nothing;

create policy "Users can upload strategy docs"
  on storage.objects for insert
  with check (bucket_id = 'strategy-docs' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can read their own strategy docs"
  on storage.objects for select
  using (bucket_id = 'strategy-docs' and auth.uid()::text = (storage.foldername(name))[1]);

-- Avatars bucket
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Avatar images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'avatars');
