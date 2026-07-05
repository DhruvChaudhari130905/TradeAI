import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service-client'
import { fetchOHLCV } from '@/lib/data/index'
import { runBacktestEngine } from '@/lib/backtest/engine'
import { generateBacktestReport } from '@/lib/nim/run-backtest'
import { generateBacktestReviews } from '@/lib/nim/backtest-reviews'
import type { StrategyRuleSet, ExecutionConfig, BacktestTimeframe } from '@/lib/types/backtest'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: runId } = await params

    // ── Auth verification ──────────────────────────────────────────────────
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await request.json()
    const { approvedRules, executionConfig } = body as {
      approvedRules: StrategyRuleSet
      executionConfig: ExecutionConfig
    }

    if (!approvedRules || !executionConfig) {
      return NextResponse.json(
        { error: 'Missing required fields: approvedRules, executionConfig' },
        { status: 400 },
      )
    }

    // ── Ownership check ────────────────────────────────────────────────────
    const serviceClient = createServiceClient()
    const { data: run, error: fetchError } = await serviceClient
      .from('backtest_runs')
      .select('*')
      .eq('id', runId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !run) {
      return NextResponse.json({ error: 'Backtest run not found or access denied' }, { status: 404 })
    }

    if (run.status !== 'extracted' && run.status !== 'approved') {
      return NextResponse.json(
        { error: `Cannot start execution: run status is '${run.status}', expected 'extracted' or 'approved'` },
        { status: 400 },
      )
    }

    // ── Update status and store approved rules ────────────────────────────
    const { error: updateError } = await serviceClient
      .from('backtest_runs')
      .update({
        status: 'running',
        approved_rules: approvedRules as unknown as Record<string, unknown>,
        execution_config: executionConfig as unknown as Record<string, unknown>,
      })
      .eq('id', runId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('[api/backtest/[id]] status update failed:', updateError)
      return NextResponse.json({ error: 'Failed to update backtest status' }, { status: 500 })
    }

    // Process in background
    processBacktestExecution(runId, {
      userId: user.id,
      approvedRules,
      executionConfig,
      pair: run.pair,
      market: run.market,
      timeframe: run.timeframe as BacktestTimeframe,
      dateFrom: run.date_from,
      dateTo: run.date_to,
      startingCapital: run.starting_capital,
    }).catch((err) => {
      console.error('[api/backtest/[id]] background execution failed:', err)
    })

    return NextResponse.json({ status: 'running' }, { status: 202 })
  } catch (error) {
    console.error('[api/backtest/[id]]', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    )
  }
}

async function processBacktestExecution(
  runId: string,
  params: {
    userId: string
    approvedRules: StrategyRuleSet
    executionConfig: ExecutionConfig
    pair: string
    market: 'forex' | 'crypto'
    timeframe: BacktestTimeframe
    dateFrom: string | null
    dateTo: string | null
    startingCapital: number
  },
) {
  const supabase = createServiceClient()

  const markError = async (msg: string) => {
    await supabase
      .from('backtest_runs')
      .update({ status: 'error', ai_report: msg })
      .eq('id', runId)
  }

  try {
    // 1. Fetch OHLCV data from Twelve Data
    const candles = await fetchOHLCV({
      pair: params.pair,
      market: params.market,
      timeframe: params.timeframe,
      dateFrom: params.dateFrom ?? '',
      dateTo: params.dateTo ?? '',
    })

    if (candles.length < 10) {
      await markError('Not enough historical data for this pair/timeframe/range. Need at least 10 candles.')
      return
    }

    // 2. Run deterministic backtest engine
    const result = await runBacktestEngine({
      candles,
      rules: params.approvedRules,
      executionConfig: params.executionConfig,
      startingCapital: params.startingCapital,
      pair: params.pair,
    })

    // 3. Generate AI narrative report + 5 personality reviews (in parallel)
    const [aiReport, personalityReviews] = await Promise.all([
      generateBacktestReport(params.approvedRules, result, {
        pair: params.pair,
        timeframe: params.timeframe,
        dateFrom: params.dateFrom ?? '',
        dateTo: params.dateTo ?? '',
        startingCapital: params.startingCapital,
      }).catch((err) => {
        console.error('[api/backtest/[id]] report generation failed:', err)
        return '## Report Generation Failed\n\nThe AI narrative report could not be generated. Please review the performance statistics.'
      }),
      generateBacktestReviews(params.approvedRules, result, {
        pair: params.pair,
        timeframe: params.timeframe,
        dateFrom: params.dateFrom ?? '',
        dateTo: params.dateTo ?? '',
        startingCapital: params.startingCapital,
      }).catch((err) => {
        console.error('[api/backtest/[id]] personality reviews failed:', err)
        return []
      }),
    ])

    // 4. Store result
    const { error: updateError } = await supabase
      .from('backtest_runs')
      .update({
        status: 'complete',
        result: result as unknown as Record<string, unknown>,
        ai_report: aiReport,
        personality_reviews: personalityReviews as unknown as Record<string, unknown>,
      })
      .eq('id', runId)
      .eq('user_id', params.userId)

    if (updateError) {
      console.error('[api/backtest/[id]] final update failed:', updateError)
      await markError('Failed to store backtest results.')
    }
  } catch (error) {
    console.error('[api/backtest/[id]] processBacktestExecution error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error during backtest execution'
    await markError(msg)
  }
}
