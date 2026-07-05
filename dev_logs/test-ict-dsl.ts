/**
 * End-to-end proof the expression-DSL engine handles ICT-style strategies.
 * Reads strategies/ICT_Forex_Strategy.txt → NIM extracts a DSL tree → we fetch
 * EUR/USD 5m candles → run the engine → assert total_trades > 0. Prints the
 * emitted tree via describeExpr and any engine warnings.
 *
 * Usage: npx tsx dev_logs/test-ict-dsl.ts
 */
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { extractStrategyRules } from '../lib/nim/extract-strategy-rules'
import { fetchOHLCV } from '../lib/data/index'
import { runBacktestEngine } from '../lib/backtest/engine'
import { describeExpr } from '../lib/backtest/expr-engine'
import type { StrategyRuleSet, ExecutionConfig, BoolExpr } from '../lib/types/backtest'

const STRATEGY_DOC = path.resolve(process.cwd(), 'strategies/ICT_Forex_Strategy.txt')

const printGroup = (label: string, group: BoolExpr[]) => {
  console.log(`  ${label} (${group.length}):`)
  for (const e of group) console.log('    -', describeExpr(e))
  if (group.length === 0) console.log('    (none)')
}

async function main() {
  // ── 1. Read the ICT strategy document ──────────────────────────────────
  const docText = fs.readFileSync(STRATEGY_DOC, 'utf-8')
  console.log(`Document: ${STRATEGY_DOC} (${docText.length} chars)\n`)

  // ── 2. Extract DSL rules via NIM ───────────────────────────────────────
  console.log('⏳ Extracting DSL rules via NIM…')
  const rules: StrategyRuleSet = await extractStrategyRules(docText)

  console.log('\n✅ Extracted DSL tree:')
  console.log('Name:', rules.name, '| Timeframe:', rules.timeframe)
  console.log('Indicators:', JSON.stringify(rules.indicators))
  printGroup('entry_long', rules.entry_long)
  printGroup('entry_short', rules.entry_short)
  printGroup('exit_long', rules.exit_long)
  printGroup('exit_short', rules.exit_short)
  printGroup('invalidation', rules.invalidation)
  if (rules.notes.trim()) console.log('\nNotes:\n' + rules.notes)
  console.log()

  // ── 3. Fetch EUR/USD 5m candles ────────────────────────────────────────
  console.log('⏳ Fetching EUR/USD 5m candles…')
  const candles = await fetchOHLCV({
    pair: 'EUR/USD',
    market: 'forex',
    timeframe: '5m',
    dateFrom: '2025-07-02',
    dateTo: '2026-07-02',
  })
  console.log(`   Got ${candles.length} candles\n`)
  if (candles.length === 0) {
    console.error('❌ No candles fetched (Twelve Data key / rate limit?). Aborting.')
    process.exit(1)
  }

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
    timeframe: '5m',
  })

  // ── 5. Report + assert ────────────────────────────────────────────────
  console.log('═══════════════════════════════════════')
  console.log(' BACKTEST RESULT')
  console.log('═══════════════════════════════════════')
  console.log('Total trades:', result.total_trades)
  console.log('Win rate:', result.win_rate.toFixed(1) + '%')
  console.log('Total PnL:', '$' + result.total_pnl_usd.toFixed(2))
  console.log('Max drawdown:', result.max_drawdown_pct.toFixed(2) + '%')
  console.log('Profit factor:', result.profit_factor.toFixed(2))
  console.log('Expectancy:', '$' + result.expectancy.toFixed(2))
  if (result.warnings && result.warnings.length > 0) {
    console.log('\n⚠️  Engine warnings:')
    for (const w of result.warnings) console.log('  -', w)
  }

  // The assertion: ICT previously produced 0 trades because its structural
  // references (swing_low, prev_day_low, break of structure) couldn't resolve.
  // The DSL engine must surface real trades (or real warnings) — never silent 0.
  if (result.total_trades === 0) {
    console.error('\n❌ FAIL: total_trades === 0. The DSL extraction/engine did not produce trades.')
    console.error('   Check the warnings above and the emitted tree — a structural concept is still unresolvable.')
    process.exit(1)
  }
  console.log(`\n✅ PASS: ${result.total_trades} trades generated. DSL engine handles ICT.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
