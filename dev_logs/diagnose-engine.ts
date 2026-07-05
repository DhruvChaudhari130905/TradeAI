/**
 * Diagnostic script — runs the backtest engine with per-condition logging.
 * Usage: npx tsx dev_logs/diagnose-engine.ts
 */
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
import { createClient } from '@supabase/supabase-js'
import { fetchOHLCV } from '../lib/data/index'
import { computeIndicators } from '../lib/backtest/indicators'
import { evaluateCondition, isInSession } from '../lib/backtest/rule-engine'
import { runBacktestEngine } from '../lib/backtest/engine'
import type { IndicatorSeries } from '../lib/backtest/indicators'
import type { StrategyRuleSet, ExecutionConfig, Candle, Condition, BoolExpr } from '../lib/types/backtest'

// Narrow a rule group to its legacy flat `Condition` leaves. The DSL may emit
// expression trees; the per-condition introspection below only applies to flat
// leaves (true for the legacy runs this script targets). Trees are still
// exercised by the real engine run.
const legacy = (g: BoolExpr[]): Condition[] => g.filter((c): c is Condition => 'type' in c)

async function main() {
  // ── 1. Fetch the latest backtest run ────────────────────────────────────
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
    console.error('Failed to fetch backtest run:', error)
    process.exit(1)
  }

  const rules = run.approved_rules as StrategyRuleSet
  const execConfig = (run.execution_config as ExecutionConfig) ?? {
    spread_pips: 1,
    slippage_pips: 0.5,
    commission_per_lot: 3.5,
    swap_long_per_day: 0.5,
    swap_short_per_day: 0.5,
    leverage: 100,
  }

  console.log('\n══════════════════════════════════════════════════════')
  console.log(' DIAGNOSTIC: Backtest Engine Condition Analysis')
  console.log('══════════════════════════════════════════════════════\n')
  console.log('Strategy:', rules.name)
  console.log('Pair:', run.pair, '| Timeframe:', run.timeframe)
  console.log('Date range:', run.date_from, '→', run.date_to)
  console.log('Capital:', run.starting_capital)

  // ── 2. Fetch candles ────────────────────────────────────────────────────
  console.log('\n⏳ Fetching OHLCV data...')
  const candles = await fetchOHLCV({
    pair: run.pair,
    market: run.market,
    timeframe: run.timeframe,
    dateFrom: run.date_from ?? '',
    dateTo: run.date_to ?? '',
  })
  console.log(`   Got ${candles.length} candles`)

  // ── 3. Compute indicators ───────────────────────────────────────────────
  const indicators = computeIndicators(candles, rules.indicators)
  console.log('Indicators computed:', [...indicators.keys()])

  const lookback = 200 // EMA_200
  console.log('Lookback:', lookback)

  // ── 4. Per-condition pass rate analysis ─────────────────────────────────
  console.log('\n──────────────────────────────────────────────────────')
  console.log(' PER-CONDITION PASS RATE ANALYSIS')
  console.log('──────────────────────────────────────────────────────\n')

  const allConditions: { group: string; condition: Condition }[] = [
    ...legacy(rules.entry_long).map((c) => ({ group: 'entry_long', condition: c })),
    ...legacy(rules.entry_short).map((c) => ({ group: 'entry_short', condition: c })),
    ...legacy(rules.exit_long).map((c) => ({ group: 'exit_long', condition: c })),
    ...legacy(rules.exit_short).map((c) => ({ group: 'exit_short', condition: c })),
  ]

  for (const { group, condition } of allConditions) {
    let passes = 0
    let total = 0
    const nanCount = 0

    for (let i = lookback; i < candles.length; i++) {
      // Apply session filter for entry conditions only (matching engine logic)
      if ((group === 'entry_long' || group === 'entry_short') && rules.session_filter?.sessions?.length) {
        if (!isInSession(candles[i], rules.session_filter.sessions, rules.timeframe ?? '15m')) {
          continue
        }
      }
      total++
      const result = evaluateCondition(condition, i, indicators, candles)
      if (result) passes++
    }

    const pct = total > 0 ? ((passes / total) * 100).toFixed(2) : '0.00'
    const desc = `${condition.type}(${condition.indicator1 ?? '-'} ${condition.operator ?? ''} ${condition.indicator2 ?? condition.value ?? condition.pattern ?? ''})`
    console.log(`  ${group.padEnd(14)} ${desc.padEnd(60)} ${String(passes).padStart(6)}/${String(total).padStart(6)}  ${pct}%`)
  }

  // ── 5. Combined condition pass rate ─────────────────────────────────────
  console.log('\n──────────────────────────────────────────────────────')
  console.log(' COMBINED CONDITION ANALYSIS (ALL conditions in group)')
  console.log('──────────────────────────────────────────────────────\n')

  function countAllPass(
    conditions: Condition[],
    candles: Candle[],
    indicators: Map<string, number[] | IndicatorSeries>,
  ): { bars: number; total: number } {
    let allPass = 0
    let total = 0
    for (let i = lookback; i < candles.length; i++) {
      if (rules.session_filter?.sessions?.length) {
        if (!isInSession(candles[i], rules.session_filter.sessions, rules.timeframe ?? '15m')) {
          continue
        }
      }
      total++
      if (conditions.every((c) => evaluateCondition(c, i, indicators, candles))) {
        allPass++
      }
    }
    return { bars: allPass, total }
  }

  const longPass = countAllPass(legacy(rules.entry_long), candles, indicators)
  const shortPass = countAllPass(legacy(rules.entry_short), candles, indicators)
  const exitLongPass = countAllPass(legacy(rules.exit_long), candles, indicators)
  const exitShortPass = countAllPass(legacy(rules.exit_short), candles, indicators)

  console.log(`  entry_long  (all ${legacy(rules.entry_long).length} conditions):  ${String(longPass.bars).padStart(6)}/${longPass.total}  ${(longPass.bars / longPass.total * 100).toFixed(3)}%`)
  console.log(`  entry_short (all ${legacy(rules.entry_short).length} conditions): ${String(shortPass.bars).padStart(6)}/${shortPass.total}  ${(shortPass.bars / shortPass.total * 100).toFixed(3)}%`)
  console.log(`  exit_long   (all ${legacy(rules.exit_long).length} conditions):   ${String(exitLongPass.bars).padStart(6)}/${exitLongPass.total}  ${(exitLongPass.bars / exitLongPass.total * 100).toFixed(3)}%`)
  console.log(`  exit_short  (all ${legacy(rules.exit_short).length} conditions):  ${String(exitShortPass.bars).padStart(6)}/${exitShortPass.total}  ${(exitShortPass.bars / exitShortPass.total * 100).toFixed(3)}%`)

  // ── 6. Check entry sequence logic ───────────────────────────────────────
  console.log('\n──────────────────────────────────────────────────────')
  console.log(' ENTRY SEQUENCE SIMULATION')
  console.log('──────────────────────────────────────────────────────\n')

  // Simulate the actual engine loop logic to count entries vs margin rejections
  const entriesAttempted = { long: 0, short: 0 }
  const marginRejected = { long: 0, short: 0 }
  let inPosition = false

  for (let i = lookback; i < candles.length; i++) {
    const candle = candles[i]

    if (rules.session_filter?.sessions?.length) {
      if (!isInSession(candle, rules.session_filter.sessions, rules.timeframe ?? '15m')) {
        continue
      }
    }

    if (!inPosition) {
      // Simulate what the engine does
      const longOk = legacy(rules.entry_long).length > 0 &&
        legacy(rules.entry_long).every((c) => evaluateCondition(c, i, indicators, candles))
      const shortOk = legacy(rules.entry_short).length > 0 &&
        legacy(rules.entry_short).every((c) => evaluateCondition(c, i, indicators, candles))

      if (longOk) {
        entriesAttempted.long++
        // Quick margin check
        const lotSize = rules.position_sizing.value ?? 0.1
        const leverage = execConfig.leverage ?? 100
        const margin = (lotSize * 100000 * candle.close) / leverage
        if (10000 > margin * 1.1) {
          inPosition = true // would have entered
        } else {
          marginRejected.long++
        }
      } else if (shortOk) {
        entriesAttempted.short++
        const lotSize = rules.position_sizing.value ?? 0.1
        const leverage = execConfig.leverage ?? 100
        const margin = (lotSize * 100000 * candle.close) / leverage
        if (10000 > margin * 1.1) {
          inPosition = true
        } else {
          marginRejected.short++
        }
      }
    } else {
      // In position — check exit
      const exitConditions = inPosition ? legacy(rules.exit_long) : legacy(rules.exit_short) // simplified
      const shouldExit = exitConditions.length > 0 &&
        exitConditions.every((c) => evaluateCondition(c, i, indicators, candles))

      if (shouldExit) {
        inPosition = false
      }
    }
  }

  console.log(`  Long entries possible:   ${entriesAttempted.long}`)
  console.log(`  Short entries possible:  ${entriesAttempted.short}`)
  console.log(`  Margin rejections long:  ${marginRejected.long}`)
  console.log(`  Margin rejections short: ${marginRejected.short}`)

  // ── 7. Session filter analysis ──────────────────────────────────────────
  console.log('\n──────────────────────────────────────────────────────')
  console.log(' SESSION FILTER ANALYSIS')
  console.log('──────────────────────────────────────────────────────\n')

  let inSession = 0
  let outSession = 0
  for (let i = 0; i < candles.length; i++) {
    if (isInSession(candles[i], rules.session_filter?.sessions ?? [], rules.timeframe ?? '15m')) {
      inSession++
    } else {
      outSession++
    }
  }
  console.log(`  Bars in session:   ${inSession} (${(inSession / candles.length * 100).toFixed(1)}%)`)
  console.log(`  Bars out of session: ${outSession} (${(outSession / candles.length * 100).toFixed(1)}%)`)
  console.log(`  Sessions: ${rules.session_filter?.sessions?.join(', ')}`)

  // ── 8. Example bars near entry signals ──────────────────────────────────
  console.log('\n──────────────────────────────────────────────────────')
  console.log(' SAMPLE: First 5 bars where at least 3/4 entry_long conditions pass')
  console.log('──────────────────────────────────────────────────────\n')

  let found = 0
  for (let i = lookback; i < candles.length && found < 5; i++) {
    const candle = candles[i]
    if (rules.session_filter?.sessions?.length) {
      if (!isInSession(candle, rules.session_filter.sessions, rules.timeframe ?? '15m')) {
        continue
      }
    }

    const results = legacy(rules.entry_long).map((c) => ({
      type: c.type,
      passes: evaluateCondition(c, i, indicators, candles),
    }))
    const passCount = results.filter((r) => r.passes).length

    if (passCount >= 3) {
      found++
      console.log(`  Bar ${i} | ${candle.time} | ${passCount}/4 conditions pass:`)
      for (const r of results) {
        console.log(`    ${r.passes ? '✅' : '❌'} ${r.type}`)
      }
      console.log(`    O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close}`)
      // Show indicator values
      const ema50 = (indicators.get('ema_50') as number[])?.[i]
      const ema200 = (indicators.get('ema_200') as number[])?.[i]
      const rsi14 = (indicators.get('rsi_14') as number[])?.[i]
      console.log(`    EMA_50: ${ema50?.toFixed(5)} | EMA_200: ${ema200?.toFixed(5)} | RSI_14: ${rsi14?.toFixed(2)}`)
      console.log()
    }
  }

  console.log('Done.')
}

main().catch(console.error)