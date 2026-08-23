'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Lightbulb, Clock, Loader2, RefreshCw, TrendingUp, Target, AlertTriangle } from 'lucide-react'

interface Insight {
  title: string
  description: string
  type: 'positive' | 'neutral' | 'warning'
}

interface InsightsPanelProps {
  tradeCount: number
}

const INSIGHT_ICONS = {
  positive: TrendingUp,
  neutral: Target,
  warning: AlertTriangle,
}

const INSIGHT_COLORS = {
  positive: { icon: 'text-[#00FF9C]', bg: 'bg-[#00FF9C]/10', border: 'border-[#00FF9C]/20' },
  neutral: { icon: 'text-[#3B82F6]', bg: 'bg-[#3B82F6]/10', border: 'border-[#3B82F6]/20' },
  warning: { icon: 'text-[#F59E0B]', bg: 'bg-[#F59E0B]/10', border: 'border-[#F59E0B]/20' },
}

export function InsightsPanel({ tradeCount }: InsightsPanelProps) {
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [refreshing, setRefreshing] = useState(false)

  async function fetchInsights(refresh = false) {
    if (refresh) setRefreshing(true)
    setLoading(true)
    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const data = await res.json()
      setInsights(data.insights ?? [])
    } catch (err) {
      console.error('[InsightsPanel]', err)
      setError(`Could not load insights${err instanceof Error && err.message ? ` (${err.message})` : ''}`)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (tradeCount < 5) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchInsights()
  }, [tradeCount])

  if (tradeCount < 5) {
    return (
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="h-4 w-4 text-[#F59E0B]" />
            <h3 className="text-sm font-semibold text-white">AI Insights</h3>
          </div>
          <div className="flex flex-col items-center justify-center py-6">
            <Clock className="h-8 w-8 text-zinc-700" />
            <p className="mt-3 text-sm text-zinc-500 text-center">
              Log at least 5 trades to unlock
              <br />
              AI-powered performance insights
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-zinc-800 bg-[#12141A]">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-[#F59E0B]" />
          <h3 className="text-sm font-semibold text-white">AI Insights</h3>
          <button
            onClick={() => void fetchInsights(true)}
            disabled={loading}
            title="Generate fresh analysis"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 bg-[#0A0B0E] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-[#00FF9C] disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Analyzing your trades…</span>
          </div>
        ) : error ? (
          <div className="py-4 text-center">
            <p className="text-sm text-zinc-500">{error}</p>
            <button
              onClick={() => void fetchInsights(true)}
              className="mt-2 text-xs text-[#00FF9C] hover:text-[#00FF9C]/80"
            >
              Try again
            </button>
          </div>
        ) : insights.length === 0 ? (
          <p className="py-4 text-sm text-center text-zinc-500">
            No insights yet — hit refresh to analyze your trades.
          </p>
        ) : (
          <div className="space-y-3">
            {insights.map((insight, i) => {
              const Icon = INSIGHT_ICONS[insight.type] || Target
              const colors = INSIGHT_COLORS[insight.type] || INSIGHT_COLORS.neutral
              return (
                <div
                  key={i}
                  className={`rounded-lg border ${colors.border} bg-[#0A0B0E] p-3 transition-all hover:bg-[#0A0B0E]/80`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`flex h-6 w-6 items-center justify-center rounded-md ${colors.bg}`}>
                      <Icon className={`h-3.5 w-3.5 ${colors.icon}`} />
                    </div>
                    <span className="text-xs font-semibold text-white">
                      {insight.title}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed pl-8">
                    {insight.description}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
