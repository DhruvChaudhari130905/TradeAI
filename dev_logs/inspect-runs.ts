/**
 * Inspect recent backtest_runs rows to see what was actually stored.
 * Lists most recent runs with status, total_trades, and entry condition signatures.
 * Usage: npx tsx dev_logs/inspect-runs.ts
 */
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
import { createClient } from '@supabase/supabase-js'
import type { StrategyRuleSet, BacktestResult, BoolExpr } from '../lib/types/backtest'

type RunRow = {
  id: string
  created_at: string
  pair: string
  timeframe: string
  status: string
  approved_rules: unknown
  result: unknown
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: runs, error } = await supabase
    .from('backtest_runs')
    .select('id, created_at, pair, timeframe, status, approved_rules, result')
    .order('created_at', { ascending: false })
    .limit(8)

  if (error) { console.error(error); process.exit(1) }
  if (!runs || runs.length === 0) { console.log('No runs found.'); return }

  for (const r of runs as RunRow[]) {
    const rules = r.approved_rules as StrategyRuleSet | null
    const result = r.result as BacktestResult | null
    const sig = (c: BoolExpr): string =>
      'type' in c
        ? `${c.type}(${c.indicator1 ?? '-'} ${c.operator ?? ''} ${c.indicator2 ?? c.value ?? c.pattern ?? '-'})`
        : JSON.stringify(c).slice(0, 80)
    console.log('════════════════════════════════════════════════════════════════')
    console.log(`id:        ${r.id}`)
    console.log(`created:   ${r.created_at}`)
    console.log(`pair/tf:   ${r.pair} ${r.timeframe}  status: ${r.status}`)
    console.log(`stored total_trades: ${result?.total_trades ?? '(no result stored)'}`)
    if (result) {
      console.log(`   win/loss: ${result.winning_trades}/${result.losing_trades}  pnl: $${result.total_pnl_usd?.toFixed?.(2) ?? result.total_pnl_usd}`)
    }
    if (rules) {
      console.log(`entry_long  (${rules.entry_long?.length ?? 0}):`)
      for (const c of rules.entry_long ?? []) console.log(`   - ${sig(c)}`)
      console.log(`entry_short (${rules.entry_short?.length ?? 0}):`)
      for (const c of rules.entry_short ?? []) console.log(`   - ${sig(c)}`)
      console.log(`indicators: ${JSON.stringify(rules.indicators)}`)
      console.log(`session_filter: ${JSON.stringify(rules.session_filter)}`)
    } else {
      console.log(`approved_rules: NULL (not yet approved)`)
    }
  }
}

main().catch(console.error)
