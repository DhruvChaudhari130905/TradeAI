import type { ClosedReplayTrade, PersonalityReviewSet, ReplayPersonalityReview, ReplaySessionRow } from '@/lib/types/replay'
import { computeSessionStats, type SessionStats } from '@/lib/replay/stats'
import { priceDigits } from '@/lib/replay/execution'
import {
  REPLAY_PROP_FIRM_EVALUATOR_PROMPT,
  REPLAY_INSTITUTIONAL_TRADER_PROMPT,
  REPLAY_QUANTITATIVE_ANALYST_PROMPT,
  REPLAY_RISK_MANAGER_PROMPT,
  REPLAY_TRADING_PSYCHOLOGIST_PROMPT,
} from '@/lib/prompts/replay-review-prompts'
import { getNimClient, NIM_MODEL, NIM_FALLBACK_MODEL } from './client'
import { parseNimJson } from './parse-nim-json'

// Runs the 5-personality AI review of a completed replay session.
// Server-only (NIM calls).

export function buildReplayReviewContext(
  session: Pick<ReplaySessionRow, 'pair' | 'market' | 'timeframes' | 'starting_balance' | 'balance' | 'closed_trades' | 'equity_curve'>,
): { context: string; stats: SessionStats; trades: ClosedReplayTrade[] } {
  const trades = session.closed_trades
  const stats = computeSessionStats(trades, session.equity_curve, Number(session.starting_balance))

  const lines: string[] = []
  const digits = priceDigits(String(session.pair), session.market)

  lines.push('[REPLAY SESSION DATA]')
  lines.push(`Instrument: ${session.pair} (${session.market}) · timeframes: ${(session.timeframes as string[]).join(', ')}`)
  lines.push(
    `Account: start $${Number(session.starting_balance).toFixed(2)} → end balance $${Number(session.balance).toFixed(2)} (PnL ${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}, ${stats.pnlPct.toFixed(2)}%)`,
  )
  lines.push(`Max drawdown: $${stats.maxDrawdown.toFixed(2)} (${stats.maxDrawdownPct.toFixed(1)}%)`)
  lines.push(
    `Trades: ${stats.totalTrades} total · ${stats.wins}W / ${stats.losses}L / ${stats.breakEven}BE · win rate ${stats.winRate.toFixed(1)}%`,
  )
  lines.push(
    `Profit factor: ${stats.profitFactor === null ? 'n/a' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)} · gross win $${stats.grossWin.toFixed(2)} · gross loss $${stats.grossLoss.toFixed(2)}`,
  )
  lines.push(
    `Avg win $${stats.avgWin.toFixed(2)} · avg loss $${stats.avgLoss.toFixed(2)} · best ${stats.bestTrade >= 0 ? '+' : ''}$${stats.bestTrade.toFixed(2)} · worst -$${Math.abs(stats.worstTrade).toFixed(2)}`,
  )

  if (Object.keys(stats.exitBreakdown).length > 0) {
    lines.push(`Exit reasons: ${Object.entries(stats.exitBreakdown).map(([k, v]) => `${k}×${v}`).join(', ')}`)
  }

  if (trades.length > 0) {
    lines.push('All trades in order:')
    for (const t of trades) {
      const sl = t.stopLoss !== null ? t.stopLoss.toFixed(digits) : 'none'
      lines.push(
        `- ${t.direction} ${t.lotSize} @ ${t.entryPrice.toFixed(digits)} → ${t.exitPrice.toFixed(digits)}, SL ${sl}, ${t.pnlUsd >= 0 ? '+' : ''}${t.pnlUsd.toFixed(2)} USD (${t.pnlPips.toFixed(1)} pips), exit: ${t.exitReason}`,
      )
    }
  } else {
    lines.push('The trader took NO trades this session.')
  }

  return { context: lines.join('\n'), stats, trades }
}

const REVIEWERS: { key: keyof Omit<PersonalityReviewSet, 'composite_score'>; prompt: string }[] = [
  { key: 'prop_firm_evaluator', prompt: REPLAY_PROP_FIRM_EVALUATOR_PROMPT },
  { key: 'trading_psychologist', prompt: REPLAY_TRADING_PSYCHOLOGIST_PROMPT },
  { key: 'institutional_trader', prompt: REPLAY_INSTITUTIONAL_TRADER_PROMPT },
  { key: 'quantitative_analyst', prompt: REPLAY_QUANTITATIVE_ANALYST_PROMPT },
  { key: 'risk_manager', prompt: REPLAY_RISK_MANAGER_PROMPT },
]

function isValidReview(review: unknown): review is ReplayPersonalityReview {
  if (typeof review !== 'object' || review === null) return false
  const r = review as Record<string, unknown>
  const scoreKeys = ['rule_quality', 'risk_management', 'strategy_consistency', 'robustness', 'overall']
  if (!scoreKeys.every((k) => typeof r[k] === 'number')) return false
  if (!['A', 'B', 'C', 'D', 'F'].includes(r.grade as string)) return false
  return typeof r.verdict === 'string'
}

async function callReviewer(prompt: string, context: string): Promise<ReplayPersonalityReview | null> {
  for (const model of [NIM_MODEL, NIM_FALLBACK_MODEL]) {
    try {
      const completion = await getNimClient().chat.completions.create({
        model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: context },
        ],
        max_tokens: 2048,
        temperature: 0.3,
      })
      const raw = completion.choices[0]?.message?.content
      if (!raw) continue
      const parsed = parseNimJson<ReplayPersonalityReview>(raw)
      if (isValidReview(parsed)) {
        // Clamp scores
        for (const k of ['rule_quality', 'risk_management', 'strategy_consistency', 'robustness', 'overall'] as const) {
          parsed[k] = Math.max(1, Math.min(10, Math.round(parsed[k])))
        }
        return parsed
      }
    } catch (err) {
      console.error(`[run-replay-reviews] ${model} failed:`, err)
    }
  }
  return null
}

/** Run all 5 reviewers sequentially with a small delay (NIM rate limits); partial failures yield null slots */
export async function runReplayReviews(context: string): Promise<PersonalityReviewSet> {
  const set: PersonalityReviewSet = {
    prop_firm_evaluator: null,
    trading_psychologist: null,
    institutional_trader: null,
    quantitative_analyst: null,
    risk_manager: null,
    composite_score: null,
  }

  for (const reviewer of REVIEWERS) {
    set[reviewer.key] = await callReviewer(reviewer.prompt, context)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  const scores = REVIEWERS.map((r) => set[r.key]).filter((r): r is ReplayPersonalityReview => r !== null)
  if (scores.length > 0) {
    set.composite_score =
      Math.round(
        (scores.reduce((s, r) => s + (r.overall as number), 0) / scores.length) * 10,
      ) / 10
  }

  return set
}
