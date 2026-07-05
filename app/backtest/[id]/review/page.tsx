'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Loader2, AlertTriangle, Play, ArrowLeft, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { RuleBuilder } from '@/components/backtest/rule-builder'
import type { StrategyRuleSet, ExecutionConfig, BacktestRun } from '@/lib/types/backtest'

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

export default function BacktestReviewPage() {
  const params = useParams()
  const router = useRouter()
  const backtestId = params.id as string

  const [run, setRun] = useState<BacktestRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [rules, setRules] = useState<StrategyRuleSet | null>(null)
  const [executionConfig, setExecutionConfig] = useState<ExecutionConfig>(DEFAULT_EXECUTION_CONFIG)
  const [submitting, setSubmitting] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null

    async function fetchRun() {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('backtest_runs')
        .select('*')
        .eq('id', backtestId)
        .single()

      if (error || !data) {
        toast.error('Backtest not found')
        setLoading(false)
        return
      }

      setRun(data as BacktestRun)

      if (data.status === 'extracted' && data.extracted_rules) {
        setRules(data.extracted_rules as StrategyRuleSet)
      } else if (data.status === 'approved' || data.status === 'running' || data.status === 'complete') {
        setRules((data.approved_rules ?? data.extracted_rules) as StrategyRuleSet)
      }

      setLoading(false)

      // If still extracting, poll. Network failures reject with
      // `TypeError: Failed to fetch` (blocker / VPN / HMR / backgrounded tab).
      // Without handling, the interval fires forever into a dead endpoint,
      // flooding the console and trapping the user. Cap consecutive failures
      // and surface a real error instead.
      if (data.status === 'extracting') {
        let consecutiveFailures = 0
        const MAX_FAILURES = 5
        const fail = () => {
          if (++consecutiveFailures >= MAX_FAILURES) {
            if (pollInterval) clearInterval(pollInterval)
            toast.error('Lost connection while extracting rules. Refresh to retry.')
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
            if (updated.status === 'extracted' && updated.extracted_rules) {
              setRules(updated.extracted_rules as StrategyRuleSet)
              if (pollInterval) clearInterval(pollInterval)
            }
            if (updated.status === 'error' || updated.status === 'complete' || updated.status === 'running') {
              if (pollInterval) clearInterval(pollInterval)
            }
          } catch {
            fail()
          }
        }, 3000)
      }
    }

    fetchRun()

    return () => {
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [backtestId])

  const handleSaveRules = async () => {
    if (!rules) return
    setSaving(true)

    try {
      const response = await fetch(`/api/backtest/${backtestId}/rules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extracted_rules: rules }),
      })

      const data = await response.json()
      if (response.ok) {
        toast.success('Rules saved')
      } else {
        toast.error(data.error || 'Failed to save rules')
      }
    } catch {
      toast.error('Failed to save rules')
    } finally {
      setSaving(false)
    }
  }

  const handleApproveAndRun = async () => {
    if (!rules) return
    setSubmitting(true)

    try {
      // Save rules first
      await fetch(`/api/backtest/${backtestId}/rules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extracted_rules: rules }),
      })

      // Start execution
      const response = await fetch(`/api/backtest/${backtestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedRules: rules,
          executionConfig,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        router.push(`/backtest/${backtestId}`)
      } else {
        toast.error(data.error || 'Failed to start backtest')
      }
    } catch {
      toast.error('Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center gap-3 text-zinc-400">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span>Loading strategy rules…</span>
      </div>
    )
  }

  if (!run) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <AlertTriangle className="h-10 w-10 text-[#FF4D4D]" />
        <p className="text-sm text-zinc-400">Backtest not found</p>
        <Link href="/backtest">
          <Button variant="outline" className="border-zinc-800 text-zinc-400">← Back to Backtest</Button>
        </Link>
      </div>
    )
  }

  // Extraction in progress
  if (run.status === 'extracting') {
    return (
      <div className="space-y-6">
        <Link href="/backtest" className="text-sm text-zinc-500 hover:text-white transition-colors">← Backtest</Link>
        <div className="flex h-72 flex-col items-center justify-center gap-4">
          <div className="relative">
            <Loader2 className="h-12 w-12 animate-spin text-[#00FF9C]" />
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-white">Extracting Strategy Rules…</p>
            <p className="mt-1 text-sm text-zinc-400">
              AI is parsing your strategy document into structured rules. This usually takes 10–20 seconds.
            </p>
          </div>
          <p className="font-mono text-xs text-zinc-600">{run.strategy_name}</p>
        </div>
      </div>
    )
  }

  // Error
  if (run.status === 'error') {
    return (
      <div className="space-y-6">
        <Link href="/backtest" className="text-sm text-zinc-500 hover:text-white transition-colors">← Backtest</Link>
        <Card className="border-[#FF4D4D]/30 bg-[#12141A]">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <AlertTriangle className="h-10 w-10 text-[#FF4D4D]" />
            <p className="text-lg font-semibold text-white">Rule Extraction Failed</p>
            <p className="max-w-lg text-center text-sm text-zinc-400">
              {run.ai_report || 'An error occurred during extraction. Please try again.'}
            </p>
            <Link href="/backtest">
              <Button variant="outline" className="border-zinc-800 text-zinc-400">Try Again</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Already running or complete — redirect to results
  if (run.status === 'running' || run.status === 'complete') {
    router.push(`/backtest/${backtestId}`)
    return null
  }

  // Main review UI (status = 'extracted' or 'approved')
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/backtest" className="text-sm text-zinc-500 hover:text-white transition-colors">← Backtest</Link>
          <span className="text-zinc-700">|</span>
          <h1 className="text-2xl font-bold tracking-tight text-white">Review Strategy Rules</h1>
          <Badge variant="outline" className="border-zinc-700 text-zinc-400">{run.pair}</Badge>
          <Badge variant="outline" className="font-mono text-zinc-500">{run.timeframe}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="gap-2 border-zinc-800 text-zinc-400 hover:text-white"
            onClick={handleSaveRules}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
          <Button
            className="gap-2 bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90"
            onClick={handleApproveAndRun}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Approve & Run Backtest
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Rule builder (2 cols) */}
        <div className="col-span-2">
          {rules && <RuleBuilder rules={rules} onChange={setRules} />}
        </div>

        {/* Right: Execution config + context */}
        <div className="space-y-6">
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

          <Card className="border-zinc-800 bg-[#12141A]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-zinc-400">Backtest Context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">Pair</span>
                <span className="font-mono text-white">{run.pair}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Market</span>
                <span className="text-white">{run.market === 'forex' ? 'Forex' : 'Crypto'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Date range</span>
                <span className="font-mono text-white">{run.date_from} → {run.date_to}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Starting capital</span>
                <span className="font-mono text-white">${run.starting_capital.toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
