'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CompositeScore } from './CompositeScore'
import { ScoreCard } from './ScoreCard'
import {
  PERSONALITY_KEYS,
  PERSONALITY_META,
  type PersonalityReview,
  type TradeReview,
} from '@/lib/types/review'

interface ReviewPanelProps {
  tradeId: string
  existingReview: Record<string, unknown> | null | undefined
}

type LoadingState = 'idle' | 'loading' | 'done' | 'error'

export function ReviewPanel({ tradeId, existingReview }: ReviewPanelProps) {
  const [review, setReview] = useState<TradeReview | null>(
    existingReview ? mapDbReview(existingReview) : null,
  )
  const [loadingState, setLoadingState] = useState<LoadingState>(
    existingReview ? 'done' : 'idle',
  )
  const [cyclingName, setCyclingName] = useState(0)

  const handleGetReview = useCallback(async () => {
    setLoadingState('loading')

    // Cycle personality names while loading
    const cycleInterval = setInterval(() => {
      setCyclingName((prev) => (prev + 1) % PERSONALITY_KEYS.length)
    }, 2000)

    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Review failed')
      }

      const data = await res.json()
      setReview(mapDbReview(data.review))
      setLoadingState('done')
    } catch (error) {
      console.error('[ReviewPanel]', error)
      toast.error(error instanceof Error ? error.message : 'Failed to get AI review')
      setLoadingState('error')
    } finally {
      clearInterval(cycleInterval)
      setCyclingName(0)
    }
  }, [tradeId])

  // Idle: show "Get AI Review" button with ghost preview
  if (loadingState === 'idle') {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        {/* Ghost preview of personality avatars */}
        <div className="flex gap-3">
          {PERSONALITY_KEYS.map((key) => {
            const meta = PERSONALITY_META[key]
            return (
              <div key={key} className="flex flex-col items-center gap-1 opacity-40">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full text-base grayscale"
                  style={{ backgroundColor: `${meta.color}15`, border: `1px solid ${meta.color}40` }}
                >
                  {meta.icon}
                </div>
                <span className="text-[10px] text-zinc-500">{meta.label.split(' ')[0]}</span>
              </div>
            )
          })}
        </div>
        <p className="text-sm text-zinc-500">No AI review yet.</p>
        <Button
          onClick={handleGetReview}
          className="gap-2 bg-[#1C1E26] text-zinc-300 transition-colors hover:bg-[#2A2D35] hover:text-white"
        >
          <Sparkles className="h-4 w-4" />
          Get AI Review
        </Button>
        <p className="text-xs text-zinc-600">
          5 AI personalities will review this trade
        </p>
      </div>
    )
  }

  // Loading: show spinner with cycling name
  if (loadingState === 'loading') {
    const currentKey = PERSONALITY_KEYS[cyclingName]
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <Loader2 className="h-8 w-8 animate-spin text-[#00FF9C]" />
        <div className="text-center">
          <p className="text-sm text-zinc-400">Analyzing trade...</p>
          <p className="mt-1 text-xs text-zinc-600">
            {PERSONALITY_META[currentKey].icon} {PERSONALITY_META[currentKey].label} is reviewing
          </p>
        </div>
      </div>
    )
  }

  // Error: show retry button
  if (loadingState === 'error') {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <p className="text-sm text-[#FF4D4D]">Review failed. Please try again.</p>
        <Button
          onClick={handleGetReview}
          className="gap-2 bg-[#1C1E26] text-zinc-300 transition-colors hover:bg-[#2A2D35] hover:text-white"
        >
          <Sparkles className="h-4 w-4" />
          Retry AI Review
        </Button>
      </div>
    )
  }

  // Done: show results
  if (!review) return null

  const personalityScores = PERSONALITY_KEYS.map((key) => ({
    key,
    overall: review[key]?.overall ?? null,
  }))

  return (
    <div className="space-y-6">
      <CompositeScore score={review.composite_score} personalityScores={personalityScores} />

      <div className="border-t border-zinc-800" />

      {/* All 5 personalities side by side */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {PERSONALITY_KEYS.map((key) => {
          const r = review[key]
          return r ? (
            <ScoreCard key={key} personalityKey={key} review={r} compact />
          ) : (
            <div key={key} className="rounded-lg border border-zinc-800 bg-[#0A0B0E] p-3 text-center text-xs text-zinc-600">
              <span className="text-base">{PERSONALITY_META[key].icon}</span>
              <p className="mt-1">{PERSONALITY_META[key].label}</p>
              <p className="text-zinc-700">Failed to respond</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Map a raw DB row (snake_case jsonb columns) to a typed TradeReview */
function mapDbReview(row: Record<string, unknown>): TradeReview {
  const r = row as Record<string, unknown>
  return {
    trade_id: r.trade_id as string,
    prop_firm_evaluator: r.prop_firm_evaluator as PersonalityReview | null,
    trading_psychologist: r.trading_psychologist as PersonalityReview | null,
    institutional_trader: r.institutional_trader as PersonalityReview | null,
    quantitative_analyst: r.quantitative_analyst as PersonalityReview | null,
    risk_manager: r.risk_manager as PersonalityReview | null,
    composite_score: r.composite_score as number | null,
  }
}
