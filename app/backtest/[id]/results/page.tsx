'use client'

// Replay session results: stats, equity curve, trade list, AI personality review.

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getReplaySession } from '@/lib/actions/replay'
import type { PersonalityReviewSet, ReplayPersonalityReview, ReplaySessionRow } from '@/lib/types/replay'
import { computeSessionStats } from '@/lib/replay/stats'
import { priceDigits } from '@/lib/replay/execution'

const REVIEWER_META: { key: keyof Omit<PersonalityReviewSet, 'composite_score'>; label: string; accent: string }[] = [
  { key: 'prop_firm_evaluator', label: 'Prop Firm Evaluator', accent: '#F59E0B' },
  { key: 'trading_psychologist', label: 'Trading Psychologist', accent: '#A78BFA' },
  { key: 'institutional_trader', label: 'Institutional Trader', accent: '#38BDF8' },
  { key: 'quantitative_analyst', label: 'Quantitative Analyst', accent: '#00FF9C' },
  { key: 'risk_manager', label: 'Risk Manager', accent: '#FF4D4D' },
]

export default function ReplayResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [session, setSession] = useState<ReplaySessionRow | null>(null)
  const [reviews, setReviews] = useState<PersonalityReviewSet | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getReplaySession(id).then((res) => {
      if (cancelled) return
      if (!res.success) setError(res.error)
      else {
        setSession(res.data)
        setReviews(res.data.personality_reviews)
      }
    })
    return () => {
      cancelled = true
    }
  }, [id])

  const stats = useMemo(() => {
    if (!session) return null
    return computeSessionStats(session.closed_trades, session.equity_curve, Number(session.starting_balance))
  }, [session])

  async function generateReview() {
    setGenerating(true)
    try {
      const res = await fetch(`/api/replay/${id}/review`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(body?.error ?? 'Review failed.')
        return
      }
      setReviews(body.reviews as PersonalityReviewSet)
      toast.success('AI review ready')
    } catch {
      toast.error('Could not reach the AI reviewers.')
    } finally {
      setGenerating(false)
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <p className="text-sm text-[#FF4D4D]">{error}</p>
        <Link href="/backtest" className="inline-flex h-9 items-center rounded-md border border-[#27272A] px-4 text-sm hover:bg-[#1C1E26]">
          Back to sessions
        </Link>
      </div>
    )
  }

  if (!session || !stats) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-[#00FF9C]" />
      </div>
    )
  }

  const digits = priceDigits(session.pair, session.market)

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-bold">{session.pair}</h1>
        <Badge variant="secondary" className="text-[10px] uppercase">{session.status}</Badge>
        <span className="text-xs text-zinc-500">
          {(session.timeframes as string[]).join(' · ')} · {session.date_from} → {session.date_to}
        </span>
        <Link href="/backtest" className="ml-auto text-xs text-zinc-500 hover:text-zinc-100">
          ← All sessions
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Net PnL" value={`${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}`} sub={`${stats.pnlPct >= 0 ? '+' : ''}${stats.pnlPct.toFixed(2)}%`} positive={stats.totalPnl >= 0} />
        <StatCard label="Win rate" value={`${stats.winRate.toFixed(1)}%`} sub={`${stats.wins}W / ${stats.losses}L`} />
        <StatCard label="Profit factor" value={stats.profitFactor === null ? '—' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)} />
        <StatCard label="Max drawdown" value={`-$${stats.maxDrawdown.toFixed(2)}`} sub={`${stats.maxDrawdownPct.toFixed(1)}%`} negative={stats.maxDrawdownPct > 20} />
        <StatCard label="Avg win / loss" value={`$${stats.avgWin.toFixed(0)} / $${stats.avgLoss.toFixed(0)}`} />
        <StatCard label="Trades" value={String(stats.totalTrades)} sub={`${Object.entries(stats.exitBreakdown).map(([k, v]) => `${k} ${v}`).join(', ')}`} />
      </div>

      {/* Equity curve */}
      {session.equity_curve.length > 1 && (
        <div className="rounded-lg border border-[#27272A] bg-[#12141A] p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Equity curve</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={session.equity_curve.map((p) => ({ ...p, label: p.time.slice(5, 16) }))}>
                <defs>
                  <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00FF9C" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#00FF9C" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#181A20" />
                <XAxis dataKey="label" tick={{ fill: '#71717A', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#27272A' }} minTickGap={48} />
                <YAxis tick={{ fill: '#71717A', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#27272A' }} domain={['auto', 'auto']} width={70} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
                <Tooltip contentStyle={{ background: '#12141A', border: '1px solid #27272A', borderRadius: 8, fontSize: 12 }} formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Equity']} />
                <Area type="monotone" dataKey="equity" stroke="#00FF9C" strokeWidth={1.5} fill="url(#equityFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Trade list */}
      <div className="rounded-lg border border-[#27272A] bg-[#12141A]">
        <h2 className="border-b border-[#27272A] px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Trades ({session.closed_trades.length})
        </h2>
        {session.closed_trades.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-zinc-600">No trades taken this session.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-[#27272A] text-[10px] uppercase tracking-wider text-zinc-600">
                  <th className="px-4 py-2 font-medium">Dir</th>
                  <th className="px-2 py-2 font-medium">Lots</th>
                  <th className="px-2 py-2 font-medium">Entry</th>
                  <th className="px-2 py-2 font-medium">Exit</th>
                  <th className="px-2 py-2 font-medium hidden sm:table-cell">Entry time</th>
                  <th className="px-2 py-2 font-medium">Pips</th>
                  <th className="px-2 py-2 font-medium text-right">PnL</th>
                  <th className="px-4 py-2 font-medium hidden md:table-cell">Exit reason</th>
                </tr>
              </thead>
              <tbody>
                {session.closed_trades.map((t) => (
                  <tr key={t.id} className="border-b border-[#181A20] last:border-0">
                    <td className={`px-4 py-2 font-bold ${t.direction === 'long' ? 'text-[#00FF9C]' : 'text-[#FF4D4D]'}`}>
                      {t.direction === 'long' ? 'L' : 'S'}
                    </td>
                    <td className="px-2 py-2">{t.lotSize}</td>
                    <td className="px-2 py-2 text-zinc-400">{t.entryPrice.toFixed(digits)}</td>
                    <td className="px-2 py-2 text-zinc-400">{t.exitPrice.toFixed(digits)}</td>
                    <td className="px-2 py-2 text-zinc-600 hidden sm:table-cell">{t.entryTime.slice(0, 16)}</td>
                    <td className="px-2 py-2 text-zinc-400">{t.pnlPips >= 0 ? '+' : ''}{t.pnlPips.toFixed(1)}</td>
                    <td className={`px-2 py-2 text-right font-bold ${t.pnlUsd >= 0 ? 'text-[#00FF9C]' : 'text-[#FF4D4D]'}`}>
                      {t.pnlUsd >= 0 ? '+' : ''}{t.pnlUsd.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-zinc-500 hidden md:table-cell">{t.exitReason.replace('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AI review */}
      <div className="rounded-lg border border-[#27272A] bg-[#12141A] p-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Sparkles className="h-4 w-4 text-[#00FF9C]" />
          <h2 className="text-sm font-semibold">AI Personality Review</h2>
          {reviews?.composite_score !== null && reviews !== null && (
            <Badge variant="secondary" className="font-mono">{reviews.composite_score}/10 composite</Badge>
          )}
          {reviews === null && session.closed_trades.length > 0 && (
            <Button size="sm" onClick={generateReview} disabled={generating}
              className="ml-auto bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90">
              {generating ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Reviewing…
                </>
              ) : (
                'Generate AI review'
              )}
            </Button>
          )}
        </div>

        {reviews === null ? (
          <p className="py-2 text-xs text-zinc-600">
            {session.closed_trades.length === 0
              ? 'Take some trades in the session first.'
              : 'Five AI personalities will score this session on rule quality, risk management, consistency and robustness.'}
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {REVIEWER_META.map(({ key, label, accent }) => {
              const review = reviews[key] as ReplayPersonalityReview | null
              if (!review) return null
              return <ReviewCard key={key} label={label} accent={accent} review={review} />
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, positive, negative }: { label: string; value: string; sub?: string; positive?: boolean; negative?: boolean }) {
  return (
    <div className="rounded-lg border border-[#27272A] bg-[#12141A] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</p>
      <p className={`font-mono text-base font-bold ${positive ? 'text-[#00FF9C]' : negative ? 'text-[#FF4D4D]' : ''}`}>{value}</p>
      {sub && <p className="truncate font-mono text-[10px] text-zinc-600">{sub}</p>}
    </div>
  )
}

function ReviewCard({ label, accent, review }: { label: string; accent: string; review: ReplayPersonalityReview }) {
  return (
    <div className="rounded-lg border border-[#27272A] bg-[#1C1E26] p-3">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
        <span className="text-xs font-semibold">{label}</span>
        <span className="ml-auto font-mono text-xs font-bold" style={{ color: accent }}>
          {review.overall}/10 · {review.grade}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">{review.verdict}</p>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-zinc-500">
        <span>Rule quality {review.rule_quality}/10</span>
        <span>Risk mgmt {review.risk_management}/10</span>
        <span>Consistency {review.strategy_consistency}/10</span>
        <span>Robustness {review.robustness}/10</span>
      </div>

      <div className="mt-2 space-y-1.5">
        <BulletList title="Strengths" items={review.strengths} color="#00FF9C" />
        <BulletList title="Weaknesses" items={review.weaknesses} color="#FF4D4D" />
        <BulletList title="Improvements" items={review.improvements} color="#F59E0B" />
      </div>

      <p className={`mt-2 text-[10px] font-semibold ${review.prop_firm_suitable ? 'text-[#00FF9C]' : 'text-[#FF4D4D]'}`}>
        {review.prop_firm_suitable ? '✓ Prop-firm suitable' : '✗ Not prop-firm suitable yet'}
      </p>
    </div>
  )
}

function BulletList({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (!Array.isArray(items) || items.length === 0) return null
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>{title}</p>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-[11px] leading-snug text-zinc-400">• {item}</li>
        ))}
      </ul>
    </div>
  )
}
