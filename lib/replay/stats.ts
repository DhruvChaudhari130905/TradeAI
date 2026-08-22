import type { ClosedReplayTrade, EquityPoint } from '@/lib/types/replay'

// Aggregate session statistics for the results page + AI review context.

export interface SessionStats {
  totalTrades: number
  wins: number
  losses: number
  breakEven: number
  winRate: number            // %
  totalPnl: number
  pnlPct: number             // vs starting balance
  grossWin: number
  grossLoss: number          // positive magnitude
  profitFactor: number | null
  avgWin: number
  avgLoss: number
  bestTrade: number
  worstTrade: number
  maxDrawdown: number        // $ from equity curve peak
  maxDrawdownPct: number
  exitBreakdown: Record<string, number>
}

export function computeSessionStats(
  closedTrades: ClosedReplayTrade[],
  equityCurve: EquityPoint[],
  startingBalance: number,
): SessionStats {
  const wins = closedTrades.filter((t) => t.pnlUsd > 0)
  const losses = closedTrades.filter((t) => t.pnlUsd < 0)
  const breakEven = closedTrades.filter((t) => t.pnlUsd === 0)

  const grossWin = wins.reduce((s, t) => s + t.pnlUsd, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0))

  // Max drawdown from the running equity peak
  let peak = startingBalance
  let maxDd = 0
  let maxDdPct = 0
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity
    const dd = peak - point.equity
    if (dd > maxDd) {
      maxDd = dd
      maxDdPct = peak > 0 ? (dd / peak) * 100 : 0
    }
  }

  const exitBreakdown: Record<string, number> = {}
  for (const t of closedTrades) {
    exitBreakdown[t.exitReason] = (exitBreakdown[t.exitReason] ?? 0) + 1
  }

  return {
    totalTrades: closedTrades.length,
    wins: wins.length,
    losses: losses.length,
    breakEven: breakEven.length,
    winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
    totalPnl: closedTrades.reduce((s, t) => s + t.pnlUsd, 0),
    pnlPct: startingBalance > 0 ? (closedTrades.reduce((s, t) => s + t.pnlUsd, 0) / startingBalance) * 100 : 0,
    grossWin,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    avgWin: wins.length > 0 ? grossWin / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    bestTrade: closedTrades.length > 0 ? Math.max(...closedTrades.map((t) => t.pnlUsd)) : 0,
    worstTrade: closedTrades.length > 0 ? Math.min(...closedTrades.map((t) => t.pnlUsd)) : 0,
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDdPct,
    exitBreakdown,
  }
}
