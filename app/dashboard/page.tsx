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
import { Button, buttonVariants } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { BookOpen, FlaskConical, RefreshCw, CalendarDays, AlertTriangle } from 'lucide-react'
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

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />
}

function SkeletonPanel({ height }: { height: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <SkeletonBlock className="mb-4 h-4 w-32" />
      <SkeletonBlock className={height} />
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
      // Local session read — middleware already verified the JWT, and RLS scopes the queries
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
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

  const wins = filteredTrades.filter((t) => t.outcome === 'win').length
  const losses = filteredTrades.filter((t) => t.outcome === 'loss').length
  const reviewed = filteredTrades.filter((t) => t.trade_reviews?.[0]?.composite_score != null).length

  const isEmpty = allTrades.length === 0
  const hasFilteredResults = filteredTrades.length > 0


  // ── Loading state ──
  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-5" aria-busy="true" aria-label="Loading dashboard">
        <SkeletonBlock className="h-7 w-56" />
        <SkeletonBlock className="h-[92px] w-full rounded-lg" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2"><SkeletonPanel height="h-64" /></div>
          <SkeletonPanel height="h-64" />
        </div>
        <SkeletonPanel height="h-48" />
      </div>
    )
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col items-center rounded-lg border border-border bg-card px-6 py-16 text-center" role="alert">
        <AlertTriangle className="h-6 w-6 text-warn" aria-hidden />
        <h2 className="mt-3 text-base font-semibold text-foreground">Couldn’t load your dashboard</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{error}</p>
        <Button onClick={() => fetchData()} className="mt-5 gap-2">
          <RefreshCw className="h-4 w-4" aria-hidden />
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Welcome back, {profile?.username ?? 'Trader'}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Your performance at a glance.</p>
        </div>

        {!isEmpty && (
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Trade source"
              value={sourceTab}
              onChange={setSourceTab}
              options={[{ value: 'live', label: 'Real' }, { value: 'backtest', label: 'Backtested' }]}
            />
            <Segmented
              label="Time period"
              value={period}
              onChange={setPeriod}
              options={(Object.keys(PERIOD_LABELS) as TimePeriod[]).map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => fetchData(true)}
              disabled={refreshing}
              aria-label="Refresh data"
              title="Refresh data"
              className="h-8 w-8 border-border bg-card text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
            </Button>
          </div>
        )}
      </div>

      {/* ── Empty State (no trades or backtests at all) ── */}
      {isEmpty ? (
        <div className="rounded-lg border border-border bg-card px-6 py-14 text-center">
          <h2 className="text-base font-semibold text-foreground">Nothing to analyse yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Log a trade or run a replay session. Your P&amp;L curve, win rate, and AI review scores
            build up here as you go.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href="/journal/new" className={buttonVariants({ size: 'lg', className: 'gap-2 px-3' })}>
              <BookOpen className="h-4 w-4" aria-hidden />
              Log a trade
            </Link>
            <Link href="/backtest" className={buttonVariants({ variant: 'outline', size: 'lg', className: 'gap-2 px-3' })}>
              <FlaskConical className="h-4 w-4" aria-hidden />
              Start a replay
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* ── Period Empty State ── */}
          {!hasFilteredResults ? (
            <div className="flex flex-col items-center rounded-lg border border-border bg-card px-6 py-14 text-center">
              <CalendarDays className="mb-3 h-6 w-6 text-muted-foreground" aria-hidden />
              <h3 className="text-sm font-semibold text-foreground">
                No {sourceTab === 'live' ? 'real' : 'backtested'} trades{period !== 'all' ? ' in this period' : ''}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {period !== 'all'
                  ? `None of your ${sourceTab === 'live' ? 'real' : 'backtested'} trades fall within the last ${
                      period === '7d' ? '7 days' : period === '30d' ? '30 days' : '90 days'
                    }.`
                  : `Log ${sourceTab === 'live' ? 'a trade in the journal' : 'a backtest'} to see its stats here.`}
              </p>
              <Button
                variant="ghost"
                onClick={() => setPeriod('all')}
                className="mt-4 text-xs text-primary hover:text-primary/80"
              >
                View all time →
              </Button>
            </div>
          ) : (
            <>
              {/* ── Stats Cards ── */}
              <StatsCards stats={stats} wins={wins} losses={losses} reviewed={reviewed} />

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
