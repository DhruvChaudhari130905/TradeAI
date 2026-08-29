import type { Candle, PendingOrder, ReplayPosition } from '@/lib/types/replay'
import { floatingPnl, pipSize, priceDigits } from '@/lib/replay/execution'

// Builds the [SESSION DATA] block the replay coach sees each turn.
// Pure functions — safe on client (snapshot build) and server (formatting).

export interface ReplayContextSnapshot {
  pair: string
  market: 'forex' | 'crypto'
  activeTimeframe: string
  currentTime: string
  balance: number
  equity: number
  marginUsed: number
  freeMargin: number
  leverage: number
  spreadPips: number
  recentCandles: Candle[]
  indicators: { label: string; value: number | null }[]
  positions: ReplayPosition[]
  pendingOrders: PendingOrder[]
  closedTradeCount: number
  recentClosedTrades: {
    direction: 'long' | 'short'
    pnlUsd: number
    pnlPips: number
    exitReason: string
  }[]
  drawingsSummary: string[]
}

export function buildReplayContext(s: ReplayContextSnapshot): string {
  const lines: string[] = []
  const digits = priceDigits(s.pair, s.market)
  const fmt = (n: number) => n.toFixed(digits)

  lines.push('[SESSION DATA]')
  lines.push(`Instrument: ${s.pair} (${s.market}) · TF ${s.activeTimeframe} · current bar ${s.currentTime}`)
  lines.push(
    `Account: balance $${s.balance.toFixed(2)} · equity $${s.equity.toFixed(2)} · margin used $${s.marginUsed.toFixed(2)} · free $${s.freeMargin.toFixed(2)} · leverage 1:${s.leverage}`,
  )

  if (s.recentCandles.length > 0) {
    const ps = pipSize(s.pair, s.market)
    const candles = s.recentCandles.slice(-60)
    const first = candles[0]
    const range = Math.max(...candles.map((c) => c.high)) - Math.min(...candles.map((c) => c.low))
    lines.push(
      `Recent ${candles.length} candles (oldest→newest, last = current bar). Range high ${fmt(Math.max(...candles.map((c) => c.high)))}, low ${fmt(Math.min(...candles.map((c) => c.low)))} (${(range / ps).toFixed(1)} pips), first open ${fmt(first.open)}:`,
    )
    for (const c of candles) {
      const dir = c.close >= c.open ? '+' : '-'
      lines.push(`${dir} ${c.time} O${fmt(c.open)} H${fmt(c.high)} L${fmt(c.low)} C${fmt(c.close)}`)
    }
  }

  if (s.indicators.length > 0) {
    lines.push(
      `Indicators (current values): ${s.indicators
        .map((i) => `${i.label}=${i.value !== null && Number.isFinite(i.value) ? i.value.toFixed(digits > 2 ? 5 : 4) : 'n/a'}`)
        .join(', ')}`,
    )
  }

  if (s.positions.length === 0) {
    lines.push('Open positions: none')
  } else {
    const last = s.recentCandles[s.recentCandles.length - 1]
    lines.push('Open positions:')
    for (const p of s.positions) {
      const fl = last ? floatingPnl(p, last.close, s.pair, s.market) : 0
      lines.push(
        `- ${p.direction.toUpperCase()} ${p.lotSize} lots @ ${fmt(p.entryPrice)}, floating $${fl.toFixed(2)}, SL ${p.stopLoss !== null ? fmt(p.stopLoss) : 'NONE'}, TP ${p.takeProfit !== null ? fmt(p.takeProfit) : 'NONE'}${p.trailingStopPips !== null ? `, trailing ${p.trailingStopPips}p` : ''}${p.partialCloses.length > 0 ? `, ${p.partialCloses.length} partial close(s)` : ''}${p.breakEvenMoved ? ', SL moved to breakeven' : ''}`,
      )
    }
  }

  if (s.pendingOrders.length > 0) {
    lines.push(
      `Pending orders: ${s.pendingOrders
        .map((o) => `${o.side} ${o.type} ${o.lotSize} @ ${fmt(o.price)}`)
        .join('; ')}`,
    )
  }

  lines.push(`Closed trades this session: ${s.closedTradeCount}`)
  if (s.recentClosedTrades.length > 0) {
    lines.push('Last results:')
    for (const t of s.recentClosedTrades) {
      lines.push(`- ${t.direction} ${t.pnlUsd >= 0 ? '+' : ''}$${t.pnlUsd.toFixed(2)} (${t.pnlPips.toFixed(1)} pips, ${t.exitReason})`)
    }
  }

  if (s.drawingsSummary.length > 0) {
    lines.push(`Drawn levels/notes: ${s.drawingsSummary.join('; ')}`)
  }

  return lines.join('\n')
}
