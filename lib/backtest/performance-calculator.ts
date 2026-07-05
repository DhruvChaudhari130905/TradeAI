import type { CompletedTrade, BacktestResult, EquityPoint, MonthlyReturn, DrawdownPoint, TradeDistributionBucket } from '@/lib/types/backtest'

/**
 * Compute all backtest performance metrics from the raw trade list and equity/balance curves.
 */
export function computePerformance(
  trades: CompletedTrade[],
  equityCurve: EquityPoint[],
  balanceCurve: EquityPoint[],
  startingCapital: number,
): BacktestResult {
  const totalTrades = trades.length
  const wins = trades.filter((t) => t.pnlUsd > 0)
  const losses = trades.filter((t) => t.pnlUsd < 0)
  const winningTrades = wins.length
  const losingTrades = losses.length

  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0

  const totalPnlUsd = trades.reduce((sum, t) => sum + t.pnlUsd, 0)
  const totalPnlPct = startingCapital > 0 ? (totalPnlUsd / startingCapital) * 100 : 0

  // ── Avg R:R ──
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlUsd, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0) / losses.length) : 0
  const avgRR = avgLoss > 0 ? avgWin / avgLoss : wins.length > 0 ? 999 : 0

  // ── Profit Factor ──
  const grossProfit = wins.reduce((s, t) => s + t.pnlUsd, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0

  // ── Expectancy ──
  const winRateDecimal = totalTrades > 0 ? winningTrades / totalTrades : 0
  const lossRateDecimal = totalTrades > 0 ? losingTrades / totalTrades : 0
  const expectancy = (avgWin * winRateDecimal) - (avgLoss * lossRateDecimal)

  // ── Max Drawdown ──
  const maxDrawdownPct = computeMaxDrawdown(equityCurve)

  // ── Max consecutive wins/losses ──
  const { maxConsecWins, maxConsecLosses } = computeMaxConsecutive(trades)

  // ── Avg R-multiple ──
  const tradesWithRisk = trades.filter((t) => t.initial_risk > 0)
  const avgRMultiple = tradesWithRisk.length > 0
    ? tradesWithRisk.reduce((s, t) => s + t.r_multiple, 0) / tradesWithRisk.length
    : 0

  // ── Sharpe Ratio (annualized) ──
  const sharpeRatio = computeSharpeRatio(trades, startingCapital)

  // ── Margin used % ──
  const maxEquity = Math.max(...equityCurve.map((p) => p.equity), startingCapital)
  const maxLot = trades.length > 0 ? Math.max(...trades.map((t) => t.lotSize)) : 0
  const maxTrade = trades.length > 0 ? trades.reduce((max, t) => t.lotSize > max.lotSize ? t : max, trades[0]) : null
  const marginUsedPct = maxTrade && maxEquity > 0
    ? ((maxTrade.lotSize * 100000 * maxTrade.entryPrice) / 100 / maxEquity) * 100 // assuming leverage 100
    : 0

  // ── Commission/swap/slippage totals ──
  const totalCommission = trades.reduce((s, t) => s + t.commission, 0)
  const totalSwap = trades.reduce((s, t) => s + t.swap, 0)
  const totalSlippage = trades.reduce((s, t) => s + t.slippage_cost, 0)

  // ── Extended metrics ──
  const monthlyReturns = computeMonthlyReturns(trades, startingCapital)
  const drawdownCurve = computeDrawdownCurve(equityCurve)
  const tradeDistribution = computeTradeDistribution(trades)
  const winLossRatio = totalTrades > 0 ? `${winningTrades}:${losingTrades}` : '0:0'

  return {
    total_trades: totalTrades,
    winning_trades: winningTrades,
    losing_trades: losingTrades,
    win_rate: Math.round(winRate * 10) / 10,
    total_pnl_usd: Math.round(totalPnlUsd * 100) / 100,
    total_pnl_pct: Math.round(totalPnlPct * 10) / 10,
    max_drawdown_pct: Math.round(maxDrawdownPct * 10) / 10,
    avg_rr: Math.round(avgRR * 100) / 100,
    profit_factor: Math.round(profitFactor * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    equity_curve: equityCurve,
    balance_curve: balanceCurve,
    monthly_returns: monthlyReturns,
    drawdown_curve: drawdownCurve,
    trade_distribution: tradeDistribution,
    win_loss_ratio: winLossRatio,
    max_consecutive_wins: maxConsecWins,
    max_consecutive_losses: maxConsecLosses,
    avg_r_multiple: Math.round(avgRMultiple * 100) / 100,
    sharpe_ratio: sharpeRatio,
    margin_used_pct: Math.round(marginUsedPct * 10) / 10,
    total_commission: Math.round(totalCommission * 100) / 100,
    total_swap: Math.round(totalSwap * 100) / 100,
    total_slippage_cost: Math.round(totalSlippage * 100) / 100,
    trade_log: trades,
  }
}

// ── Internal computations ────────────────────────────────────────────────────

function computeMaxDrawdown(equityCurve: EquityPoint[]): number {
  let peak = 0
  let maxDrawdown = 0

  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity
    const drawdown = peak > 0 ? ((peak - point.equity) / peak) * 100 : 0
    if (drawdown > maxDrawdown) maxDrawdown = drawdown
  }

  return maxDrawdown
}

function computeMaxConsecutive(trades: CompletedTrade[]): {
  maxConsecWins: number
  maxConsecLosses: number
} {
  let maxWins = 0
  let maxLosses = 0
  let currentWins = 0
  let currentLosses = 0

  for (const trade of trades) {
    if (trade.pnlUsd > 0) {
      currentWins++
      currentLosses = 0
      maxWins = Math.max(maxWins, currentWins)
    } else if (trade.pnlUsd < 0) {
      currentLosses++
      currentWins = 0
      maxLosses = Math.max(maxLosses, currentLosses)
    } else {
      currentWins = 0
      currentLosses = 0
    }
  }

  return { maxConsecWins: maxWins, maxConsecLosses: maxLosses }
}

function computeSharpeRatio(
  trades: CompletedTrade[],
  startingCapital: number,
): number | null {
  if (trades.length < 12) return null

  const returns = trades.map((t) => t.pnlUsd / startingCapital)
  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length

  const variance = returns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / returns.length
  const stdDev = Math.sqrt(variance)

  if (stdDev === 0) return null

  // Annualize: assume ~252 trading days per year
  const annualizedReturn = meanReturn * 252
  const annualizedStdDev = stdDev * Math.sqrt(252)
  const riskFreeRate = 0.04 / 252 // ~4% annual, daily

  return Math.round(((annualizedReturn - riskFreeRate * 252) / annualizedStdDev) * 100) / 100
}

function computeMonthlyReturns(
  trades: CompletedTrade[],
  startingCapital: number,
): MonthlyReturn[] {
  const monthMap = new Map<string, number>()

  for (const trade of trades) {
    const date = new Date(trade.exitTime)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    monthMap.set(monthKey, (monthMap.get(monthKey) ?? 0) + trade.pnlUsd)
  }

  return Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, pnl]) => ({
      month,
      pnl: Math.round(pnl * 100) / 100,
      pct: startingCapital > 0 ? Math.round((pnl / startingCapital) * 100 * 10) / 10 : 0,
    }))
}

function computeDrawdownCurve(equityCurve: EquityPoint[]): DrawdownPoint[] {
  let peak = 0
  return equityCurve.map((point) => {
    if (point.equity > peak) peak = point.equity
    const drawdown = peak > 0 ? ((peak - point.equity) / peak) * 100 : 0
    return {
      time: point.time,
      drawdown_pct: Math.round(drawdown * 100) / 100,
    }
  })
}

function computeTradeDistribution(trades: CompletedTrade[]): TradeDistributionBucket[] {
  if (trades.length === 0) return []

  const pnls = trades.map((t) => t.pnlUsd)
  const minVal = Math.min(...pnls)
  const maxVal = Math.max(...pnls)

  // Use 10 buckets
  const bucketCount = 10
  const range = maxVal - minVal
  const bucketSize = range > 0 ? range / bucketCount : 1

  const buckets: { range: string; count: number }[] = []

  for (let i = 0; i < bucketCount; i++) {
    const lower = minVal + i * bucketSize
    const upper = lower + bucketSize
    const count = trades.filter((t) => {
      if (i === bucketCount - 1) return t.pnlUsd >= lower && t.pnlUsd <= upper
      return t.pnlUsd >= lower && t.pnlUsd < upper
    }).length

    buckets.push({
      range: `$${Math.round(lower)} – $${Math.round(upper)}`,
      count,
    })
  }

  return buckets
}
