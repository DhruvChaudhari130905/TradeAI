'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Lightbulb, Clock, Loader2, TrendingUp, Target, AlertTriangle } from 'lucide-react'

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

  useEffect(() => {
    if (tradeCount < 5) return

    async function fetchInsights() {
      setLoading(true)
      try {
        const res = await fetch('/api/insights', { method: 'POST' })
        if (!res.ok) throw new Error('Failed to fetch insights')
        const data = await res.json()
        setInsights(data.insights ?? [])
      } catch (err) {
        console.error('[InsightsPanel]', err)
        setError('Could not load insights')
      } finally {
        setLoading(false)
      }
    }
    fetchInsights()
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
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-4 w-4 text-[#F59E0B]" />
          <h3 className="text-sm font-semibold text-white">AI Insights</h3>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Analyzing your trades…</span>
          </div>
        ) : error ? (
          <p className="py-4 text-sm text-zinc-500 text-center">{error}</p>
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
