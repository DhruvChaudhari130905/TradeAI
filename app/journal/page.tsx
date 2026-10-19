'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getTrades } from '@/lib/actions/trades'
import { Plus, Search, X } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Segmented } from '@/components/ui/segmented'
import { StatStrip } from '@/components/ui/stat-strip'
import { DirectionTag, OutcomeBadge } from '@/components/journal/TradeBadges'
import { formatRR, formatUsd, pnlTone } from '@/lib/format'
import type { Trade } from '@/lib/types/trade'

type TradeRow = Trade & {
  trade_reviews: { composite_score: number | null }[]
}

const ALL = 'all'

const FILTERS = {
  market: { label: 'Market', options: [['forex', 'Forex'], ['crypto', 'Crypto']] },
  outcome: { label: 'Result', options: [['win', 'Win'], ['loss', 'Loss'], ['breakeven', 'Breakeven'], ['open', 'Open']] },
  direction: { label: 'Side', options: [['long', 'Long'], ['short', 'Short']] },
} as const

function formatWhen(iso: string | null | undefined) {
  return iso
    ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—'
}

export default function JournalPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [trades, setTrades] = useState<TradeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sourceTab, setSourceTab] = useState<'live' | 'backtest'>('live')

  // Filters ('' = no filter)
  const [market, setMarket] = useState(searchParams.get('market') ?? '')
  const [outcome, setOutcome] = useState(searchParams.get('outcome') ?? '')
  const [direction, setDirection] = useState(searchParams.get('direction') ?? '')
  const [pairInput, setPairInput] = useState(searchParams.get('pair') ?? '')
  const [pairSearch, setPairSearch] = useState(pairInput)
  const [dateFrom, setDateFrom] = useState(searchParams.get('from') ?? '')
  const [dateTo, setDateTo] = useState(searchParams.get('to') ?? '')

  // Don't hit the server on every keystroke
  useEffect(() => {
    const id = setTimeout(() => setPairSearch(pairInput.trim()), 250)
    return () => clearTimeout(id)
  }, [pairInput])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const result = await getTrades({
        market: market || undefined,
        outcome: outcome || undefined,
        direction: direction || undefined,
        pair: pairSearch || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        source: sourceTab,
      })
      if (cancelled) return
      if (result.success) setTrades(result.data as TradeRow[])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [sourceTab, market, outcome, direction, pairSearch, dateFrom, dateTo])

  const stats = useMemo(() => {
    const wins = trades.filter((t) => t.outcome === 'win').length
    const losses = trades.filter((t) => t.outcome === 'loss').length
    const totalPnl = trades.reduce((sum, t) => sum + (Number(t.pnl_usd) || 0), 0)
    const rr = trades.map((t) => Number(t.risk_reward_ratio)).filter((n) => Number.isFinite(n) && n > 0)
    return {
      total: trades.length,
      wins,
      losses,
      winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : null,
      totalPnl,
      avgRR: rr.length ? rr.reduce((a, b) => a + b, 0) / rr.length : null,
    }
  }, [trades])

  const hasFilters = Boolean(market || outcome || direction || pairSearch || dateFrom || dateTo)

  const clearFilters = () => {
    setMarket('')
    setOutcome('')
    setDirection('')
    setPairInput('')
    setPairSearch('')
    setDateFrom('')
    setDateTo('')
  }

  const filterState = { market: [market, setMarket], outcome: [outcome, setOutcome], direction: [direction, setDirection] } as const

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Journal</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Every trade you’ve logged, with its AI review score.</p>
        </div>
        <Link href="/journal/new" className={buttonVariants({ size: 'lg', className: 'gap-1.5 px-3' })}>
          <Plus className="h-4 w-4" aria-hidden />
          Log trade
        </Link>
      </div>

      <Segmented
        label="Trade source"
        size="md"
        value={sourceTab}
        onChange={setSourceTab}
        options={[{ value: 'live', label: 'Live trades' }, { value: 'backtest', label: 'Replay trades' }]}
      />

      <StatStrip
        items={[
          { label: 'Trades', value: String(stats.total), sub: `${stats.wins}W · ${stats.losses}L` },
          { label: 'Win rate', value: stats.winRate != null ? `${stats.winRate.toFixed(1)}%` : '—', sub: 'of closed trades' },
          { label: 'Net P&L', value: formatUsd(stats.totalPnl, { signed: true }), tone: pnlTone(stats.totalPnl) },
          { label: 'Avg planned R:R', value: formatRR(stats.avgRR) },
        ]}
      />

      {/* Filters */}
      <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-center">
        <div className="relative col-span-2 sm:col-span-3 lg:w-48">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search by pair"
            placeholder="Search pair, e.g. EUR"
            value={pairInput}
            onChange={(e) => setPairInput(e.target.value)}
            className="h-9 border-border bg-card pl-8 text-sm"
          />
        </div>
        {(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((key) => {
          const f = FILTERS[key]
          const [value, setValue] = filterState[key]
          return (
            <div key={key} className="lg:w-36">
              <Select
                value={value || ALL}
                onValueChange={(v) => setValue(!v || v === ALL ? '' : String(v))}
                items={{ [ALL]: `All ${f.label.toLowerCase()}s`, ...Object.fromEntries(f.options) }}
              >
                <SelectTrigger aria-label={f.label} className="h-9 border-border bg-card text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-card">
                  <SelectItem value={ALL}>All {f.label.toLowerCase()}s</SelectItem>
                  {f.options.map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        })}
        <label className="col-span-1 flex flex-col gap-1 text-xs text-muted-foreground lg:ml-1 lg:flex-row lg:items-center lg:gap-2">
          From
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 border-border bg-card text-sm lg:w-36" />
        </label>
        <label className="col-span-1 flex flex-col gap-1 text-xs text-muted-foreground lg:flex-row lg:items-center lg:gap-2">
          To
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 border-border bg-card text-sm lg:w-36" />
        </label>
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters} className="h-9 gap-1 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </Button>
        )}
      </div>

      {/* Trade list */}
      {loading ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card" aria-busy="true" aria-label="Loading trades">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              <div className="h-4 w-12 animate-pulse rounded bg-muted" />
              <div className="ml-auto h-4 w-20 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : trades.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-6 py-14 text-center">
          {hasFilters ? (
            <>
              <h2 className="text-sm font-semibold text-foreground">No trades match these filters</h2>
              <Button variant="outline" onClick={clearFilters} className="mt-4">Clear filters</Button>
            </>
          ) : sourceTab === 'backtest' ? (
            <>
              <h2 className="text-sm font-semibold text-foreground">No replay trades yet</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Trades you place in a replay session are logged here automatically.
              </p>
              <Link href="/backtest" className={buttonVariants({ variant: 'outline', className: 'mt-4' })}>Start a replay</Link>
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-foreground">Your journal is empty</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Log a trade with its entry, stop and target. Five AI reviewers will score it and name the mistake to fix.
              </p>
              <Link href="/journal/new" className={buttonVariants({ className: 'mt-4 gap-1.5' })}>
                <Plus className="h-4 w-4" aria-hidden /> Log your first trade
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Desktop/tablet: table */}
          <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Trades, newest first</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 font-medium">Pair</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Side</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Result</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">{sourceTab === 'backtest' ? 'Entered (replay time)' : 'Entered'}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">P&amp;L</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">R:R</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">AI score</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => {
                  const score = trade.trade_reviews?.[0]?.composite_score
                  const pnl = trade.pnl_usd != null ? Number(trade.pnl_usd) : null
                  return (
                    <tr
                      key={trade.id}
                      onClick={() => router.push(`/journal/${trade.id}`)}
                      className="cursor-pointer border-b border-border transition-colors duration-150 last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-4 py-3">
                        <Link href={`/journal/${trade.id}`} className="rounded font-mono font-semibold text-foreground" onClick={(e) => e.stopPropagation()}>
                          {trade.pair}
                        </Link>
                      </td>
                      <td className="px-3 py-3"><DirectionTag direction={trade.direction} /></td>
                      <td className="px-3 py-3"><OutcomeBadge outcome={trade.outcome} /></td>
                      <td className="px-3 py-3 text-muted-foreground">{formatWhen(trade.entry_time)}</td>
                      <td className={`px-3 py-3 text-right font-mono font-semibold ${pnlTone(pnl)}`}>
                        {trade.outcome === 'open' ? '—' : formatUsd(pnl, { signed: true })}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-muted-foreground">{formatRR(trade.risk_reward_ratio, 1)}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {score != null ? (
                          <span className="text-foreground">{Number(score).toFixed(1)}</span>
                        ) : (
                          <span className="font-sans text-xs text-muted-foreground">Not reviewed</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Phone: two-line rows */}
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card md:hidden">
            {trades.map((trade) => {
              const score = trade.trade_reviews?.[0]?.composite_score
              const pnl = trade.pnl_usd != null ? Number(trade.pnl_usd) : null
              return (
                <li key={trade.id}>
                  <Link href={`/journal/${trade.id}`} className="block px-4 py-3 transition-colors active:bg-muted/50">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-foreground">{trade.pair}</span>
                        <DirectionTag direction={trade.direction} />
                      </span>
                      <span className={`font-mono text-sm font-semibold ${pnlTone(pnl)}`}>
                        {trade.outcome === 'open' ? '—' : formatUsd(pnl, { signed: true })}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <OutcomeBadge outcome={trade.outcome} />
                        {formatWhen(trade.entry_time)}
                      </span>
                      <span className="font-mono">{score != null ? `AI ${Number(score).toFixed(1)}` : 'Not reviewed'}</span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
