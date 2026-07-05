-- ==============================================
-- 007_backtest_engine_overhaul.sql
-- Replace AI-simulated backtests with deterministic engine
-- Clean break — delete old runs, add new columns
-- ==============================================

-- Delete all existing backtest_runs (incompatible with new deterministic engine)
DELETE FROM backtest_runs;

-- Add new columns to backtest_runs
ALTER TABLE backtest_runs
  ADD COLUMN IF NOT EXISTS extracted_rules jsonb,       -- AI-extracted StrategyRuleSet
  ADD COLUMN IF NOT EXISTS approved_rules jsonb,         -- user-approved StrategyRuleSet
  ADD COLUMN IF NOT EXISTS execution_config jsonb,       -- ExecutionConfig
  ADD COLUMN IF NOT EXISTS personality_reviews jsonb;    -- 5 personality reviews array

-- Update status check constraint to include new statuses
ALTER TABLE backtest_runs DROP CONSTRAINT IF EXISTS backtest_runs_status_check;
ALTER TABLE backtest_runs ADD CONSTRAINT backtest_runs_status_check
  CHECK (status IN ('extracting', 'extracted', 'approved', 'running', 'complete', 'error'));

-- No additional RLS needed — existing CRUD policies on backtest_runs cover these columns
