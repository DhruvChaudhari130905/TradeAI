import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { extractStrategyRules } from '../lib/nim/extract-strategy-rules'
import { fetchOHLCV } from '../lib/data/index'
import { runBacktestEngine } from '../lib/backtest/engine'
import type { StrategyRuleSet, ExecutionConfig, BacktestTimeframe } from '../lib/types/backtest'

async function main() {
  // ── 1. Read the ICT strategy document ──────────────────────────────────
  const docPath = '/Users/yashkolage/Downloads/ICT_Forex_Strategy.txt'
  const docText = fs.readFileSync(docPath, 'utf-8')
  console.log('Document:', docText.slice(0, 120), '…', docText.length, 'chars\n')

  // ── 2. Extract rules using the NEW prompt ──────────────────────────────
  console.log('⏳ Extracting strategy rules via NIM (new prompt + nemotron-3-super)…')
  let rules: StrategyRuleSet
  try {
    rules = await extractStrategyRules(docText)
  } catch (err) {
    console.error('Extraction FAILED:', err instanceof Error ? err.message : err)
    process.exit(1)
  }

  console.log('\n✅ Extraction SUCCEEDED')
  console.log('Name:', rules.name)
  console.log('Timeframe:', rules.timeframe)
  console.log('Indicators:', JSON.stringify(rules.indicators))
  console.log('Entry long:', rules.entry_long.length, 'conditions:', JSON.stringify(rules.entry_long, null, 2))
  console.log('Entry short:', rules.entry_short.length, 'conditions:', JSON.stringify(rules.entry_short, null, 2))
  console.log('Exit long:', rules.exit_long.length, 'conditions')
  console.log('Exit short:', rules.exit_short.length, 'conditions')
  console.log('SL:', rules.stop_loss.method, rules.stop_loss.value)
  console.log('TP:', rules.take_profit.method, rules.take_profit.rr_ratio)
  console.log('Risk:', rules.risk_per_trade_pct, '%')
  console.log('Position sizing:', rules.position_sizing.method)
  console.log('Session filter:', rules.session_filter?.sessions)
  console.log()

  // ── 3. Fetch candles ───────────────────────────────────────────────────
  const timeframe = rules.timeframe ?? '5m'
  console.log('⏳ Fetching OHLCV for EUR/USD', timeframe, '…')
  const candles = await fetchOHLCV({
    pair: 'EUR/USD',
    market: 'forex',
    timeframe: timeframe as BacktestTimeframe,
    dateFrom: '2025-07-02',
    dateTo: '2026-07-02',
  })
  console.log(`   Got ${candles.length} candles\n`)

  // ── 4. Run the engine ──────────────────────────────────────────────────
  const execConfig: ExecutionConfig = {
    spread_pips: 1,
    slippage_pips: 0.5,
    commission_per_lot: 3.5,
    swap_long_per_day: 0.5,
    swap_short_per_day: 0.5,
    leverage: 100,
  }

  console.log('⏳ Running backtest engine…\n')
  const result = await runBacktestEngine({
    candles,
    rules,
    executionConfig: execConfig,
    startingCapital: 10000,
    pair: 'EUR/USD',
  })

  // ── 5. Report ──────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════')
  console.log(' BACKTEST RESULT')
  console.log('═══════════════════════════════════════')
  console.log('Total trades:', result.total_trades)
  console.log('Win rate:', result.win_rate, '%')
  console.log('Total PnL:', '$' + result.total_pnl_usd.toFixed(2))
  console.log('Max drawdown:', result.max_drawdown_pct.toFixed(2), '%')
  console.log('Profit factor:', result.profit_factor.toFixed(2))
  console.log('Expectancy:', '$' + result.expectancy.toFixed(2))
  if (result.total_trades > 0) {
    console.log('Win/Loss:', result.winning_trades, '/', result.losing_trades)
  }
}

main().catch(console.error)