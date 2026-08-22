'use server'

import { createClient } from '@/lib/supabase/server'
import type { Trade } from '@/lib/types/trade'

export interface DashboardStats {
  totalTrades: number
  winRate: number
  netPnl: number
  avgAiScore: number | null
}

export interface DashboardData {
  stats: DashboardStats
  trades: TradeWithScore[]
  recentTrades: TradeWithScore[]
}

export type TradeWithScore = Trade & {
  trade_reviews: { composite_score: number | null }[]
}

export async function getDashboardData(): Promise<
  { success: true; data: DashboardData } | { success: false; error: string }
> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    const tradesResult = await supabase
      .from('trades')
      .select('*, trade_reviews(composite_score)')
      .eq('user_id', user.id)
      .order('entry_time', { ascending: true, nullsFirst: false })

    const trades = (tradesResult.data as TradeWithScore[]) ?? []

    // Compute stats
    const totalTrades = trades.length
    const wins = trades.filter((t) => t.outcome === 'win').length
    const closedTrades = trades.filter((t) => t.outcome === 'win' || t.outcome === 'loss')
    const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0
    const netPnl = trades.reduce((sum, t) => sum + (Number(t.pnl_usd) || 0), 0)

    // Average AI score across trades that have reviews
    const scores = trades
      .map((t) => t.trade_reviews?.[0]?.composite_score)
      .filter((s): s is number => s != null)
    const avgAiScore = scores.length > 0
      ? scores.reduce((sum, s) => sum + s, 0) / scores.length
      : null

    // Recent trades (last 5, reversed to newest first)
    const recentTrades = [...trades].reverse().slice(0, 5)

    return {
      success: true,
      data: {
        stats: { totalTrades, winRate, netPnl, avgAiScore },
        trades, // chronological order for charts
        recentTrades,
      },
    }
  } catch (error) {
    console.error('[getDashboardData]', error)
    return { success: false, error: 'Failed to load dashboard data.' }
  }
}
