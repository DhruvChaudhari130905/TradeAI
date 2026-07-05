import { getNimClient, NIM_MODEL, NIM_FALLBACK_MODEL } from '@/lib/nim/client'
import { parseNimJson } from '@/lib/nim/parse-nim-json'
import { BACKTEST_PERSONALITY_PROMPTS } from '@/lib/prompts/backtest-review-prompts'
import { describeExpr } from '@/lib/backtest/expr-engine'
import type { StrategyRuleSet, BacktestResult, BacktestPersonalityReview, BoolExpr } from '@/lib/types/backtest'

const INTER_PERSONALITY_DELAY_MS = 500

/**
 * Generate 5 personality reviews for a backtest by calling NIM in parallel.
 * Each personality evaluates the strategy + results through their unique lens.
 */
export async function generateBacktestReviews(
  rules: StrategyRuleSet,
  result: BacktestResult,
  params: { pair: string; timeframe: string; dateFrom: string; dateTo: string; startingCapital: number },
): Promise<BacktestPersonalityReview[]> {
  const dataPayload = buildReviewPayload(rules, result, params)

  // Call all 5 personalities in parallel
  const reviewPromises = BACKTEST_PERSONALITY_PROMPTS.map((personality) =>
    callPersonalityNIM(personality.prompt, personality.name, dataPayload)
      .catch(() => null)
  )

  const results = await Promise.all(reviewPromises)

  // Map results to BacktestPersonalityReview, filtering out failures
  return results
    .filter((r): r is BacktestPersonalityReview => r !== null)
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildReviewPayload(
  rules: StrategyRuleSet,
  result: BacktestResult,
  params: { pair: string; timeframe: string; dateFrom: string; dateTo: string; startingCapital: number },
): string {
  const indicatorSummary = rules.indicators
    .map((i) => `${i.type}(${Object.entries(i.params).map(([k, v]) => `${k}=${v}`).join(', ')})`)
    .join(', ')

  const conditionsSummary = (conditions: BoolExpr[]) =>
    conditions.map((c) => describeExpr(c)).join('; ')

  return `Strategy Rules:
- Name: ${rules.name}
- Timeframe: ${rules.timeframe}
- Indicators: ${indicatorSummary}
- Entry Long: ${conditionsSummary(rules.entry_long) || 'None'}
- Entry Short: ${conditionsSummary(rules.entry_short) || 'None'}
- Exit Long: ${conditionsSummary(rules.exit_long) || 'None'}
- Exit Short: ${conditionsSummary(rules.exit_short) || 'None'}
- Stop Loss: ${rules.stop_loss.method}${rules.stop_loss.value ? ` ${rules.stop_loss.value} pips` : ''}${rules.stop_loss.atr_multiplier ? ` ${rules.stop_loss.atr_multiplier}x ATR` : ''}
- Take Profit: ${rules.take_profit.method}${rules.take_profit.value ? ` ${rules.take_profit.value} pips` : ''}${rules.take_profit.rr_ratio ? ` ${rules.take_profit.rr_ratio}R` : ''}
- Risk per trade: ${rules.risk_per_trade_pct}%
- Position sizing: ${rules.position_sizing.method}${rules.position_sizing.value ? ` ${rules.position_sizing.value}` : ''}
- Order type: ${rules.order_type}
${rules.session_filter?.sessions?.length ? `- Sessions: ${rules.session_filter.sessions.join(', ')} (${rules.session_filter.alignment})` : ''}
- Trade management: ${rules.trade_management.map((r) => `${r.type}(${JSON.stringify(r.params)})`).join(', ') || 'None'}

Backtest Parameters:
- Pair: ${params.pair}
- Timeframe: ${params.timeframe}
- Date range: ${params.dateFrom} to ${params.dateTo}
- Starting capital: $${params.startingCapital.toLocaleString()}

Performance Statistics:
- Total trades: ${result.total_trades}
- Win rate: ${result.win_rate.toFixed(1)}%
- Total PnL: $${result.total_pnl_usd.toFixed(2)} (${result.total_pnl_pct.toFixed(1)}%)
- Max drawdown: ${result.max_drawdown_pct.toFixed(1)}%
- Profit factor: ${result.profit_factor.toFixed(2)}
- Avg R:R: ${result.avg_rr.toFixed(2)}
- Expectancy: $${result.expectancy.toFixed(2)}
- Max consecutive wins: ${result.max_consecutive_wins}
- Max consecutive losses: ${result.max_consecutive_losses}
- Avg R-multiple: ${result.avg_r_multiple.toFixed(2)}
- Sharpe ratio: ${result.sharpe_ratio?.toFixed(2) ?? 'N/A'}
- Margin used: ${result.margin_used_pct.toFixed(1)}%
- Commission: $${result.total_commission.toFixed(2)}
- Swap: $${result.total_swap.toFixed(2)}
- Slippage: $${result.total_slippage_cost.toFixed(2)}


Trade Log (first 15 trades):
${result.trade_log.slice(0, 15).map((t, i) => `#${i + 1}: ${t.direction} | entry=${t.entryPrice} exit=${t.exitPrice} | PnL=$${t.pnlUsd.toFixed(2)} (${t.r_multiple}R) | lots=${t.lotSize} | ${t.exitReason}`).join('\n')}`
}

async function callPersonalityNIM(
  systemPrompt: string,
  personalityName: string,
  dataPayload: string,
): Promise<BacktestPersonalityReview> {
  const client = getNimClient()

  const callWithModel = async (model: string): Promise<BacktestPersonalityReview> => {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: dataPayload },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    })

    const raw = completion.choices[0]?.message?.content
    if (!raw) throw new Error(`Empty response from NIM for ${personalityName}`)

    const review = parseNimJson<BacktestPersonalityReview>(raw)
    return { ...review, personality: personalityName }
  }

  try {
    return await callWithModel(NIM_MODEL)
  } catch {
    return await callWithModel(NIM_FALLBACK_MODEL)
  }
}
