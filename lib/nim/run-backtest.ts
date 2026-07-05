import { getNimClient, NIM_MODEL, NIM_FALLBACK_MODEL } from '@/lib/nim/client'
import { BACKTEST_ANALYST_PROMPT } from '@/lib/prompts/backtest-system-prompts'
import { describeExpr } from '@/lib/backtest/expr-engine'
import type { StrategyRuleSet, BacktestResult, BoolExpr } from '@/lib/types/backtest'

/**
 * Generate AI narrative report from backtest results.
 * Takes the structured StrategyRuleSet and deterministic BacktestResult,
 * produces a markdown analysis via NIM.
 */
export async function generateBacktestReport(
  strategyRules: StrategyRuleSet,
  result: BacktestResult,
  params: { pair: string; timeframe: string; dateFrom: string; dateTo: string; startingCapital: number },
): Promise<string> {
  // Build a human-readable summary of the structured rules
  const indicatorSummary = strategyRules.indicators
    .map((i) => `${i.type}(${Object.entries(i.params).map(([k, v]) => `${k}=${v}`).join(', ')})`)
    .join(', ')

  const conditionsSummary = (conditions: BoolExpr[]) =>
    conditions.map((c) => describeExpr(c)).join('; ')

  const userMessage = `Strategy: "${strategyRules.name}"
Timeframe: ${strategyRules.timeframe}
Indicators: ${indicatorSummary}
Entry Long: ${conditionsSummary(strategyRules.entry_long) || 'None'}
Entry Short: ${conditionsSummary(strategyRules.entry_short) || 'None'}
Exit Long: ${conditionsSummary(strategyRules.exit_long) || 'None'}
Exit Short: ${conditionsSummary(strategyRules.exit_short) || 'None'}
SL: ${strategyRules.stop_loss.method}${strategyRules.stop_loss.value ? ` (${strategyRules.stop_loss.value})` : ''}${strategyRules.stop_loss.atr_multiplier ? ` (${strategyRules.stop_loss.atr_multiplier}x ATR)` : ''}
TP: ${strategyRules.take_profit.method}${strategyRules.take_profit.value ? ` (${strategyRules.take_profit.value})` : ''}${strategyRules.take_profit.rr_ratio ? ` (${strategyRules.take_profit.rr_ratio}R)` : ''}
Risk per trade: ${strategyRules.risk_per_trade_pct}%
Position sizing: ${strategyRules.position_sizing.method}
Order type: ${strategyRules.order_type}
${strategyRules.session_filter?.sessions?.length ? `Sessions: ${strategyRules.session_filter.sessions.join(', ')} (${strategyRules.session_filter.alignment})` : ''}
Trade management: ${strategyRules.trade_management.map((r) => `${r.type}(${JSON.stringify(r.params)})`).join(', ') || 'None'}

Backtest Parameters:
- Pair: ${params.pair}
- Timeframe: ${params.timeframe}
- Date range: ${params.dateFrom} to ${params.dateTo}
- Starting capital: $${params.startingCapital.toLocaleString()}

Performance Statistics:
- Total trades: ${result.total_trades}
- Winning trades: ${result.winning_trades}
- Losing trades: ${result.losing_trades}
- Win rate: ${result.win_rate.toFixed(1)}%
- Total PnL: $${result.total_pnl_usd.toFixed(2)} (${result.total_pnl_pct.toFixed(1)}%)
- Max drawdown: ${result.max_drawdown_pct.toFixed(1)}%
- Avg R:R: ${result.avg_rr.toFixed(2)}
- Profit factor: ${result.profit_factor.toFixed(2)}
- Expectancy: $${result.expectancy.toFixed(2)}
- Max consecutive wins: ${result.max_consecutive_wins}
- Max consecutive losses: ${result.max_consecutive_losses}
- Avg R-multiple: ${result.avg_r_multiple.toFixed(2)}
- Sharpe ratio: ${result.sharpe_ratio?.toFixed(2) ?? 'N/A'}
- Total commission: $${result.total_commission.toFixed(2)}
- Total swap: $${result.total_swap.toFixed(2)}
- Total slippage: $${result.total_slippage_cost.toFixed(2)}

Trade Log (first 20 trades):
${result.trade_log.slice(0, 20).map((t, i) => `#${i + 1}: ${t.direction} | entry=${t.entryPrice} exit=${t.exitPrice} | PnL=$${t.pnlUsd.toFixed(2)} (${t.r_multiple}R) | ${t.exitReason}`).join('\n')}`

  try {
    return await callAnalystNIM(userMessage)
  } catch {
    try {
      return await callAnalystNIM(userMessage, NIM_FALLBACK_MODEL)
    } catch (error) {
      console.error('[run-backtest] report generation failed:', error)
      return '## Report Generation Failed\n\nThe AI narrative report could not be generated. Please review the performance statistics above.'
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

async function callAnalystNIM(userMessage: string, model: string = NIM_MODEL): Promise<string> {
  const client = getNimClient()

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: BACKTEST_ANALYST_PROMPT },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 4096,
    temperature: 0.4,
  })

  const report = completion.choices[0]?.message?.content
  if (!report) throw new Error('Empty response from NIM for backtest report')
  return report
}
