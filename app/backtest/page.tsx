'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Segmented } from '@/components/ui/segmented'
import { formatUsd, pnlTone } from '@/lib/format'
import { Play, Plus, Loader2, Trash2 } from 'lucide-react'
import {
  createReplaySession,
  listReplaySessions,
  deleteReplaySession,
} from '@/lib/actions/replay'
import { FOREX_PAIRS, CRYPTO_PAIRS, COMMODITY_PAIRS } from '@/lib/types/trade'
import { TIMEFRAMES } from '@/lib/types/replay'
import type { Timeframe } from '@/lib/types/replay'

// Default spread presets in pips (crypto pips = whole USD units of the coin)
const SPREAD_PRESETS: Record<string, number> = {
  'EUR/USD': 0.6, 'GBP/USD': 0.9, 'USD/JPY': 0.7, 'USD/CHF': 1.0,
  'AUD/USD': 0.8, 'NZD/USD': 1.2, 'USD/CAD': 1.2, 'EUR/GBP': 1.2,
  'EUR/JPY': 1.3, 'GBP/JPY': 2.0, 'EUR/CHF': 1.4, 'EUR/AUD': 1.5,
  'GBP/CHF': 2.0, 'GBP/AUD': 2.5, 'AUD/JPY': 1.5, 'NZD/JPY': 1.8,
  'CAD/JPY': 1.7, 'CHF/JPY': 1.8, 'AUD/NZD': 2.0, 'EUR/NZD': 2.5,
  'BTC/USD': 20, 'ETH/USD': 4, 'SOL/USD': 0.5, 'XRP/USD': 0.01,
  'ADA/USD': 0.01, 'DOGE/USD': 0.0005, 'AVAX/USD': 0.1, 'DOT/USD': 0.05,
  'MATIC/USD': 0.01, 'LINK/USD': 0.05, 'UNI/USD': 0.05, 'ATOM/USD': 0.05,
  'LTC/USD': 0.5, 'BCH/USD': 1, 'NEAR/USD': 0.02, 'ALGO/USD': 0.005,
  'FIL/USD': 0.02, 'HBAR/USD': 0.002, 'FTM/USD': 0.005, 'AAVE/USD': 0.5,
}

type SessionListItem = {
  id: string
  pair: string
  market: 'forex' | 'crypto'
  timeframes: Timeframe[]
  status: 'active' | 'complete' | 'abandoned'
  balance: number
  starting_balance: number
  created_at: string
}

export default function BacktestPage() {
  const router = useRouter()

  const [market, setMarket] = useState<'forex' | 'crypto'>('forex')
  const [pair, setPair] = useState('EUR/USD')
  const [timeframes, setTimeframes] = useState<Timeframe[]>(['15m', '4H'])
  const [balance, setBalance] = useState('10000')
  const [leverage, setLeverage] = useState('100')
  const [spreadPips, setSpreadPips] = useState('0.6')

  const [sessions, setSessions] = useState<SessionListItem[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDelete(sessionId: string) {
    if (!window.confirm('Delete this session? Journal trades recorded from it will be kept.')) return
    setDeletingId(sessionId)
    const res = await deleteReplaySession(sessionId)
    setDeletingId(null)
    if (res.success) {
      setSessions((prev) => prev?.filter((s) => s.id !== sessionId) ?? prev)
      toast.success('Session deleted.')
    } else {
      toast.error(res.error)
    }
  }

  // Display-only mirror of the server's fixed window (lib/actions/replay.ts)
  const rangeFromDate = (() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 11)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  useEffect(() => {
    listReplaySessions().then((res) => {
      if (res.success) setSessions(res.data)
      else setSessions([])
    })
  }, [])

  function handlePairChange(next: string | null) {
    if (!next) return
    setPair(next)
    setSpreadPips(String(SPREAD_PRESETS[next] ?? 1))
  }

  function handleMarketChange(next: 'forex' | 'crypto') {
    setMarket(next)
    if (next === 'crypto') {
      setPair('BTC/USD')
      setLeverage('1')
      setSpreadPips(String(SPREAD_PRESETS['BTC/USD'] ?? 1))
    } else {
      setPair('EUR/USD')
      setLeverage('100')
      setSpreadPips(String(SPREAD_PRESETS['EUR/USD'] ?? 1))
    }
  }

  function toggleTimeframe(tf: Timeframe) {
    setTimeframes((prev) => {
      if (prev.includes(tf)) return prev.filter((t) => t !== tf)
      if (prev.length >= 3) {
        toast.error('Max 3 timeframes per session.')
        return prev
      }
      return [...prev, tf]
    })
  }

  async function handleCreate() {
    if (timeframes.length === 0) {
      toast.error('Select at least one timeframe.')
      return
    }

    setCreating(true)
    try {
      const res = await createReplaySession({
        pair,
        market,
        timeframes: [...timeframes].sort(
          (a, b) => TIMEFRAMES.indexOf(a) - TIMEFRAMES.indexOf(b),
        ), // primary = lowest TF first
        startingBalance: Number(balance),
        leverage: Number(leverage),
        spreadPips: Number(spreadPips),
      })

      if (!res.success) {
        toast.error(res.error)
        return
      }

      // Warm candle data before redirect so replay opens instantly-ready or with clear error
      const candlesRes = await fetch(`/api/replay/${res.data.id}/candles`)
      if (!candlesRes.ok) {
        const body = await candlesRes.json().catch(() => null)
        toast.error(body?.error ?? 'Failed to fetch historical data.')
      }
      router.push(`/backtest/${res.data.id}/session`)
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  const activeSessions = sessions?.filter((s) => s.status === 'active') ?? []
  const pastSessions = sessions?.filter((s) => s.status !== 'active') ?? []

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Replay</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Trade historical price action bar by bar. Every trade you place is logged to your journal as a replay trade.
        </p>
      </div>

      {/* ── Active sessions (resume) ── */}
      {activeSessions.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Resume a session</CardTitle>
            <CardDescription>Pick up exactly where you left off.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeSessions.map((s) => (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/backtest/${s.id}/session`)}
                onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/backtest/${s.id}/session`) }}
                className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-muted"
              >
                <div>
                  <span className="font-mono font-medium">{s.pair}</span>
                  <span className="ml-2 flex gap-1 sm:inline-flex sm:ml-0">
                    {(s.timeframes as Timeframe[]).map((tf) => (
                      <Badge key={tf} variant="secondary" className="font-mono text-xs">{tf}</Badge>
                    ))}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Balance {formatUsd(Number(s.balance))} · started {new Date(s.created_at).toLocaleDateString()}
                  </span>
                </div>
                <span className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${s.pair} session`}
                    disabled={deletingId === s.id}
                    onClick={(e) => { e.stopPropagation(); handleDelete(s.id) }}
                    className="h-8 w-8 text-muted-foreground hover:bg-loss/10 hover:text-loss"
                  >
                    {deletingId === s.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                  </Button>
                  <Play className="h-4 w-4 text-primary" />
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── New session ── */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">New session</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Market */}
          <div className="space-y-2">
            <span className="block text-sm font-medium text-foreground">Market</span>
            <Segmented
              label="Market"
              size="md"
              value={market}
              onChange={handleMarketChange}
              options={[{ value: 'forex', label: 'Forex' }, { value: 'crypto', label: 'Crypto' }]}
            />
          </div>

          {/* Pair */}
          <div className="space-y-2">
            <Label htmlFor="pair-select">Pair</Label>
            <Select value={pair} onValueChange={handlePairChange}>
              <SelectTrigger id="pair-select" className="w-full border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64 border-border bg-card">
                {market === 'forex' ? (
                  <>
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Forex</div>
                    {FOREX_PAIRS.map((p) => (
                      <SelectItem key={p} value={p} className="font-mono">{p}</SelectItem>
                    ))}
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Commodities</div>
                    {COMMODITY_PAIRS.map((p) => (
                      <SelectItem key={p} value={p} className="font-mono">{p}</SelectItem>
                    ))}
                  </>
                ) : (
                  CRYPTO_PAIRS.map((p) => (
                    <SelectItem key={p} value={p} className="font-mono">{p}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Timeframes */}
          <div className="space-y-2">
            <span id="tf-label" className="block text-sm font-medium text-foreground">
              Timeframes <span className="font-normal text-muted-foreground">· up to 3, the lowest drives the replay clock</span>
            </span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="tf-label">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => toggleTimeframe(tf)}
                  aria-pressed={timeframes.includes(tf)}
                  className={`h-8 min-w-11 rounded-md border px-2.5 font-mono text-sm transition-colors duration-150 ${
                    timeframes.includes(tf)
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-line-strong hover:text-foreground'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {/* Date range — fixed window, server-assigned */}
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Data window: today back to{' '}
              <span className="font-mono text-foreground">{rangeFromDate}</span>
            </p>
          </div>

          {/* Account */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="balance">Starting balance ($)</Label>
              <Input id="balance" type="number" min="1" value={balance} onChange={(e) => setBalance(e.target.value)}
                className="border-border font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="leverage">Leverage (1:x)</Label>
              <Input id="leverage" type="number" min="1" value={leverage} onChange={(e) => setLeverage(e.target.value)}
                className="border-border font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spread">Spread ({market === 'crypto' ? '$' : 'pips'})</Label>
              <Input id="spread" type="number" step="any" min="0" value={spreadPips}
                onChange={(e) => setSpreadPips(e.target.value)} className="border-border font-mono" />
            </div>
          </div>

          <Button
            onClick={handleCreate}
            disabled={creating}
            size="lg"
            className="w-full gap-2"
          >
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading price data…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" aria-hidden /> Start session
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* ── Past sessions ── */}
      {pastSessions.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Past sessions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pastSessions.map((s) => (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/backtest/${s.id}/results`)}
                onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/backtest/${s.id}/results`) }}
                className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-muted"
              >
                <div>
                  <span className="font-mono font-medium">{s.pair}</span>
                  <Badge
                    variant="secondary"
                    className={`ml-2 text-xs ${
                      s.status === 'complete' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {s.status}
                  </Badge>
                  <span className="block text-xs text-muted-foreground">
                    {new Date(s.created_at).toLocaleDateString()} · P&amp;L{' '}
                    <span className={`font-mono ${pnlTone(Number(s.balance) - Number(s.starting_balance))}`}>
                      {formatUsd(Number(s.balance) - Number(s.starting_balance), { signed: true })}
                    </span>
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${s.pair} session`}
                  disabled={deletingId === s.id}
                  onClick={(e) => { e.stopPropagation(); handleDelete(s.id) }}
                  className="h-8 w-8 text-muted-foreground hover:bg-loss/10 hover:text-loss"
                >
                  {deletingId === s.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
