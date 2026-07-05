/**
 * Definitive test: run the CURRENT (fixed) engine on the most recent run's
 * stored approved_rules + live candles. If this yields trades but the DB
 * stored 0, the running dev server is executing stale engine code
 * (needs restart/rebuild). If this also yields 0, the fix itself is
 * insufficient for this run and we dig deeper.
 * Usage: npx tsx dev_logs/verify-latest.ts [runId]
 */
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
import { createClient } from '@supabase/supabase-js'
import { fetchOHLCV } from '../lib/data/index'
import { evaluateCondition, isInSession } from '../lib/backtest/rule-engine'
import { runBacktestEngine } from '../lib/backtest/engine'
import { computeIndicators } from '../lib/backtest/indicators'
import type { StrategyRuleSet, ExecutionConfig, BoolExpr, Condition } from '../lib/types/backtest'

const RUN_ID = process.argv[2] ?? '9edba2b0-44ff-4f67-8a28-8a7ba3cf1ae0'
const LOOKBACK = 4 // ENTRY_SETUP_LOOKBACK

// Narrow a rule group to its legacy flat `Condition` leaves. The DSL may emit
// expression trees; the per-condition introspection below only applies to flat
// leaves (true for the legacy EMA-cross runs this script targets). Trees are
// still exercised by the real engine run further down.
const legacy = (g: BoolExpr[]): Condition[] => g.filter((c): c is Condition => 'type' in c)

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: run, error } = await supabase.from('backtest_runs').select('*').eq('id', RUN_ID).single()
  if (error || !run) { console.error('fetch failed:', error); process.exit(1) }

  const rules = run.approved_rules as StrategyRuleSet
  const execConfig: ExecutionConfig = (run.execution_config as ExecutionConfig | null) ?? {
    spread_pips: 1, slippage_pips: 0.5, commission_per_lot: 3.5,
    swap_long_per_day: 0.5, swap_short_per_day: 0.5, leverage: 100,
  }
  console.log(`Run ${RUN_ID} | ${run.pair} ${run.timeframe} (${run.date_from} → ${run.date_to})`)
  const candles = await fetchOHLCV({
    pair: run.pair, market: run.market, timeframe: run.timeframe,
    dateFrom: run.date_from ?? '', dateTo: run.date_to ?? '',
  })
  console.log(`Candles: ${candles.length}\n`)

  // Per-condition pass rate WITH the windowed semantics (mirrors fixed engine entry logic)
  const indicators = computeIndicators(candles, rules.indicators)
  const TRIGGER = new Set(['candle_pattern', 'indicator_cross_above', 'indicator_cross_below'])
  const stateful = (c: Condition) => !TRIGGER.has(c.type)
  console.log('── entry_long per-condition + combined (windowed) ──')
  for (const c of legacy(rules.entry_long)) {
    let p = 0, t = 0
    for (let i = 1; i < candles.length; i++) {
      if (rules.session_filter?.sessions?.length && !isInSession(candles[i], rules.session_filter.sessions, rules.timeframe)) continue
      t++
      if (stateful(c)) {
        for (let j = Math.max(0, i - LOOKBACK + 1); j <= i; j++) if (evaluateCondition(c, j, indicators, candles)) { p++; break }
      } else if (evaluateCondition(c, i, indicators, candles)) p++
    }
    console.log(`  ${c.type}(${c.indicator1 ?? '-'} ${c.operator ?? ''} ${c.indicator2 ?? c.value ?? c.pattern ?? '-'})  ${p}/${t} (${t ? (p/t*100).toFixed(2) : 0}%)`)
  }
  // Combined windowed
  let allPass = 0, total = 0
  for (let i = 1; i < candles.length; i++) {
    if (rules.session_filter?.sessions?.length && !isInSession(candles[i], rules.session_filter.sessions, rules.timeframe)) continue
    total++
    const ok = legacy(rules.entry_long).every((c) => {
      if (stateful(c)) { for (let j = Math.max(0, i - LOOKBACK + 1); j <= i; j++) if (evaluateCondition(c, j, indicators, candles)) return true; return false }
      return evaluateCondition(c, i, indicators, candles)
    })
    if (ok) allPass++
  }
  console.log(`  → entry_long ALL (windowed): ${allPass}/${total} (${total ? (allPass/total*100).toFixed(3) : 0}%)`)

  console.log('\n── Running real engine ──')
  const result = await runBacktestEngine({ candles, rules, executionConfig: execConfig, startingCapital: run.starting_capital, pair: run.pair })
  console.log(`TOTAL TRADES: ${result.total_trades}`)
  console.log(`win/loss: ${result.winning_trades}/${result.losing_trades}  pnl: $${result.total_pnl_usd.toFixed(2)}`)
}

main().catch(console.error)
