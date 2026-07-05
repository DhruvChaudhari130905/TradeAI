import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service-client'
import { z } from 'zod'
import type { BoolExpr, ValueExpr } from '@/lib/types/backtest'

// ── Zod validation for StrategyRuleSet updates ───────────────────────────────
//
// Rule groups accept the full BoolExpr DSL: recursive expression trees AND-
// combined. Legacy flat `Condition` objects (with `type`) are still accepted
// as leaves for back-compat with stored rules. Zod validates shape; the engine's
// collectUnresolvableRefs is the authoritative guard against unknown series.

const indicatorConfigSchema = z.object({
  type: z.enum(['EMA', 'SMA', 'RSI', 'MACD', 'BBANDS', 'ATR', 'STOCH', 'VWAP', 'ADX', 'SWING_POINTS', 'PREV_DAY_HL']),
  params: z.record(z.string(), z.number()),
})

// Legacy flat Condition leaf — a BoolExpr variant distinguished by `type`.
const conditionSchema = z.object({
  type: z.enum([
    'indicator_cross_above', 'indicator_cross_below',
    'indicator_above', 'indicator_below',
    'price_above', 'price_below',
    'rsi_oversold', 'rsi_overbought',
    'macd_histogram_positive', 'macd_histogram_negative',
    'bb_lower_touch', 'bb_upper_touch',
    'stoch_oversold', 'stoch_overbought',
    'atr_above', 'atr_below',
    'adx_above', 'adx_below',
    'candle_pattern',
  ]),
  indicator1: z.string().optional(),
  indicator2: z.string().optional(),
  value: z.number().optional(),
  operator: z.enum(['gt', 'lt', 'gte', 'lte', 'eq']).optional(),
  pattern: z.string().optional(),
})

// Recursive ValueExpr (a number at a bar).
const valueExprSchema: z.ZodType<ValueExpr> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('series'), name: z.string() }),
    z.object({ kind: z.literal('const'), value: z.number() }),
    z.object({
      kind: z.literal('binop'),
      op: z.enum(['+', '-', '*', '/']),
      a: valueExprSchema,
      b: valueExprSchema,
    }),
    z.object({ kind: z.literal('abs'), arg: valueExprSchema }),
  ]),
)

// Recursive BoolExpr (a boolean at a bar). Legacy flat conditions are a leaf.
const boolExprSchema: z.ZodType<BoolExpr> = z.lazy(() =>
  z.union([
    conditionSchema,
    z.object({ kind: z.literal('and'), args: z.array(boolExprSchema) }),
    z.object({ kind: z.literal('or'), args: z.array(boolExprSchema) }),
    z.object({ kind: z.literal('not'), arg: boolExprSchema }),
    z.object({ kind: z.literal('within'), expr: boolExprSchema, bars: z.number().int().min(1) }),
    z.object({ kind: z.literal('strict'), expr: boolExprSchema }),
    z.object({ kind: z.literal('prev'), expr: boolExprSchema }),
    z.object({
      kind: z.literal('cmp'),
      op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
      a: valueExprSchema,
      b: valueExprSchema,
    }),
    z.object({ kind: z.literal('cross_above'), a: valueExprSchema, b: valueExprSchema }),
    z.object({ kind: z.literal('cross_below'), a: valueExprSchema, b: valueExprSchema }),
    z.object({ kind: z.literal('pattern'), name: z.string() }),
    z.object({
      kind: z.literal('liquidity_sweep'),
      side: z.enum(['low', 'high']),
      level: valueExprSchema.optional(),
    }),
    z.object({
      kind: z.literal('structure_trend'),
      mode: z.enum(['up', 'down']),
      strength: z.number().optional(),
    }),
    z.object({
      kind: z.literal('break_structure'),
      side: z.enum(['up', 'down']),
      swing: valueExprSchema.optional(),
    }),
  ]),
)

const exprArray = z.array(boolExprSchema)

const tradeManagementSchema = z.object({
  type: z.enum(['trailing_stop', 'break_even', 'partial_exit', 'move_sl_to_entry']),
  params: z.record(z.string(), z.number()),
})

const strategyRuleSetSchema = z.object({
  name: z.string(),
  indicators: z.array(indicatorConfigSchema),
  entry_long: exprArray,
  entry_short: exprArray,
  exit_long: exprArray,
  exit_short: exprArray,
  stop_loss: z.object({
    method: z.enum(['fixed_pips', 'atr_based', 'swing_low_high', 'indicator']),
    value: z.number().optional(),
    atr_multiplier: z.number().optional(),
  }),
  take_profit: z.object({
    method: z.enum(['fixed_pips', 'risk_reward', 'atr_based', 'indicator']),
    value: z.number().optional(),
    rr_ratio: z.number().optional(),
    atr_multiplier: z.number().optional(),
  }),
  risk_per_trade_pct: z.number().min(0.1).max(10),
  position_sizing: z.object({
    method: z.enum(['fixed_lot', 'risk_based', 'percent_equity']),
    value: z.number().optional(),
  }),
  session_filter: z.object({
    sessions: z.array(z.enum(['london', 'new_york', 'asian', 'overlap'])),
    alignment: z.enum(['entry_only', 'exit_only', 'both']),
  }).nullable(),
  invalidation: exprArray,
  trade_management: z.array(tradeManagementSchema),
  order_type: z.enum(['market', 'limit', 'stop']),
  timeframe: z.string(),
  notes: z.string(),
})

export async function PATCH(
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
    const parsed = strategyRuleSetSchema.safeParse(body.extracted_rules ?? body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid StrategyRuleSet format', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    // ── Ownership check + status check ─────────────────────────────────────
    const serviceClient = createServiceClient()
    const { data: run, error: fetchError } = await serviceClient
      .from('backtest_runs')
      .select('id, user_id, status')
      .eq('id', runId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !run) {
      return NextResponse.json({ error: 'Backtest run not found or access denied' }, { status: 404 })
    }

    if (run.status !== 'extracted' && run.status !== 'approved') {
      return NextResponse.json(
        { error: `Cannot edit rules: run status is '${run.status}'` },
        { status: 400 },
      )
    }

    // ── Update extracted_rules ────────────────────────────────────────────
    const { error: updateError } = await serviceClient
      .from('backtest_runs')
      .update({
        extracted_rules: parsed.data as unknown as Record<string, unknown>,
      })
      .eq('id', runId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('[api/backtest/[id]/rules] update failed:', updateError)
      return NextResponse.json({ error: 'Failed to update rules' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[api/backtest/[id]/rules]', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    )
  }
}
