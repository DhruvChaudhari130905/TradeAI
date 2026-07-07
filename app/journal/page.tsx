'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getTrades } from '@/lib/actions/trades'
import { Plus, Search, TrendingUp, TrendingDown, Minus, BarChart3, Target, Percent, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import type { Trade } from '@/lib/types/trade'

type TradeRow = Trade & {
  trade_reviews: { composite_score: number | null }[]
}

export default function JournalPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [trades, setTrades] = useState<TradeRow[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [market, setMarket] = useState(searchParams.get('market') ?? '')
  const [outcome, setOutcome] = useState(searchParams.get('outcome') ?? '')
  const [direction, setDirection] = useState(searchParams.get('direction') ?? '')
  const [pairSearch, setPairSearch] = useState(searchParams.get('pair') ?? '')
  const [dateFrom, setDateFrom] = useState(searchParams.get('from') ?? '')
  const [dateTo, setDateTo] = useState(searchParams.get('to') ?? '')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const result = await getTrades({
        market: market || undefined,
        outcome: outcome || undefined,
        direction: direction || undefined,
        pair: pairSearch || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      })
      if (result.success) {
        setTrades(result.data as TradeRow[])
      }
      setLoading(false)
    }
    load()
  }, [market, outcome, direction, pairSearch, dateFrom, dateTo])

  // Summary stats
  const stats = useMemo(() => {
    const total = trades.length
    const wins = trades.filter((t) => t.outcome === 'win').length
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0'
    const totalPnl = trades.reduce((sum, t) => sum + (Number(t.pnl_usd) || 0), 0)
    const rrTrades = trades.filter((t) => t.risk_reward_ratio != null)
    const avgRR = rrTrades.length > 0
      ? (rrTrades.reduce((sum, t) => sum + (Number(t.risk_reward_ratio) || 0), 0) / rrTrades.length).toFixed(2)
      : '—'

    return { total, winRate, totalPnl, avgRR }
  }, [trades])

  const hasFilters = market || outcome || direction || pairSearch || dateFrom || dateTo

  const clearFilters = () => {
    setMarket('')
    setOutcome('')
    setDirection('')
    setPairSearch('')
    setDateFrom('')
    setDateTo('')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Trade Journal
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Review, filter, and analyze your trading history.
          </p>
        </div>
        <Link href="/journal/new">
          <Button className="gap-2 bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90">
            <Plus className="h-4 w-4" />
            Log Trade
          </Button>
        </Link>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="border-zinc-800 bg-[#12141A]">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#00FF9C]/10">
              <BarChart3 className="h-5 w-5 text-[#00FF9C]" />
            </div>
            <div>
              <p className="text-xs text-zinc-500">Total Trades</p>
              <p className="font-mono text-xl font-semibold text-white">{stats.total}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-[#12141A]">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#00FF9C]/10">
              <Percent className="h-5 w-5 text-[#00FF9C]" />
            </div>
            <div>
              <p className="text-xs text-zinc-500">Win Rate</p>
              <p className="font-mono text-xl font-semibold text-white">{stats.winRate}%</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-[#12141A]">
          <CardContent className="flex items-center gap-3 p-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${stats.totalPnl >= 0 ? 'bg-[#00FF9C]/10' : 'bg-[#FF4D4D]/10'}`}>
              {stats.totalPnl >= 0 ? (
                <TrendingUp className="h-5 w-5 text-[#00FF9C]" />
              ) : (
                <TrendingDown className="h-5 w-5 text-[#FF4D4D]" />
              )}
            </div>
            <div>
              <p className="text-xs text-zinc-500">Total PnL</p>
              <p className={`font-mono text-xl font-semibold ${stats.totalPnl >= 0 ? 'text-[#00FF9C]' : 'text-[#FF4D4D]'}`}>
                ${stats.totalPnl.toFixed(2)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-[#12141A]">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#3B82F6]/10">
              <Target className="h-5 w-5 text-[#3B82F6]" />
            </div>
            <div>
              <p className="text-xs text-zinc-500">Avg R:R</p>
              <p className="font-mono text-xl font-semibold text-white">1:{stats.avgRR}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3 lg:flex lg:flex-wrap">
        <div className="w-full lg:w-36">
          <Select value={market} onValueChange={(v) => setMarket(v ?? '')}>
            <SelectTrigger className="h-9 border-zinc-800 bg-[#12141A] text-sm text-white">
              <SelectValue placeholder="Market" />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-[#12141A]">
              <SelectItem value="__all__" className="text-zinc-500">All</SelectItem>
              <SelectItem value="forex" className="text-white">Forex</SelectItem>
              <SelectItem value="crypto" className="text-white">Crypto</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-full lg:w-36">
          <Select value={outcome} onValueChange={(v) => setOutcome(v ?? '')}>
            <SelectTrigger className="h-9 border-zinc-800 bg-[#12141A] text-sm text-white">
              <SelectValue placeholder="Outcome" />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-[#12141A]">
              <SelectItem value="__all__" className="text-zinc-500">All</SelectItem>
              <SelectItem value="win" className="text-white">Win</SelectItem>
              <SelectItem value="loss" className="text-white">Loss</SelectItem>
              <SelectItem value="breakeven" className="text-white">Breakeven</SelectItem>
              <SelectItem value="open" className="text-white">Open</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-full lg:w-36">
          <Select value={direction} onValueChange={(v) => setDirection(v ?? '')}>
            <SelectTrigger className="h-9 border-zinc-800 bg-[#12141A] text-sm text-white">
              <SelectValue placeholder="Direction" />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-[#12141A]">
              <SelectItem value="__all__" className="text-zinc-500">All</SelectItem>
              <SelectItem value="long" className="text-white">Long</SelectItem>
              <SelectItem value="short" className="text-white">Short</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-full lg:w-44">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <Input
              placeholder="Search pair…"
              value={pairSearch}
              onChange={(e) => setPairSearch(e.target.value)}
              className="h-9 border-zinc-800 bg-[#12141A] pl-8 text-sm text-white placeholder:text-zinc-600"
            />
          </div>
        </div>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-9 w-full border-zinc-800 bg-[#12141A] text-sm text-white lg:w-32"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="h-9 w-full border-zinc-800 bg-[#12141A] text-sm text-white lg:w-32"
        />
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-9 text-xs text-zinc-400 hover:text-white sm:w-fit"
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Trade List */}
      {loading ? (
        <div className="py-20 text-center text-sm text-zinc-500">
          Loading trades…
        </div>
      ) : trades.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#00FF9C]/10 mb-4">
            <BookOpen className="h-8 w-8 text-[#00FF9C]" />
          </div>
          <h2 className="text-lg font-semibold text-white">No trades yet</h2>
          <p className="mt-1 text-sm text-zinc-500 max-w-sm text-center">
            Start documenting your trades to track performance, get AI reviews, and unlock analytics.
          </p>
          <Link href="/journal/new">
            <Button className="mt-4 gap-2 bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90">
              <Plus className="h-4 w-4" />
              Log your first trade
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {trades.map((trade) => {
            const compositeScore = trade.trade_reviews?.[0]?.composite_score
            const pnl = Number(trade.pnl_usd) || 0
            return (
              <Link
                key={trade.id}
                href={`/journal/${trade.id}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-[#12141A] px-4 py-3 transition-colors hover:border-zinc-700 sm:flex-nowrap sm:gap-4"
              >
                {/* Pair */}
                <span className="min-w-0 flex-1 font-mono text-sm font-semibold text-white sm:w-24 sm:flex-none">
                  {trade.pair}
                </span>

                {/* Direction badge */}
                <Badge
                  variant="outline"
                  className={`w-16 justify-center text-xs ${
                    trade.direction === 'long'
                      ? 'border-[#00FF9C]/30 text-[#00FF9C]'
                      : 'border-[#FF4D4D]/30 text-[#FF4D4D]'
                  }`}
                >
                  {trade.direction.toUpperCase()}
                </Badge>

                {/* Outcome badge */}
                <Badge
                  variant="outline"
                  className={`w-20 justify-center text-xs ${
                    trade.outcome === 'win'
                      ? 'border-[#00FF9C]/30 bg-[#00FF9C]/5 text-[#00FF9C]'
                      : trade.outcome === 'loss'
                        ? 'border-[#FF4D4D]/30 bg-[#FF4D4D]/5 text-[#FF4D4D]'
                        : trade.outcome === 'breakeven'
                          ? 'border-yellow-500/30 bg-yellow-500/5 text-yellow-400'
                          : 'border-zinc-700 text-zinc-500'
                  }`}
                >
                  {trade.outcome
                    ? trade.outcome.charAt(0).toUpperCase() + trade.outcome.slice(1)
                    : '—'}
                </Badge>

                {/* Entry time */}
                <span className="hidden w-36 text-sm text-zinc-400 sm:inline">
                  {trade.entry_time
                    ? new Date(trade.entry_time).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </span>

                {/* PnL */}
                <span
                  className={`font-mono text-sm font-semibold sm:w-24 ${
                    pnl > 0 ? 'text-[#00FF9C]' : pnl < 0 ? 'text-[#FF4D4D]' : 'text-zinc-500'
                  }`}
                >
                  {pnl !== 0 ? `$${pnl.toFixed(2)}` : '—'}
                </span>

                {/* R:R */}
                <span className="hidden w-16 font-mono text-sm text-zinc-400 sm:inline">
                  {trade.risk_reward_ratio ? `1:${Number(trade.risk_reward_ratio).toFixed(1)}` : '—'}
                </span>

                {/* AI Score or "Not reviewed" */}
                <span className="ml-auto text-sm">
                  {compositeScore != null ? (
                    <Badge className="bg-[#00FF9C]/10 text-[#00FF9C]">
                      {compositeScore}/10
                    </Badge>
                  ) : (
                    <span className="text-xs text-zinc-600">Not reviewed</span>
                  )}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
