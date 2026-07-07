'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { FlaskConical, Upload, Loader2, History, PenLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FOREX_PAIRS, CRYPTO_PAIRS } from '@/lib/types/trade'
import { BACKTEST_TIMEFRAMES } from '@/lib/types/backtest'
import type { StrategyRuleSet, ExecutionConfig, BacktestTimeframe } from '@/lib/types/backtest'
import { RuleBuilder } from '@/components/backtest/rule-builder'

type Mode = 'upload' | 'manual'

const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  spread_pips: 1.0,
  slippage_pips: 0.5,
  commission_per_lot: 7.0,
  swap_long_per_day: 0,
  swap_short_per_day: 0,
  leverage: 100,
}

const EMPTY_RULES: StrategyRuleSet = {
  name: 'Untitled Strategy',
  indicators: [],
  entry_long: [],
  entry_short: [],
  exit_long: [],
  exit_short: [],
  stop_loss: { method: 'atr_based', atr_multiplier: 1.5 },
  take_profit: { method: 'risk_reward', rr_ratio: 2 },
  risk_per_trade_pct: 1,
  position_sizing: { method: 'risk_based' },
  session_filter: null,
  invalidation: [],
  trade_management: [],
  order_type: 'market',
  timeframe: '1D',
  notes: '',
}

export default function BacktestPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('upload')

  // Shared state
  const [strategyName, setStrategyName] = useState('')
  const [market, setMarket] = useState<'forex' | 'crypto'>('forex')
  const [pair, setPair] = useState('')
  const [timeframe, setTimeframe] = useState('1D')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [startingCapital, setStartingCapital] = useState('10000')
  const [uploading, setUploading] = useState(false)

  // Upload mode state
  const [docFile, setDocFile] = useState<File | null>(null)

  // Manual mode state
  const [rules, setRules] = useState<StrategyRuleSet>(EMPTY_RULES)
  const [executionConfig, setExecutionConfig] = useState<ExecutionConfig>(DEFAULT_EXECUTION_CONFIG)

  const pairs = useMemo(() => {
    return market === 'forex' ? FOREX_PAIRS : CRYPTO_PAIRS
  }, [market])

  // Default date range: last 365 days
  const getDefaultDates = () => {
    const to = new Date()
    const from = new Date()
    from.setFullYear(from.getFullYear() - 1)
    return {
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0],
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.txt') && !file.name.endsWith('.pdf')) {
      toast.error('Only .txt and .pdf files are accepted')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File must be under 5MB')
      return
    }

    setDocFile(file)
  }

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!docFile) {
      toast.error('Please upload a strategy document')
      return
    }
    if (!pair) {
      toast.error('Please select a pair')
      return
    }

    setUploading(true)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        toast.error('Not authenticated')
        setUploading(false)
        return
      }

      const ext = docFile.name.split('.').pop() ?? 'txt'
      const storagePath = `${user.id}/${Date.now()}-${docFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error: uploadError } = await supabase.storage
        .from('strategy-docs')
        .upload(storagePath, docFile)

      if (uploadError) {
        console.error('[backtest] doc upload failed:', uploadError)
        toast.error('Failed to upload strategy document')
        setUploading(false)
        return
      }

      const response = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          strategyDocUrl: storagePath,
          strategyName: strategyName || docFile.name.replace(/\.[^/.]+$/, ''),
          market,
          pair,
          timeframe,
          dateFrom: dateFrom || getDefaultDates().from,
          dateTo: dateTo || getDefaultDates().to,
          startingCapital: Number(startingCapital) || 10000,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        toast.error(data.error || 'Failed to start backtest')
        setUploading(false)
        return
      }

      router.push(`/backtest/${data.backtestId}/review`)
    } catch (error) {
      console.error('[backtest] submit error:', error)
      toast.error('Something went wrong. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!pair) {
      toast.error('Please select a pair')
      return
    }

    setUploading(true)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        toast.error('Not authenticated')
        setUploading(false)
        return
      }

      // Create backtest run with manual rules
      const createResponse = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          mode: 'manual',
          strategyName: strategyName || rules.name || 'Manual Strategy',
          market,
          pair,
          timeframe,
          dateFrom: dateFrom || getDefaultDates().from,
          dateTo: dateTo || getDefaultDates().to,
          startingCapital: Number(startingCapital) || 10000,
          approvedRules: rules,
          executionConfig,
        }),
      })

      const createData = await createResponse.json()

      if (!createResponse.ok) {
        toast.error(createData.error || 'Failed to create backtest')
        setUploading(false)
        return
      }

      const backtestId = createData.backtestId

      // Start execution directly
      const execResponse = await fetch(`/api/backtest/${backtestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedRules: rules,
          executionConfig,
        }),
      })

      if (!execResponse.ok) {
        const execData = await execResponse.json()
        toast.error(execData.error || 'Failed to start backtest execution')
        setUploading(false)
        return
      }

      router.push(`/backtest/${backtestId}`)
    } catch (error) {
      console.error('[backtest] manual submit error:', error)
      toast.error('Something went wrong. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            AI Backtest
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {mode === 'upload'
              ? 'Upload a strategy document and simulate it on historical data.'
              : 'Define strategy rules manually and run a backtest.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Mode toggle */}
          <div className="flex rounded-lg border border-zinc-800 bg-[#12141A] p-0.5">
            <button
              onClick={() => setMode('upload')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'upload' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Doc
            </button>
            <button
              onClick={() => setMode('manual')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'manual' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <PenLine className="h-3.5 w-3.5" />
              Manual
            </button>
          </div>
          <Link href="/backtest/history">
            <Button variant="outline" className="gap-2 border-zinc-800 text-zinc-400 hover:text-white">
              <History className="h-4 w-4" />
              Past Runs
            </Button>
          </Link>
        </div>
      </div>

      {mode === 'upload' ? (
        /* ── Upload mode ────────────────────────────────────────────────── */
        <form onSubmit={handleUploadSubmit}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Left column — Strategy Upload */}
            <div className="space-y-6 lg:col-span-2">
              <Card className="border-zinc-800 bg-[#12141A]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-zinc-400">Strategy Document</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-xs text-zinc-500">Strategy Name</Label>
                    <Input
                      value={strategyName}
                      onChange={(e) => setStrategyName(e.target.value)}
                      placeholder="e.g. EMA Crossover on EUR/USD"
                      className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white placeholder:text-zinc-600"
                    />
                  </div>

                  <div>
                    <Label className="text-xs text-zinc-500">Upload Document (.txt or .pdf, max 5MB)</Label>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-[#0A0B0E] px-4 py-3 text-sm text-zinc-400 transition-colors hover:border-[#00FF9C]/30 hover:text-white">
                        <Upload className="h-4 w-4" />
                        {docFile ? docFile.name : 'Choose file'}
                        <input
                          type="file"
                          accept=".txt,.pdf"
                          onChange={handleFileChange}
                          className="hidden"
                        />
                      </label>
                      {docFile && (
                        <span className="text-xs text-[#00FF9C]">
                          ✓ {(docFile.size / 1024).toFixed(0)} KB
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-zinc-800 bg-[#0A0B0E] p-4">
                    <p className="text-xs text-zinc-500 leading-relaxed">
                      <span className="font-semibold text-zinc-400">Tips for best results:</span> Include clear entry and exit conditions, stop loss and take profit rules, and the timeframe your strategy is designed for. The AI will extract actionable rules from your document and apply them bar-by-bar to historical data.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right column — Parameters */}
            <div className="space-y-6">
              <ParametersPanel
                market={market} setMarket={setMarket}
                pair={pair} setPair={setPair}
                pairs={pairs}
                timeframe={timeframe} setTimeframe={setTimeframe}
                dateFrom={dateFrom} setDateFrom={setDateFrom}
                dateTo={dateTo} setDateTo={setDateTo}
                startingCapital={startingCapital} setStartingCapital={setStartingCapital}
                getDefaultDates={getDefaultDates}
              />
              <Button
                type="submit"
                disabled={uploading}
                className="mt-2 w-full gap-2 bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting Backtest…
                  </>
                ) : (
                  <>
                    <FlaskConical className="h-4 w-4" />
                    Run Backtest
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        /* ── Manual mode ────────────────────────────────────────────────── */
        <form onSubmit={handleManualSubmit}>
          <div className="space-y-6">
            {/* Parameters row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label className="text-xs text-zinc-500">Strategy Name</Label>
                <Input
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                  placeholder="e.g. EMA Crossover"
                  className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white placeholder:text-zinc-600"
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-500">Market</Label>
                <Select value={market} onValueChange={(v) => { setMarket((v ?? 'forex') as 'forex' | 'crypto'); setPair('') }}>
                  <SelectTrigger className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-[#12141A]">
                    <SelectItem value="forex" className="text-white">Forex</SelectItem>
                    <SelectItem value="crypto" className="text-white">Crypto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-zinc-500">Pair</Label>
                <Select value={pair} onValueChange={(v) => setPair(v ?? '')}>
                  <SelectTrigger className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm font-mono text-white">
                    <SelectValue placeholder="Select pair" />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-[#12141A]">
                    {pairs.map((p) => (
                      <SelectItem key={p} value={p} className="font-mono text-white">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-zinc-500">Timeframe</Label>
                <Select value={timeframe} onValueChange={(v) => setTimeframe(v ?? '1D')}>
                  <SelectTrigger className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-[#12141A]">
                    {BACKTEST_TIMEFRAMES.map((tf) => (
                      <SelectItem key={tf} value={tf} className="font-mono text-white">
                        {tf}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label className="text-xs text-zinc-500">From</Label>
                <Input
                  type="date"
                  value={dateFrom || getDefaultDates().from}
                  onChange={(e) => setDateFrom(e.target.value)}
                  max={dateTo || undefined}
                  className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white"
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-500">To</Label>
                <Input
                  type="date"
                  value={dateTo || getDefaultDates().to}
                  onChange={(e) => setDateTo(e.target.value)}
                  min={dateFrom || undefined}
                  className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white"
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-500">Starting Capital ($)</Label>
                <Input
                  type="number"
                  value={startingCapital}
                  onChange={(e) => setStartingCapital(e.target.value)}
                  min={100}
                  step={100}
                  className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] font-mono text-sm text-white"
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="submit"
                  disabled={uploading}
                  className="w-full gap-2 bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Running…
                    </>
                  ) : (
                    <>
                      <FlaskConical className="h-4 w-4" />
                      Run Backtest
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Rules + Execution Config */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <RuleBuilder rules={rules} onChange={setRules} />
              </div>
              <div>
                <Card className="border-zinc-800 bg-[#12141A]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-zinc-400">Execution Config</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-zinc-500">Spread (pips)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={executionConfig.spread_pips}
                          onChange={(e) => setExecutionConfig({ ...executionConfig, spread_pips: Number(e.target.value) })}
                          className="mt-1 h-8 border-zinc-800 bg-[#0A0B0E] text-xs font-mono text-white"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-zinc-500">Slippage (pips)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={executionConfig.slippage_pips}
                          onChange={(e) => setExecutionConfig({ ...executionConfig, slippage_pips: Number(e.target.value) })}
                          className="mt-1 h-8 border-zinc-800 bg-[#0A0B0E] text-xs font-mono text-white"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-zinc-500">Commission ($/lot)</Label>
                        <Input
                          type="number"
                          step="0.5"
                          value={executionConfig.commission_per_lot}
                          onChange={(e) => setExecutionConfig({ ...executionConfig, commission_per_lot: Number(e.target.value) })}
                          className="mt-1 h-8 border-zinc-800 bg-[#0A0B0E] text-xs font-mono text-white"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-zinc-500">Leverage</Label>
                        <Input
                          type="number"
                          step="10"
                          value={executionConfig.leverage}
                          onChange={(e) => setExecutionConfig({ ...executionConfig, leverage: Number(e.target.value) })}
                          className="mt-1 h-8 border-zinc-800 bg-[#0A0B0E] text-xs font-mono text-white"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-zinc-500">Swap Long $/day</Label>
                        <Input
                          type="number"
                          step="0.5"
                          value={executionConfig.swap_long_per_day}
                          onChange={(e) => setExecutionConfig({ ...executionConfig, swap_long_per_day: Number(e.target.value) })}
                          className="mt-1 h-8 border-zinc-800 bg-[#0A0B0E] text-xs font-mono text-white"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-zinc-500">Swap Short $/day</Label>
                        <Input
                          type="number"
                          step="0.5"
                          value={executionConfig.swap_short_per_day}
                          onChange={(e) => setExecutionConfig({ ...executionConfig, swap_short_per_day: Number(e.target.value) })}
                          className="mt-1 h-8 border-zinc-800 bg-[#0A0B0E] text-xs font-mono text-white"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

// ── Shared parameters panel (upload mode right column) ──────────────────────

function ParametersPanel({
  market, setMarket, pair, setPair, pairs,
  timeframe, setTimeframe,
  dateFrom, setDateFrom, dateTo, setDateTo,
  startingCapital, setStartingCapital,
  getDefaultDates,
}: {
  market: 'forex' | 'crypto'
  setMarket: (m: 'forex' | 'crypto') => void
  pair: string
  setPair: (p: string) => void
  pairs: string[]
  timeframe: string
  setTimeframe: (t: string) => void
  dateFrom: string
  setDateFrom: (d: string) => void
  dateTo: string
  setDateTo: (d: string) => void
  startingCapital: string
  setStartingCapital: (c: string) => void
  getDefaultDates: () => { from: string; to: string }
}) {
  return (
    <Card className="border-zinc-800 bg-[#12141A]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-zinc-400">Backtest Parameters</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs text-zinc-500">Market</Label>
          <Select value={market} onValueChange={(v) => { setMarket((v ?? 'forex') as 'forex' | 'crypto'); setPair('') }}>
            <SelectTrigger className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-[#12141A]">
              <SelectItem value="forex" className="text-white">Forex</SelectItem>
              <SelectItem value="crypto" className="text-white">Crypto</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-zinc-500">Pair</Label>
          <Select value={pair} onValueChange={(v) => setPair(v ?? '')}>
            <SelectTrigger className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm font-mono text-white">
              <SelectValue placeholder="Select pair" />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-[#12141A]">
              {pairs.map((p) => (
                <SelectItem key={p} value={p} className="font-mono text-white">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-zinc-500">Timeframe</Label>
          <Select value={timeframe} onValueChange={(v) => setTimeframe(v ?? '1D')}>
            <SelectTrigger className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-[#12141A]">
              {BACKTEST_TIMEFRAMES.map((tf) => (
                <SelectItem key={tf} value={tf} className="font-mono text-white">
                  {tf}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-zinc-500">From</Label>
            <Input
              type="date"
              value={dateFrom || getDefaultDates().from}
              onChange={(e) => setDateFrom(e.target.value)}
              max={dateTo || undefined}
              className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white"
            />
          </div>
          <div>
            <Label className="text-xs text-zinc-500">To</Label>
            <Input
              type="date"
              value={dateTo || getDefaultDates().to}
              onChange={(e) => setDateTo(e.target.value)}
              min={dateFrom || undefined}
              className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs text-zinc-500">Starting Capital ($)</Label>
          <Input
            type="number"
            value={startingCapital}
            onChange={(e) => setStartingCapital(e.target.value)}
            min={100}
            step={100}
            className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] font-mono text-sm text-white"
          />
        </div>
      </CardContent>
    </Card>
  )
}
