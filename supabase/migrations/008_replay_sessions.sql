-- ==============================================
-- Migration 008 — Manual Replay Trading Sessions
-- Run in Supabase Dashboard SQL Editor
-- ==============================================

-- === REPLAY SESSIONS ===
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
create policy "Users can view own replay sessions" on public.replay_sessions for select using (auth.uid() = user_id);
create policy "Users can insert own replay sessions" on public.replay_sessions for insert with check (auth.uid() = user_id);
create policy "Users can update own replay sessions" on public.replay_sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own replay sessions" on public.replay_sessions for delete using (auth.uid() = user_id);

-- Auto-update updated_at trigger for replay_sessions
drop trigger if exists set_updated_at on public.replay_sessions;
create trigger set_updated_at before update on public.replay_sessions for each row execute function public.handle_updated_at();

-- === TRADES: link backtested trades to replay sessions ===
alter table public.trades add column if not exists source text not null default 'live';
alter table public.trades drop constraint if exists trades_source_check;
alter table public.trades add constraint trades_source_check check (source in ('live', 'backtest'));
alter table public.trades add column if not exists session_id uuid references public.replay_sessions(id) on delete set null;

create index if not exists trades_session_id_idx on public.trades(session_id);
