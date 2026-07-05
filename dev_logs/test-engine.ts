import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { fetchOHLCV } from '../lib/data/index'
import { runBacktestEngine } from '../lib/backtest/engine'
import type { StrategyRuleSet, ExecutionConfig } from '../lib/types/backtest'

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: run, error } = await supabase
    .from('backtest_runs')
    .select('*')
    .eq('id', '281b5f76-7359-4408-9725-b25036eb9d30')
    .single()

  if (error || !run) {
    console.error('Failed to fetch run:', error)
    process.exit(1)
  }

  const rules = run.approved_rules as StrategyRuleSet
  const execConfig: ExecutionConfig = (run.execution_config as ExecutionConfig | null) ?? {
    spread_pips: 1,
    slippage_pips: 0.5,
    commission_per_lot: 3.5,
    swap_long_per_day: 0.5,
    swap_short_per_day: 0.5,
    leverage: 100,
  }

  console.log('Fetching candles...')
  const candles = await fetchOHLCV({
    pair: run.pair,
    market: run.market,
    timeframe: run.timeframe,
    dateFrom: run.date_from ?? '',
    dateTo: run.date_to ?? '',
  })
  console.log(`Got ${candles.length} candles\n`)

  console.log('Running engine...\n')
  const result = await runBacktestEngine({
    candles,
    rules,
    executionConfig: execConfig,
    startingCapital: run.starting_capital,
    pair: run.pair,
  })

  console.log('\n=== RESULT ===')
  console.log('Trades:', result.total_trades)
  console.log('Win rate:', result.win_rate, '%')
  console.log('Total PnL:', result.total_pnl_usd)
}

main().catch(console.error)