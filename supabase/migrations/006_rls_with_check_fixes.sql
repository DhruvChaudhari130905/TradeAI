-- Fix RLS policies: add WITH CHECK clauses to tables that used FOR ALL USING
-- without WITH CHECK, which allows INSERTs under arbitrary user_id values.

-- === PROFILES ===
-- Drop the overly-permissive "for all using" policy
DROP POLICY IF EXISTS "Users can view and edit own profile" ON public.profiles;

-- Recreate with explicit per-operation policies
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can delete own profile"
  ON public.profiles FOR DELETE
  USING (auth.uid() = id);

-- === TRADES ===
DROP POLICY IF EXISTS "Users own their trades" ON public.trades;

CREATE POLICY "Users can view own trades"
  ON public.trades FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trades"
  ON public.trades FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trades"
  ON public.trades FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own trades"
  ON public.trades FOR DELETE
  USING (auth.uid() = user_id);

-- === TRADE_REVIEWS ===
DROP POLICY IF EXISTS "Users own their reviews" ON public.trade_reviews;

CREATE POLICY "Users can view own reviews"
  ON public.trade_reviews FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reviews"
  ON public.trade_reviews FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reviews"
  ON public.trade_reviews FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own reviews"
  ON public.trade_reviews FOR DELETE
  USING (auth.uid() = user_id);

-- === BACKTEST_RUNS ===
DROP POLICY IF EXISTS "Users own their backtests" ON public.backtest_runs;

CREATE POLICY "Users can view own backtests"
  ON public.backtest_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own backtests"
  ON public.backtest_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own backtests"
  ON public.backtest_runs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own backtests"
  ON public.backtest_runs FOR DELETE
  USING (auth.uid() = user_id);
