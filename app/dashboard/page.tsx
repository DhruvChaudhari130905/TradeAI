'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { StatsCards } from '@/components/dashboard/StatsCards'
import { PnlChart } from '@/components/dashboard/PnlChart'
import { WinLossChart } from '@/components/dashboard/WinLossChart'
import { AiScoreChart } from '@/components/dashboard/AiScoreChart'
import { RecentTrades } from '@/components/dashboard/RecentTrades'
import { InsightsPanel } from '@/components/dashboard/InsightsPanel'
import { Button } from '@/components/ui/button'
import { LayoutDashboard, BookOpen, FlaskConical, RefreshCw, CalendarDays } from 'lucide-react'
import Link from 'next/link'
import type { DashboardStats } from '@/lib/actions/dashboard'
import type { Trade } from '@/lib/types/trade'

type TradeWithScore = Trade & {
  trade_reviews: { composite_score: number | null }[]
}

type TimePeriod = '7d' | '30d' | '90d' | 'all'

const PERIOD_LABELS: Record<TimePeriod, string> = {
  '7d': '7D',
  '30d': '30D',
  '90d': '90D',
  'all': 'All',
}

function daysAgo(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(0, 0, 0, 0)
  return d
}

// ── Skeleton loaders ──

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-zinc-800 bg-[#12141A] p-5">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-zinc-800" />
        <div className="space-y-2">
          <div className="h-3 w-20 rounded bg-zinc-800" />
          <div className="h-6 w-28 rounded bg-zinc-800" />
        </div>
      </div>
    </div>
  )
}

function SkeletonChart() {
  return (
    <div className="animate-pulse rounded-xl border border-zinc-800 bg-[#12141A] p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="h-4 w-28 rounded bg-zinc-800" />
        <div className="h-4 w-16 rounded bg-zinc-800" />
      </div>
      <div className="h-60 rounded-lg bg-zinc-800/50" />
    </div>
  )
}

function SkeletonList() {
  return (
    <div className="animate-pulse rounded-xl border border-zinc-800 bg-[#12141A] p-6">
      <div className="h-4 w-28 rounded bg-zinc-800 mb-4" />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg bg-[#0A0B0E] px-3 py-2.5 mb-2">
          <div className="h-4 w-20 rounded bg-zinc-800" />
          <div className="h-5 w-14 rounded bg-zinc-800" />
          <div className="ml-auto h-4 w-16 rounded bg-zinc-800" />
        </div>
      ))}
    </div>
  )
}

// ── Main ──

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()

  const [profile, setProfile] = useState<{ username: string | null } | null>(null)
  const [allTrades, setAllTrades] = useState<TradeWithScore[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<TimePeriod>('all')
  // Real (journal) vs backtested — null source counts as live (legacy manual logs)
  const [sourceTab, setSourceTab] = useState<'live' | 'backtest'>('live')

  // ── Fetch all data ──
  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth/login')
        return
      }

      const [profileRes, tradesRes] = await Promise.all([
        supabase.from('profiles').select('username').eq('id', user.id).single(),
        supabase
          .from('trades')
          .select('*, trade_reviews(composite_score)')
          .eq('user_id', user.id)
          .order('entry_time', { ascending: true, nullsFirst: false }),
      ])

      if (tradesRes.error) throw tradesRes.error

      setProfile(profileRes.data)
      setAllTrades((tradesRes.data as TradeWithScore[]) ?? [])
    } catch (err) {
      console.error('[DashboardPage]', err)
      setError('Failed to load dashboard data. Please try again.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [supabase, router])

  useEffect(() => {
    // fetchData sets loading state synchronously, but the real state updates
    // happen after awaited fetches — standard mount-fetch pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
  }, [fetchData])

  // ── Filter trades by source + time period ──
  const filteredTrades = useMemo(() => {
    const bySource = allTrades.filter(
      (t) => (t.source ?? 'live') === sourceTab,
    )
    if (period === 'all') return bySource
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
    const cutoff = daysAgo(days)
    return bySource.filter((t) => {
      if (!t.entry_time) return false
      return new Date(t.entry_time) >= cutoff
    })
  }, [allTrades, period, sourceTab])

  // ── Compute stats from filtered trades ──
  const stats = useMemo<DashboardStats>(() => {
    const totalTrades = filteredTrades.length
    const wins = filteredTrades.filter((t) => t.outcome === 'win').length
    const closedTrades = filteredTrades.filter(
      (t) => t.outcome === 'win' || t.outcome === 'loss',
    ).length
    const winRate = closedTrades > 0 ? (wins / closedTrades) * 100 : 0
    const netPnl = filteredTrades.reduce((sum, t) => sum + (Number(t.pnl_usd) || 0), 0)

    const scores = filteredTrades
      .map((t) => t.trade_reviews?.[0]?.composite_score)
      .filter((s): s is number => s != null)
    const avgAiScore =
      scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : null

    return { totalTrades, winRate, netPnl, avgAiScore }
  }, [filteredTrades])

  // ── Derived data ──
  const recentTrades = useMemo(
    () => [...filteredTrades].reverse().slice(0, 5),
    [filteredTrades],
  )

  const isEmpty = allTrades.length === 0
  const hasFilteredResults = filteredTrades.length > 0

  // ── Period switcher ──
  const periods: TimePeriod[] = ['7d', '30d', '90d', 'all']

  // ── Loading state ──
  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-8 w-56 animate-pulse rounded bg-zinc-800" />
          <div className="mt-2 h-4 w-72 animate-pulse rounded bg-zinc-800" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2"><SkeletonChart /></div>
          <SkeletonChart />
        </div>
        <SkeletonChart />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <SkeletonList key={i} />)}
        </div>
      </div>
    )
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-[#12141A] py-20 px-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FF4D4D]/10 mb-6">
          <LayoutDashboard className="h-8 w-8 text-[#FF4D4D]" />
        </div>
        <h2 className="text-lg font-semibold text-white">Something went wrong</h2>
        <p className="mt-2 max-w-md text-center text-sm text-zinc-400">{error}</p>
        <Button
          onClick={() => fetchData()}
          className="mt-6 gap-2 bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Welcome back, {profile?.username ?? 'Trader'}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {"Here's your trading performance overview."}
          </p>
        </div>

        {/* Refresh + Period Filter */}
        {!isEmpty && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Real vs backtested toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-[#12141A] p-1">
              {(['live', 'backtest'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setSourceTab(tab)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    sourceTab === tab
                      ? 'bg-[#00FF9C]/15 text-[#00FF9C]'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {tab === 'live' ? 'Real' : 'Backtested'}
                </button>
              ))}
            </div>

            {/* Time period pills */}
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-zinc-800 bg-[#12141A] p-1">
              <CalendarDays className="ml-2 h-3.5 w-3.5 text-zinc-500" />
              {periods.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    period === p
                      ? 'bg-[#00FF9C]/15 text-[#00FF9C]'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>

            {/* Refresh button */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="h-8 w-8 border-zinc-800 bg-[#12141A] text-zinc-400 hover:text-zinc-200"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        )}
      </div>

      {/* ── Empty State (no trades or backtests at all) ── */}
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-[#12141A] py-20 px-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#00FF9C]/10 mb-6">
            <LayoutDashboard className="h-8 w-8 text-[#00FF9C]" />
          </div>
          <h2 className="text-lg font-semibold text-white">
            Your command centre awaits
          </h2>
          <p className="mt-2 max-w-md text-center text-sm text-zinc-400">
            Start by logging a trade or running a backtest. Your performance
            charts, AI insights, and analytics will appear here automatically.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/journal/new">
              <Button className="gap-2 bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90">
                <BookOpen className="h-4 w-4" />
                Log a Trade
              </Button>
            </Link>
            <Link href="/backtest">
              <Button
                variant="outline"
                className="gap-2 border-zinc-700 text-zinc-300 hover:bg-[#12141A]"
              >
                <FlaskConical className="h-4 w-4" />
                Run a Backtest
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* ── Period Empty State ── */}
          {!hasFilteredResults ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-[#12141A] py-16 px-6">
              <CalendarDays className="h-10 w-10 text-zinc-600 mb-4" />
              <h3 className="text-sm font-semibold text-white">
                No {sourceTab === 'live' ? 'real' : 'backtested'} trades{period !== 'all' ? ' in this period' : ''}
              </h3>
              <p className="mt-1 text-sm text-zinc-500">
                {period !== 'all'
                  ? `None of your ${sourceTab === 'live' ? 'real' : 'backtested'} trades fall within the last ${
                      period === '7d' ? '7 days' : period === '30d' ? '30 days' : '90 days'
                    }.`
                  : `Log ${sourceTab === 'live' ? 'a trade in the journal' : 'a backtest'} to see its stats here.`}
              </p>
              <Button
                variant="ghost"
                onClick={() => setPeriod('all')}
                className="mt-4 text-xs text-[#00FF9C] hover:text-[#00FF9C]/80"
              >
                View all time →
              </Button>
            </div>
          ) : (
            <>
              {/* ── Stats Cards ── */}
              <StatsCards stats={stats} />

              {/* ── Charts Row ── */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <PnlChart trades={filteredTrades} />
                </div>
                <WinLossChart trades={filteredTrades} />
              </div>

              {/* ── AI Score Trend ── */}
              <AiScoreChart trades={filteredTrades} />

              {/* ── Bottom Row: Recent Activity + Insights ── */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <RecentTrades trades={recentTrades} />
                <InsightsPanel tradeCount={stats.totalTrades} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
