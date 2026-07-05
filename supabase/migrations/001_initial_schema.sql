-- USERS (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique,
  avatar_url text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;
create policy "Users can view and edit own profile"
  on public.profiles for all using (auth.uid() = id);

-- TRADES
create table public.trades (
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
create policy "Users own their trades"
  on public.trades for all using (auth.uid() = user_id);

-- AI REVIEWS
create table public.trade_reviews (
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
create policy "Users own their reviews"
  on public.trade_reviews for all using (auth.uid() = user_id);

-- BACKTEST RUNS
create table public.backtest_runs (
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
create policy "Users own their backtests"
  on public.backtest_runs for all using (auth.uid() = user_id);

-- Auto-update updated_at trigger
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at
  before update on public.trades
  for each row
  execute function public.handle_updated_at();

-- OHLCV cache (for backtesting data dedup)
create table public.ohlcv_cache (
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
create policy "Authenticated users can read ohlcv_cache"
  on public.ohlcv_cache for select using (auth.role() = 'authenticated');
