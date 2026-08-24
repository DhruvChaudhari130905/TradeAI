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
import { Play, Plus, Loader2 } from 'lucide-react'
import {
  createReplaySession,
  listReplaySessions,
} from '@/lib/actions/replay'
import { FOREX_PAIRS, CRYPTO_PAIRS } from '@/lib/types/trade'
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
        <h1 className="text-2xl font-bold">Replay Trading</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Trade historical markets bar-by-bar like live price action. Practice setups, get AI feedback, log every trade.
        </p>
      </div>

      {/* ── Active sessions (resume) ── */}
      {activeSessions.length > 0 && (
        <Card className="border-[#27272A] bg-[#12141A]">
          <CardHeader>
            <CardTitle className="text-base">Resume Session</CardTitle>
            <CardDescription>Pick up exactly where you left off.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeSessions.map((s) => (
              <button
                key={s.id}
                onClick={() => router.push(`/backtest/${s.id}/session`)}
                className="flex w-full items-center justify-between rounded-lg border border-[#27272A] px-4 py-3 text-left transition-colors hover:border-[#00FF9C]/50 hover:bg-[#1C1E26]"
              >
                <div>
                  <span className="font-mono font-medium">{s.pair}</span>
                  <span className="ml-2 flex gap-1 sm:inline-flex sm:ml-0">
                    {(s.timeframes as Timeframe[]).map((tf) => (
                      <Badge key={tf} variant="secondary" className="font-mono text-xs">{tf}</Badge>
                    ))}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    Balance ${Number(s.balance).toLocaleString()} · started {new Date(s.created_at).toLocaleDateString()}
                  </span>
                </div>
                <Play className="h-4 w-4 text-[#00FF9C]" />
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── New session ── */}
      <Card className="border-[#27272A] bg-[#12141A]">
        <CardHeader>
          <CardTitle className="text-base">New Replay Session</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Market */}
          <div className="space-y-2">
            <Label>Market</Label>
            <div className="flex gap-2">
              {(['forex', 'crypto'] as const).map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={market === m ? 'default' : 'outline'}
                  onClick={() => handleMarketChange(m)}
                  className={market === m ? 'bg-[#00FF9C] text-[#0A0B0E]' : 'border-[#27272A]'}
                >
                  {m === 'forex' ? 'Forex' : 'Crypto'}
                </Button>
              ))}
            </div>
          </div>

          {/* Pair */}
          <div className="space-y-2">
            <Label>Pair</Label>
            <Select value={pair} onValueChange={handlePairChange}>
              <SelectTrigger className="w-full border-[#27272A]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64 border-[#27272A] bg-[#12141A]">
                {(market === 'forex' ? FOREX_PAIRS : CRYPTO_PAIRS).map((p) => (
                  <SelectItem key={p} value={p} className="font-mono">{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Timeframes */}
          <div className="space-y-2">
            <Label>
              Timeframes <span className="text-zinc-500">(up to 3 — lowest is the replay clock)</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => toggleTimeframe(tf)}
                  className={`rounded-md border px-3 py-1.5 font-mono text-sm transition-colors ${
                    timeframes.includes(tf)
                      ? 'border-[#00FF9C] bg-[#00FF9C]/10 text-[#00FF9C]'
                      : 'border-[#27272A] text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {/* Date range — fixed window, server-assigned */}
          <div className="rounded-md border border-[#27272A] bg-[#0A0B0E] px-3 py-2">
            <p className="text-xs text-zinc-400">
              Date range: fixed window · today back to{' '}
              <span className="font-mono text-zinc-200">{rangeFromDate}</span>
            </p>
          </div>

          {/* Account */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="balance">Starting balance ($)</Label>
              <Input id="balance" type="number" min="1" value={balance} onChange={(e) => setBalance(e.target.value)}
                className="border-[#27272A] font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="leverage">Leverage (1:x)</Label>
              <Input id="leverage" type="number" min="1" value={leverage} onChange={(e) => setLeverage(e.target.value)}
                className="border-[#27272A] font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spread">Spread ({market === 'crypto' ? '$' : 'pips'})</Label>
              <Input id="spread" type="number" step="any" min="0" value={spreadPips}
                onChange={(e) => setSpreadPips(e.target.value)} className="border-[#27272A] font-mono" />
            </div>
          </div>

          <Button
            onClick={handleCreate}
            disabled={creating}
            className="w-full bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90"
          >
            {creating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Fetching data…
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" /> Start Session
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* ── Past sessions ── */}
      {pastSessions.length > 0 && (
        <Card className="border-[#27272A] bg-[#12141A]">
          <CardHeader>
            <CardTitle className="text-base">Past Sessions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pastSessions.map((s) => (
              <button
                key={s.id}
                onClick={() => router.push(`/backtest/${s.id}/results`)}
                className="flex w-full items-center justify-between rounded-lg border border-[#27272A] px-4 py-3 text-left transition-colors hover:border-zinc-600 hover:bg-[#1C1E26]"
              >
                <div>
                  <span className="font-mono font-medium">{s.pair}</span>
                  <Badge
                    variant="secondary"
                    className={`ml-2 text-xs ${
                      s.status === 'complete' ? 'bg-[#00FF9C]/10 text-[#00FF9C]' : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {s.status}
                  </Badge>
                  <span className="block text-xs text-zinc-500">
                    {new Date(s.created_at).toLocaleDateString()} · P&L{' '}
                    <span className={`font-mono ${(Number(s.balance) - Number(s.starting_balance)) >= 0 ? 'text-[#00FF9C]' : 'text-[#FF4D4D]'}`}>
                      {(Number(s.balance) - Number(s.starting_balance)) >= 0 ? '+' : ''}
                      {Math.round(Number(s.balance) - Number(s.starting_balance)).toLocaleString()}
                    </span>
                  </span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
