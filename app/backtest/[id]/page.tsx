'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  ArrowLeft,
  Loader2,
  TrendingUp,
  TrendingDown,
  Target,
  Percent,
  BarChart3,
  Activity,
  AlertTriangle,
  Download,
  Users,
  ChevronDown,
  ChevronUp,
  Award,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
  BarChart,
  Bar,
  Cell,
} from 'recharts'
import type { BacktestRun, BacktestResult, BacktestPersonalityReview, DrawdownPoint, MonthlyReturn } from '@/lib/types/backtest'

export default function BacktestReportPage() {
  const params = useParams()
  const backtestId = params.id as string

  const [run, setRun] = useState<BacktestRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null

    async function fetchRun() {
      const supabase = createClient()
      const { data, error: fetchError } = await supabase
        .from('backtest_runs')
        .select('*')
        .eq('id', backtestId)
        .single()

      if (fetchError || !data) {
        setError('Backtest not found')
        setLoading(false)
        return
      }

      setRun(data as BacktestRun)
      setLoading(false)

      // If still running, poll every 5s. Network failures reject with
      // `TypeError: Failed to fetch` (blocker / VPN / HMR / backgrounded tab).
      // Without handling, the interval fires forever into a dead endpoint,
      // flooding the console and trapping the user on the spinner. Cap
      // consecutive failures and surface a real error instead.
      if (data.status === 'running' || data.status === 'extracting') {
        let consecutiveFailures = 0
        const MAX_FAILURES = 5
        const fail = () => {
          if (++consecutiveFailures >= MAX_FAILURES) {
            if (pollInterval) clearInterval(pollInterval)
            setError('Lost connection while waiting for the backtest. Refresh to retry.')
          }
        }
        pollInterval = setInterval(async () => {
          try {
            const { data: updated, error: pollError } = await supabase
              .from('backtest_runs')
              .select('*')
              .eq('id', backtestId)
              .single()

            if (pollError || !updated) return fail()

            consecutiveFailures = 0
            setRun(updated as BacktestRun)
            if (updated.status === 'complete' || updated.status === 'error' || updated.status === 'extracted') {
              if (pollInterval) clearInterval(pollInterval)
            }
          } catch {
            fail()
          }
        }, 5000)
      }
    }

    fetchRun()

    return () => {
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [backtestId])

  const handleExport = useCallback(() => {
    if (!run || !run.result) return
    const result = run.result as BacktestResult
    const exportData = {
      strategy: run.strategy_name,
      pair: run.pair,
      market: run.market,
      timeframe: run.timeframe,
      date_from: run.date_from,
      date_to: run.date_to,
      starting_capital: run.starting_capital,
      stats: {
        total_trades: result.total_trades,
        winning_trades: result.winning_trades,
        losing_trades: result.losing_trades,
        win_rate: result.win_rate,
        total_pnl_usd: result.total_pnl_usd,
        total_pnl_pct: result.total_pnl_pct,
        max_drawdown_pct: result.max_drawdown_pct,
        avg_rr: result.avg_rr,
        profit_factor: result.profit_factor,
        expectancy: result.expectancy,
        sharpe_ratio: result.sharpe_ratio,
      },
      trade_log: result.trade_log,
      equity_curve: result.equity_curve,
      drawdown_curve: result.drawdown_curve,
      monthly_returns: result.monthly_returns,
      personality_reviews: run.personality_reviews,
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `backtest-${run.strategy_name?.replace(/\s+/g, '-').toLowerCase() ?? run.id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [run])

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center gap-3 text-zinc-400">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span>Loading backtest…</span>
      </div>
    )
  }

  if (error || !run) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <AlertTriangle className="h-10 w-10 text-[#FF4D4D]" />
        <p className="text-sm text-zinc-400">{error || 'Backtest not found'}</p>
        <Link href="/backtest">
          <Button variant="outline" className="border-zinc-800 text-zinc-400">
            ← Back to Backtest
          </Button>
        </Link>
      </div>
    )
  }

  if (run.status === 'running' || run.status === 'extracting') {
    return (
      <div className="space-y-6">
        <Link href="/backtest" className="text-sm text-zinc-500 transition-colors hover:text-white">
          ← Backtest
        </Link>
        <div className="flex h-72 flex-col items-center justify-center gap-4">
          <div className="relative">
            <Loader2 className="h-12 w-12 animate-spin text-[#00FF9C]" />
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-white">Running Backtest…</p>
            <p className="mt-1 text-sm text-zinc-400">
              Processing candles and simulating trades. This may take a few minutes.
            </p>
          </div>
          <p className="font-mono text-xs text-zinc-600">Strategy: {run.strategy_name}</p>
        </div>
      </div>
    )
  }

  if (run.status === 'extracted' || run.status === 'approved') {
    return (
      <div className="space-y-6">
        <Link href="/backtest" className="text-sm text-zinc-500 transition-colors hover:text-white">
          ← Backtest
        </Link>
        <Card className="border-amber-500/30 bg-[#12141A]">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <p className="text-lg font-semibold text-white">Rules Ready for Review</p>
            <p className="max-w-lg text-center text-sm text-zinc-400">
              Strategy rules have been extracted. Review and approve them to start the backtest.
            </p>
            <Link href={`/backtest/${run.id}/review`}>
              <Button className="gap-2 bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90">
                Review & Run
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (run.status === 'error') {
    return (
      <div className="space-y-6">
        <Link href="/backtest" className="text-sm text-zinc-500 transition-colors hover:text-white">
          ← Backtest
        </Link>
        <Card className="border-[#FF4D4D]/30 bg-[#12141A]">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <AlertTriangle className="h-10 w-10 text-[#FF4D4D]" />
            <p className="text-lg font-semibold text-white">Backtest Failed</p>
            <p className="max-w-lg text-center text-sm text-zinc-400">
              {run.ai_report || 'An error occurred during backtest processing. Please try again.'}
            </p>
            <Link href="/backtest">
              <Button variant="outline" className="border-zinc-800 text-zinc-400">
                Try Again
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const result = run.result as BacktestResult | null
  if (!result) {
    return (
      <div className="py-20 text-center text-sm text-zinc-500">
        No result data available.
      </div>
    )
  }

  const reviews = (run.personality_reviews as BacktestPersonalityReview[] | null) ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/backtest" className="text-sm text-zinc-500 transition-colors hover:text-white">
          ← Backtest
        </Link>
        <Separator orientation="vertical" className="h-4" />
        <h1 className="text-2xl font-bold tracking-tight text-white">
          {run.strategy_name}
        </h1>
        <Badge variant="outline" className="border-zinc-700 text-zinc-400">
          {run.pair}
        </Badge>
        <Badge variant="outline" className="font-mono text-zinc-500">
          {run.timeframe}
        </Badge>
        <Badge variant="outline" className="text-zinc-500">
          {run.date_from} → {run.date_to}
        </Badge>
        <div className="ml-auto">
          <Button
            variant="outline"
            className="gap-2 border-zinc-800 text-zinc-400 hover:text-white"
            onClick={handleExport}
          >
            <Download className="h-4 w-4" />
            Export JSON
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          icon={<Percent className="h-4 w-4" />}
          label="Win Rate"
          value={`${result.win_rate.toFixed(1)}%`}
          valueClass={result.win_rate >= 50 ? 'text-[#00FF9C]' : 'text-[#FF4D4D]'}
        />
        <StatCard
          icon={result.total_pnl_usd >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          label="Total PnL"
          value={`$${result.total_pnl_usd >= 0 ? '+' : ''}${result.total_pnl_usd.toFixed(2)}`}
          valueClass={result.total_pnl_usd >= 0 ? 'text-[#00FF9C]' : 'text-[#FF4D4D]'}
        />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Max Drawdown"
          value={`-${result.max_drawdown_pct.toFixed(1)}%`}
          valueClass="text-[#FF4D4D]"
        />
        <StatCard
          icon={<Target className="h-4 w-4" />}
          label="Profit Factor"
          value={result.profit_factor.toFixed(2)}
          valueClass={result.profit_factor >= 1.5 ? 'text-[#00FF9C]' : result.profit_factor >= 1 ? 'text-yellow-400' : 'text-[#FF4D4D]'}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Expectancy"
          value={`$${result.expectancy.toFixed(2)}`}
          valueClass={result.expectancy >= 0 ? 'text-[#00FF9C]' : 'text-[#FF4D4D]'}
        />
        <StatCard
          icon={<BarChart3 className="h-4 w-4" />}
          label="Total Trades"
          value={result.total_trades.toString()}
          valueClass="text-white"
        />
      </div>

      {/* Engine warnings — surface *why* a run (often 0-trade) came up empty
          instead of a silent blank. References unknown series, missing level
          context, etc. Render first so it's not buried under the charts. */}
      {result.warnings && result.warnings.length > 0 && (
        <Card className="border-yellow-700/60 bg-yellow-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-yellow-400">
              <AlertTriangle className="h-4 w-4" />
              Engine Warnings ({result.warnings.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i} className="text-xs font-mono text-yellow-200/80">• {w}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-yellow-200/50">
              These conditions could not be resolved by the engine and were effectively skipped.
              Add the referenced indicator (e.g. SWING_POINTS or PREV_DAY_HL) or use a reserved
              series name in the rule editor.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Charts row: Equity + Drawdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-zinc-800 bg-[#12141A]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-zinc-400">Equity Curve</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64" style={{ minHeight: 256 }}>
              <EquityCurveChart data={result.equity_curve} startingCapital={run.starting_capital} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-[#12141A]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-zinc-400">Drawdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64" style={{ minHeight: 256 }}>
              <DrawdownChart data={result.drawdown_curve} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Returns */}
      {result.monthly_returns.length > 0 && (
        <Card className="border-zinc-800 bg-[#12141A]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-zinc-400">Monthly Returns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56" style={{ minHeight: 224 }}>
              <MonthlyReturnsChart data={result.monthly_returns} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Personality Reviews */}
      {reviews.length > 0 && (
        <Card className="border-zinc-800 bg-[#12141A]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-400">
              <Users className="h-4 w-4" />
              AI Personality Reviews ({reviews.length}/5)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {reviews.map((review) => (
                <PersonalityReviewCard key={review.personality} review={review} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Narrative Report — full width */}
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-zinc-400">AI Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="prose prose-invert prose-sm max-w-none prose-headings:text-zinc-200 prose-p:text-zinc-400 prose-strong:text-zinc-200 prose-li:text-zinc-400">
            {run.ai_report ? (
              <MarkdownRenderer content={run.ai_report} />
            ) : (
              <p className="text-sm text-zinc-500">No AI report available.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Trade Log — full width */}
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-zinc-400">
            Trade Log ({result.trade_log.length} trades)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-x-auto overflow-y-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left">
                  <th className="pb-2 text-xs font-medium text-zinc-500">#</th>
                  <th className="pb-2 text-xs font-medium text-zinc-500">Time</th>
                  <th className="pb-2 text-xs font-medium text-zinc-500">Dir</th>
                  <th className="pb-2 text-xs font-medium text-zinc-500 text-right">Entry</th>
                  <th className="pb-2 text-xs font-medium text-zinc-500 text-right">Exit</th>
                  <th className="pb-2 text-xs font-medium text-zinc-500 text-right">PnL</th>
                  <th className="pb-2 text-xs font-medium text-zinc-500">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {result.trade_log.map((trade, i) => (
                  <tr key={i} className="text-zinc-300">
                    <td className="py-2 font-mono text-xs text-zinc-600">{i + 1}</td>
                    <td className="py-2 font-mono text-xs">
                      {new Date(trade.entryTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="py-2">
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          trade.direction === 'long'
                            ? 'border-[#00FF9C]/30 text-[#00FF9C]'
                            : 'border-[#FF4D4D]/30 text-[#FF4D4D]'
                        }`}
                      >
                        {trade.direction.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="py-2 text-right font-mono text-xs">
                      {trade.entryPrice.toFixed(5)}
                    </td>
                    <td className="py-2 text-right font-mono text-xs">
                      {trade.exitPrice.toFixed(5)}
                    </td>
                    <td className={`py-2 text-right font-mono text-xs font-semibold ${
                      trade.pnlUsd >= 0 ? 'text-[#00FF9C]' : 'text-[#FF4D4D]'
                    }`}>
                      {trade.pnlUsd >= 0 ? '+' : ''}${trade.pnlUsd.toFixed(2)}
                    </td>
                    <td className="py-2 text-xs text-zinc-500">
                      {trade.exitReason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <Card className="border-zinc-800 bg-[#12141A]">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`flex h-8 w-8 items-center justify-center rounded-md ${
          valueClass === 'text-[#00FF9C]' ? 'bg-[#00FF9C]/10 text-[#00FF9C]'
            : valueClass === 'text-[#FF4D4D]' ? 'bg-[#FF4D4D]/10 text-[#FF4D4D]'
            : 'bg-zinc-800 text-zinc-400'
        }`}>
          {icon}
        </div>
        <div>
          <p className="text-xs text-zinc-500">{label}</p>
          <p className={`font-mono text-lg font-semibold ${valueClass ?? 'text-white'}`}>
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function EquityCurveChart({
  data,
  startingCapital,
}: {
  data: { time: string; equity: number }[]
  startingCapital: number
}) {
  if (data.length < 2) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Not enough data points for equity curve
      </div>
    )
  }

  const sampled = data.length > 200
    ? data.filter((_, i) => i % Math.ceil(data.length / 200) === 0 || i === data.length - 1)
    : data

  const isProfitable = data[data.length - 1].equity >= startingCapital
  const lineColor = isProfitable ? '#00FF9C' : '#FF4D4D'

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={sampled} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <defs>
          <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity={0.15} />
            <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="time"
          tick={{ fontSize: 10, fill: '#71717A' }}
          tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#71717A' }}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          axisLine={false}
          tickLine={false}
          domain={['auto', 'auto']}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1C1E26',
            border: '1px solid #27272A',
            borderRadius: 6,
            fontSize: 12,
            color: '#E4E4E7',
          }}
          labelFormatter={(v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Equity']}
        />
        <ReferenceLine y={startingCapital} stroke="#71717A" strokeDasharray="4 4" strokeWidth={1} />
        <Area type="monotone" dataKey="equity" stroke={lineColor} strokeWidth={2} fill="url(#equityGradient)" dot={false} activeDot={{ r: 3, fill: lineColor }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function DrawdownChart({ data }: { data: DrawdownPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Not enough data points for drawdown chart
      </div>
    )
  }

  const sampled = data.length > 200
    ? data.filter((_, i) => i % Math.ceil(data.length / 200) === 0 || i === data.length - 1)
    : data

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={sampled} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <defs>
          <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF4D4D" stopOpacity={0} />
            <stop offset="100%" stopColor="#FF4D4D" stopOpacity={0.2} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="time"
          tick={{ fontSize: 10, fill: '#71717A' }}
          tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#71717A' }}
          tickFormatter={(v) => `${v}%`}
          axisLine={false}
          tickLine={false}
          domain={['auto', 0]}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1C1E26',
            border: '1px solid #27272A',
            borderRadius: 6,
            fontSize: 12,
            color: '#E4E4E7',
          }}
          labelFormatter={(v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Drawdown']}
        />
        <ReferenceLine y={0} stroke="#71717A" strokeWidth={1} />
        <Area type="monotone" dataKey="drawdown_pct" stroke="#FF4D4D" strokeWidth={1.5} fill="url(#drawdownGradient)" dot={false} activeDot={{ r: 3, fill: '#FF4D4D' }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function MonthlyReturnsChart({ data }: { data: MonthlyReturn[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        No monthly return data
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <XAxis
          dataKey="month"
          tick={{ fontSize: 10, fill: '#71717A' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#71717A' }}
          tickFormatter={(v) => `${v}%`}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1C1E26',
            border: '1px solid #27272A',
            borderRadius: 6,
            fontSize: 12,
            color: '#E4E4E7',
          }}
          formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Return']}
        />
        <ReferenceLine y={0} stroke="#71717A" strokeWidth={1} />
        <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.pct >= 0 ? '#00FF9C' : '#FF4D4D'} fillOpacity={0.7} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function PersonalityReviewCard({ review }: { review: BacktestPersonalityReview }) {
  const [expanded, setExpanded] = useState(false)

  const gradeColor: Record<string, string> = {
    A: 'text-[#00FF9C]',
    B: 'text-[#00FF9C]/80',
    C: 'text-yellow-400',
    D: 'text-amber-500',
    F: 'text-[#FF4D4D]',
  }

  const avgScore = (
    (review.rule_quality + review.risk_management + review.strategy_consistency + review.robustness + review.overall) / 5
  ).toFixed(1)

  const scores = [
    { label: 'Rules', value: review.rule_quality },
    { label: 'Risk', value: review.risk_management },
    { label: 'Consistency', value: review.strategy_consistency },
    { label: 'Robustness', value: review.robustness },
    { label: 'Overall', value: review.overall },
  ]

  // NIM may omit these arrays from its JSON — default to empty to avoid runtime crashes.
  const strengths = review.strengths ?? []
  const weaknesses = review.weaknesses ?? []
  const improvements = review.improvements ?? []

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#0A0B0E] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-zinc-300 truncate">{review.personality}</span>
        <div className="flex items-center gap-1.5">
          <Award className={`h-4 w-4 ${gradeColor[review.grade] ?? 'text-zinc-400'}`} />
          <span className={`font-mono text-lg font-bold ${gradeColor[review.grade] ?? 'text-zinc-400'}`}>
            {review.grade}
          </span>
        </div>
      </div>

      {/* Average score */}
      <div className="flex items-center gap-2 mb-3">
        <div className="h-1.5 flex-1 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className={`h-full rounded-full ${Number(avgScore) >= 7 ? 'bg-[#00FF9C]' : Number(avgScore) >= 5 ? 'bg-yellow-400' : 'bg-[#FF4D4D]'}`}
            style={{ width: `${(Number(avgScore) / 10) * 100}%` }}
          />
        </div>
        <span className="font-mono text-xs text-zinc-500">{avgScore}/10</span>
      </div>

      {/* Score bars */}
      <div className="space-y-1.5 mb-3">
        {scores.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 w-20">{s.label}</span>
            <div className="h-1 flex-1 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${s.value >= 7 ? 'bg-[#00FF9C]' : s.value >= 5 ? 'bg-yellow-400' : 'bg-[#FF4D4D]'}`}
                style={{ width: `${(s.value / 10) * 100}%` }}
              />
            </div>
            <span className="font-mono text-[10px] text-zinc-600">{s.value}</span>
          </div>
        ))}
      </div>

      {/* Verdict */}
      <p className="text-[11px] text-zinc-400 leading-relaxed mb-2">{review.verdict}</p>

      {/* Prop firm suitability */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`h-1.5 w-1.5 rounded-full ${review.prop_firm_suitable ? 'bg-[#00FF9C]' : 'bg-[#FF4D4D]'}`} />
        <span className="text-[10px] text-zinc-500">
          {review.prop_firm_suitable ? 'Prop-firm suitable' : 'Not prop-firm suitable'}
        </span>
      </div>

      {/* Expandable details */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? 'Less' : 'Details'}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 text-[10px]">
          {strengths.length > 0 && (
            <div>
              <p className="text-[#00FF9C]/80 font-semibold mb-1">Strengths</p>
              <ul className="space-y-0.5 pl-3 list-disc">
                {strengths.map((s, i) => (
                  <li key={i} className="text-zinc-500">{s}</li>
                ))}
              </ul>
            </div>
          )}
          {weaknesses.length > 0 && (
            <div>
              <p className="text-[#FF4D4D]/80 font-semibold mb-1">Weaknesses</p>
              <ul className="space-y-0.5 pl-3 list-disc">
                {weaknesses.map((w, i) => (
                  <li key={i} className="text-zinc-500">{w}</li>
                ))}
              </ul>
            </div>
          )}
          {improvements.length > 0 && (
            <div>
              <p className="text-sky-400/80 font-semibold mb-1">Improvements</p>
              <ul className="space-y-0.5 pl-3 list-disc">
                {improvements.map((imp, i) => (
                  <li key={i} className="text-zinc-500">{imp}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Minimal markdown renderer — no external deps needed for headings, bold, lists, paragraphs */
function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let listItems: string[] = []
  let inList = false

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-2 space-y-1 pl-4 list-disc">
          {listItems.map((item, i) => (
            <li key={i} className="text-zinc-400 text-sm">{renderInline(item)}</li>
          ))}
        </ul>
      )
      listItems = []
    }
    inList = false
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/)
    if (headingMatch) {
      flushList()
      const level = headingMatch[1].length
      const text = headingMatch[2]
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements
      const sizeClass = level === 1 ? 'text-lg' : level === 2 ? 'text-base' : 'text-sm'
      elements.push(
        <Tag key={elements.length} className={`${sizeClass} font-semibold text-zinc-200 mt-4 mb-2`}>
          {renderInline(text)}
        </Tag>
      )
      continue
    }

    const liMatch = line.match(/^[-*]\s+(.+)/)
    if (liMatch) {
      inList = true
      listItems.push(liMatch[1])
      continue
    }

    flushList()

    if (line.trim() === '') {
      elements.push(<br key={elements.length} />)
    } else {
      elements.push(
        <p key={elements.length} className="text-sm text-zinc-400 my-1 leading-relaxed">
          {renderInline(line)}
        </p>
      )
    }
  }

  flushList()
  return <>{elements}</>
}

/** Render inline markdown: bold and italic */
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-zinc-200">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    return part
  })
}
