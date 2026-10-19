'use client'

import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { Sparkles, Loader2, RefreshCw, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  PERSONALITY_KEYS,
  PERSONALITY_META,
  DIMENSION_LABELS,
  type PersonalityKey,
  type PersonalityReview,
  type TradeReview,
} from '@/lib/types/review'
import { PersonalityIcon } from './PersonalityIcon'

interface ReviewPanelProps {
  tradeId: string
  existingReview: Record<string, unknown> | null | undefined
}

const DIMENSION_KEYS = Object.keys(DIMENSION_LABELS) as (keyof typeof DIMENSION_LABELS)[]

/** Short column headers for the score matrix */
const DIMENSION_SHORT: Record<(typeof DIMENSION_KEYS)[number], string> = {
  entry_quality: 'Entry',
  risk_management: 'Risk',
  trade_psychology: 'Psych',
  execution: 'Exec',
  strategy_adherence: 'Plan',
}

/** Scores are not P&L — keep green/red out of them; flag only the weak ones */
function scoreTone(v: number | null | undefined) {
  if (v == null) return 'text-muted-foreground'
  return v < 5 ? 'text-warn' : 'text-foreground'
}

export function ReviewPanel({ tradeId, existingReview }: ReviewPanelProps) {
  const [review, setReview] = useState<TradeReview | null>(existingReview ? mapDbReview(existingReview) : null)
  const [reviewedAt, setReviewedAt] = useState<string | null>((existingReview?.created_at as string) ?? null)
  const [running, setRunning] = useState(false)
  const [failed, setFailed] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [selected, setSelected] = useState<PersonalityKey>(PERSONALITY_KEYS[0])

  useEffect(() => {
    if (!running) return
    const started = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(id)
  }, [running])

  const runReview = useCallback(async (regenerate: boolean) => {
    setRunning(true)
    setFailed(false)
    setElapsed(0)
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, regenerate }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Review failed')
      setReview(mapDbReview(data.review))
      setReviewedAt(data.review?.created_at ?? new Date().toISOString())
      if (regenerate) toast.success('Review updated')
    } catch (error) {
      console.error('[ReviewPanel]', error)
      toast.error(error instanceof Error ? error.message : 'Failed to get AI review')
      setFailed(true)
    } finally {
      setRunning(false)
    }
  }, [tradeId])

  const answered = review ? PERSONALITY_KEYS.filter((k) => review[k]).length : 0

  return (
    <section className="rounded-lg border border-border bg-card" aria-labelledby="ai-review-heading">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-baseline gap-3">
          <h2 id="ai-review-heading" className="text-sm font-semibold text-foreground">AI review</h2>
          {review && reviewedAt && (
            <span className="text-xs text-muted-foreground">
              {new Date(reviewedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              {answered < PERSONALITY_KEYS.length && ` · ${answered} of ${PERSONALITY_KEYS.length} reviewers answered`}
            </span>
          )}
        </div>
        {review && (
          <Button variant="outline" size="sm" onClick={() => runReview(true)} disabled={running} className="gap-1.5">
            <RefreshCw className={cn('h-3.5 w-3.5', running && 'animate-spin')} aria-hidden />
            {running ? 'Re-running…' : 'Re-run review'}
          </Button>
        )}
      </div>

      {/* Progress line while a review runs — the previous review stays readable underneath */}
      {running && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground sm:px-5" role="status" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
          Five reviewers are scoring this trade — usually 1–2 minutes.
          <span className="ml-auto font-mono">{elapsed}s</span>
        </div>
      )}

      {!review ? (
        <EmptyReview running={running} failed={failed} onRun={() => runReview(false)} />
      ) : (
        <ReviewBody review={review} selected={selected} onSelect={setSelected} />
      )}
    </section>
  )
}

function EmptyReview({ running, failed, onRun }: { running: boolean; failed: boolean; onRun: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="flex gap-2" aria-hidden>
        {PERSONALITY_KEYS.map((key) => (
          <span key={key} className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
            <PersonalityIcon personality={key} className="h-4 w-4" />
          </span>
        ))}
      </div>
      {failed ? (
        <p className="mt-4 flex items-center gap-1.5 text-sm text-warn">
          <AlertTriangle className="h-4 w-4" aria-hidden /> The review didn’t complete.
        </p>
      ) : (
        <p className="mt-4 max-w-sm text-sm text-muted-foreground">
          A prop-firm evaluator, psychologist, institutional trader, quant and risk manager each score this trade on five dimensions.
        </p>
      )}
      <Button onClick={onRun} disabled={running} className="mt-4 gap-2">
        {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
        {running ? 'Reviewing…' : failed ? 'Try again' : 'Get AI review'}
      </Button>
    </div>
  )
}

function ReviewBody({
  review,
  selected,
  onSelect,
}: {
  review: TradeReview
  selected: PersonalityKey
  onSelect: (k: PersonalityKey) => void
}) {
  const detail = review[selected]

  return (
    <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* Score matrix */}
      <div className="border-b border-border lg:border-b-0 lg:border-r">
        <div className="flex items-baseline gap-2 px-4 pt-4 sm:px-5">
          <span className="font-mono text-3xl font-semibold text-foreground">
            {review.composite_score != null ? Number(review.composite_score).toFixed(1) : '—'}
          </span>
          <span className="text-sm text-muted-foreground">/10 composite</span>
        </div>

        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">Scores by reviewer and dimension, out of 10</caption>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pl-4 pr-2 font-medium sm:pl-5">Reviewer</th>
              {DIMENSION_KEYS.map((k) => (
                <th key={k} scope="col" title={DIMENSION_LABELS[k]} className="hidden px-1.5 py-2 text-right font-medium sm:table-cell">
                  {DIMENSION_SHORT[k]}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-right font-medium">Overall</th>
              <th scope="col" className="py-2 pl-2 pr-4 text-right font-medium sm:pr-5">Grade</th>
            </tr>
          </thead>
          <tbody>
            {PERSONALITY_KEYS.map((key) => {
              const r = review[key]
              const isSel = key === selected
              return (
                <tr
                  key={key}
                  onClick={() => onSelect(key)}
                  className={cn(
                    'cursor-pointer border-t border-border transition-colors duration-150',
                    isSel ? 'bg-muted' : 'hover:bg-muted/50',
                  )}
                >
                  <th scope="row" className="py-2.5 pl-4 pr-2 text-left font-normal sm:pl-5">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSelect(key) }}
                      aria-pressed={isSel}
                      className="flex items-center gap-2 rounded text-left"
                    >
                      <PersonalityIcon personality={key} className={cn('h-4 w-4 shrink-0', isSel ? 'text-primary' : 'text-muted-foreground')} />
                      <span className={cn('text-sm', isSel ? 'text-foreground' : 'text-muted-foreground')}>
                        {PERSONALITY_META[key].label}
                      </span>
                    </button>
                  </th>
                  {DIMENSION_KEYS.map((k) => (
                    <td key={k} className={cn('hidden px-1.5 py-2.5 text-right font-mono sm:table-cell', scoreTone(r?.[k]))}>
                      {r ? r[k] : '—'}
                    </td>
                  ))}
                  <td className={cn('px-2 py-2.5 text-right font-mono font-semibold', scoreTone(r?.overall))}>
                    {r ? Number(r.overall).toFixed(1) : '—'}
                  </td>
                  <td className="py-2.5 pl-2 pr-4 text-right font-mono font-semibold text-foreground sm:pr-5">
                    {r ? r.grade : <span className="text-xs font-normal text-muted-foreground">no reply</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-muted-foreground sm:px-5">
          Scores under 5 are highlighted. Select a reviewer to read their reasoning.
        </p>
      </div>

      {/* Selected reviewer */}
      <div className="px-4 py-4 sm:px-5" aria-live="polite">
        <div className="flex items-center gap-2">
          <PersonalityIcon personality={selected} className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{PERSONALITY_META[selected].label}</h3>
        </div>
        {detail ? <ReviewerDetail r={detail} /> : (
          <p className="mt-3 text-sm text-muted-foreground">This reviewer didn’t respond. Re-run the review to try again.</p>
        )}
      </div>
    </div>
  )
}

function ReviewerDetail({ r }: { r: PersonalityReview }) {
  return (
    <div className="mt-3 space-y-4 text-sm">
      <p className="leading-relaxed text-foreground text-pretty">{r.verdict}</p>

      {r.key_mistake && (
        <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2">
          <p className="text-xs font-medium text-warn">Key mistake</p>
          <p className="mt-0.5 text-foreground">{r.key_mistake}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <ReviewList title="Strengths" items={r.strengths} marker="+" />
        <ReviewList title="To improve" items={r.improvements} marker="→" />
      </div>

      {/* Dimension breakdown — the matrix hides these columns on phones */}
      <dl className="grid grid-cols-5 gap-1 border-t border-border pt-3 sm:hidden">
        {DIMENSION_KEYS.map((k) => (
          <div key={k} className="text-center">
            <dt className="text-[11px] text-muted-foreground">{DIMENSION_SHORT[k]}</dt>
            <dd className={cn('font-mono text-sm font-semibold', scoreTone(r[k]))}>{r[k]}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function ReviewList({ title, items, marker }: { title: string; items: string[]; marker: string }) {
  if (!items?.length) return null
  return (
    <div>
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2 text-foreground">
            <span className="shrink-0 font-mono text-muted-foreground" aria-hidden>{marker}</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
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
