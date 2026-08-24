'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { TIMEFRAMES } from '@/lib/types/replay'
import type {
  Candle,
  ChatMessage,
  ClosedReplayTrade,
  DrawingShape,
  EquityPoint,
  PendingOrder,
  ReplayIndicatorConfig,
  ReplayPosition,
  ReplaySessionRow,
  Timeframe,
} from '@/lib/types/replay'

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

// ── Schemas ───────────────────────────────────────────────────────────────────

const createSessionSchema = z.object({
  pair: z.string().min(3).max(10),
  market: z.enum(['forex', 'crypto']),
  timeframes: z.array(z.enum(TIMEFRAMES)).min(1).max(3),
  // Dates are server-assigned (last 11 months); client values ignored
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startingBalance: z.coerce.number().positive().max(100_000_000),
  leverage: z.coerce.number().int().positive().max(500),
  spreadPips: z.coerce.number().nonnegative().max(1000),
})

/** Fixed session window: last 11 months — the max history Twelve Data's free
 *  plan reliably serves. Server-side so the client can't override it. */
function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const to = new Date()
  const from = new Date(to)
  from.setMonth(from.getMonth() - 11)
  return { dateFrom: fmt(from), dateTo: fmt(to) }
}

const saveStateSchema = z.object({
  sessionId: z.string().uuid(),
  cursorIndex: z.number().int().nonnegative().optional(),
  balance: z.number().optional(),
  positions: z.array(z.custom<ReplayPosition>()).optional(),
  orders: z.array(z.custom<PendingOrder>()).optional(),
  drawings: z.array(z.custom<DrawingShape>()).optional(),
  indicatorConfigs: z.array(z.custom<ReplayIndicatorConfig>()).optional(),
  closedTrades: z.array(z.custom<ClosedReplayTrade>()).optional(),
  equityCurve: z.array(z.custom<EquityPoint>()).optional(),
  chatMessages: z.array(z.custom<ChatMessage>()).optional(),
})

const recordClosedTradeSchema = z.object({
  sessionId: z.string().uuid(),
  pair: z.string().min(3),
  market: z.enum(['forex', 'crypto']),
  direction: z.enum(['long', 'short']),
  entryPrice: z.coerce.number().positive(),
  exitPrice: z.coerce.number().nonnegative(),
  stopLoss: z.coerce.number().nullable(),
  takeProfit: z.coerce.number().nullable(),
  lotSize: z.coerce.number().positive(),
  pnlUsd: z.coerce.number(),
  pnlPips: z.coerce.number(),
  entryTime: z.string().min(1),
  exitTime: z.string().min(1),
  notes: z.string().optional(),
})

// ── Create session ────────────────────────────────────────────────────────────

export async function createReplaySession(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createSessionSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Not authenticated' }

    const range = defaultDateRange()
    const { data: row, error } = await supabase
      .from('replay_sessions')
      .insert({
        user_id: user.id,
        pair: data.pair,
        market: data.market,
        timeframes: data.timeframes,
        date_from: range.dateFrom,
        date_to: range.dateTo,
        starting_balance: data.startingBalance,
        balance: data.startingBalance,
        leverage: data.leverage,
        spread_pips: data.spreadPips,
      })
      .select('id')
      .single()

    if (error) throw error
    return { success: true, data: { id: row.id as string } }
  } catch (error) {
    console.error('[createReplaySession]', error)
    return { success: false, error: 'Failed to create replay session. Please try again.' }
  }
}

// ── Autosave mutable state ────────────────────────────────────────────────────

export async function saveReplayState(input: unknown): Promise<ActionResult<null>> {
  const parsed = saveStateSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { sessionId, ...patch } = parsed.data

  const columnPatch: Record<string, unknown> = {}
  if (patch.cursorIndex !== undefined) columnPatch.cursor_index = patch.cursorIndex
  if (patch.balance !== undefined) columnPatch.balance = patch.balance
  if (patch.positions !== undefined) columnPatch.positions = patch.positions
  if (patch.orders !== undefined) columnPatch.orders = patch.orders
  if (patch.drawings !== undefined) columnPatch.drawings = patch.drawings
  if (patch.indicatorConfigs !== undefined) columnPatch.indicator_configs = patch.indicatorConfigs
  if (patch.closedTrades !== undefined) columnPatch.closed_trades = patch.closedTrades
  if (patch.equityCurve !== undefined) columnPatch.equity_curve = patch.equityCurve
  if (patch.chatMessages !== undefined) columnPatch.chat_messages = patch.chatMessages

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Not authenticated' }

    // RLS update — only own rows are writable; count check surfaces misses
    // (count must be requested explicitly, else it's always null)
    const { error, count } = await supabase
      .from('replay_sessions')
      .update(columnPatch, { count: 'exact' })
      .eq('id', sessionId)
      .eq('user_id', user.id)

    if (error) throw error
    if ((count ?? 0) === 0) return { success: false, error: 'Session not found' }
    return { success: true, data: null }
  } catch (error) {
    console.error('[saveReplayState]', error)
    return { success: false, error: 'Failed to save session state.' }
  }
}

// ── End / delete session ──────────────────────────────────────────────────────

export async function endReplaySession(sessionId: string): Promise<ActionResult<null>> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Not authenticated' }

    const { error } = await supabase
      .from('replay_sessions')
      .update({ status: 'complete' })
      .eq('id', sessionId)
      .eq('user_id', user.id)

    if (error) throw error
    return { success: true, data: null }
  } catch (error) {
    console.error('[endReplaySession]', error)
    return { success: false, error: 'Failed to end session.' }
  }
}

export async function abandonReplaySession(sessionId: string): Promise<ActionResult<null>> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Not authenticated' }

    const { error } = await supabase
      .from('replay_sessions')
      .update({ status: 'abandoned' })
      .eq('id', sessionId)
      .eq('user_id', user.id)

    if (error) throw error
    return { success: true, data: null }
  } catch (error) {
    console.error('[abandonReplaySession]', error)
    return { success: false, error: 'Failed to abandon session.' }
  }
}

export async function deleteReplaySession(sessionId: string): Promise<ActionResult<null>> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Not authenticated' }

    const { error } = await supabase
      .from('replay_sessions')
      .delete()
      .eq('id', sessionId)
      .eq('user_id', user.id)

    if (error) throw error
    return { success: true, data: null }
  } catch (error) {
    console.error('[deleteReplaySession]', error)
    return { success: false, error: 'Failed to delete session.' }
  }
}

// ── Get one session ───────────────────────────────────────────────────────────

export async function getReplaySession(
  sessionId: string,
): Promise<ActionResult<ReplaySessionRow>> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Not authenticated' }

    // Explicit column list — excludes the heavy `candles` jsonb, which is
    // loaded separately via getSessionCandles only when needed
    const { data, error } = await supabase
      .from('replay_sessions')
      .select(SESSION_COLUMNS)
      .eq('id', sessionId)
      .single()

    if (error || !data) return { success: false, error: 'Session not found' }
    return { success: true, data: data as unknown as ReplaySessionRow }
  } catch (error) {
    console.error('[getReplaySession]', error)
    return { success: false, error: 'Failed to load session.' }
  }
}

// ── Candle cache ──────────────────────────────────────────────────────────────
// Fetched OHLCV is stored once on the session row so resuming a paused
// session makes zero Twelve Data calls.

// Explicit column list — excludes the heavy `candles` jsonb, which is loaded
// separately via getSessionCandles only when needed
const SESSION_COLUMNS =
  'id, user_id, pair, market, timeframes, date_from, date_to, starting_balance, leverage, spread_pips, status, cursor_index, balance, positions, orders, drawings, indicator_configs, closed_trades, equity_curve, chat_messages, personality_reviews, created_at, updated_at'

export async function getSessionCandles(
  sessionId: string,
): Promise<ActionResult<Record<string, Candle[]> | null>> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Not authenticated' }

    const { data, error } = await supabase
      .from('replay_sessions')
      .select('candles')
      .eq('id', sessionId)
      .single()

    if (error) return { success: false, error: 'Session not found' }
    return { success: true, data: (data.candles as Record<string, Candle[]> | null) ?? null }
  } catch (error) {
    console.error('[getSessionCandles]', error)
    return { success: false, error: 'Failed to load cached candles.' }
  }
}

const saveCandlesSchema = z.object({
  sessionId: z.string().uuid(),
  candles: z.record(z.string(), z.array(z.custom<Candle>())),
})

/** Write-once: saves only if the column is still null (first fetch wins). */
export async function saveSessionCandles(
  input: unknown,
): Promise<ActionResult<{ saved: boolean }>> {
  const parsed = saveCandlesSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Not authenticated' }

    const { count, error } = await supabase
      .from('replay_sessions')
      .update({ candles: parsed.data.candles }, { count: 'exact' })
      .eq('id', parsed.data.sessionId)
      .is('candles', null)

    if (error) throw error
    return { success: true, data: { saved: (count ?? 0) > 0 } }
  } catch (error) {
    console.error('[saveSessionCandles]', error)
    return { success: false, error: 'Failed to cache candles.' }
  }
}

// ── List sessions for the setup page ─────────────────────────────────────────

export async function listReplaySessions(): Promise<
  ActionResult<Array<Pick<ReplaySessionRow, 'id' | 'pair' | 'market' | 'timeframes' | 'status' | 'balance' | 'starting_balance' | 'created_at'>>>
> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Not authenticated' }

    const { data, error } = await supabase
      .from('replay_sessions')
      .select('id, pair, market, timeframes, status, balance, starting_balance, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error
    return {
      success: true,
      data: (data ?? []) as Array<{
        id: string
        pair: string
        market: 'forex' | 'crypto'
        timeframes: Timeframe[]
        status: ReplaySessionRow['status']
        balance: number
        starting_balance: number
        created_at: string
      }>,
    }
  } catch (error) {
    console.error('[listReplaySessions]', error)
    return { success: false, error: 'Failed to load sessions.' }
  }
}

// ── Journal insert for a closed replay trade ─────────────────────────────────

export async function recordClosedTrade(input: unknown): Promise<ActionResult<{ tradeId: string }>> {
  const parsed = recordClosedTradeSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const t = parsed.data

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Not authenticated' }

    // Duplicate guard: same session + entry time + pair was already recorded
    const { data: existing } = await supabase
      .from('trades')
      .select('id')
      .eq('session_id', t.sessionId)
      .eq('entry_time', t.entryTime)
      .eq('pair', t.pair)
      .limit(1)

    if (existing && existing.length > 0) {
      return { success: true, data: { tradeId: existing[0].id as string } }
    }

    const pnlUsd = Number(t.pnlUsd.toFixed(2))
    const outcome =
      Math.abs(t.pnlUsd) < 0.005 ? 'breakeven' : t.pnlUsd > 0 ? 'win' : 'loss'

    const { data: inserted, error } = await supabase
      .from('trades')
      .insert({
        user_id: user.id,
        pair: t.pair,
        market: t.market,
        direction: t.direction,
        entry_price: t.entryPrice,
        exit_price: t.exitPrice,
        stop_loss: t.stopLoss,
        take_profit: t.takeProfit,
        lot_size: t.lotSize,
        outcome,
        pnl_usd: pnlUsd,
        pnl_pips: t.pnlPips,
        entry_time: t.entryTime,
        exit_time: t.exitTime,
        notes: t.notes ?? null,
        source: 'backtest',
        session_id: t.sessionId,
      })
      .select('id')
      .single()

    if (error) throw error
    return { success: true, data: { tradeId: inserted.id as string } }
  } catch (error) {
    console.error('[recordClosedTrade]', error)
    return { success: false, error: 'Failed to save trade to journal.' }
  }
}
