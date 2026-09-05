'use client'

// Builds the live [SESSION DATA] snapshot for both the reactive chat panel and
// the proactive coach hook. Pure client-side computation.

import { priceDigits } from '@/lib/replay/execution'
import { computeIndicators, type IndicatorSeries } from '@/lib/replay/indicators'
import type {
  Candle,
  ClosedReplayTrade,
  DrawingShape,
  PendingOrder,
  ReplayIndicatorConfig,
  ReplayPosition,
  Timeframe,
} from '@/lib/types/replay'
import type { ReplayContextSnapshot } from '@/lib/nim/build-replay-context'

interface SnapshotConfig {
  id: string
  pair: string
  market: 'forex' | 'crypto'
  leverage: number
  spreadPips: number
}

export interface SnapshotInput {
  config: SnapshotConfig
  activeTf: Timeframe
  visibleCandles: Candle[]
  positions: ReplayPosition[]
  orders: PendingOrder[]
  balance: number
  equity: number
  marginUsed: number
  freeMargin: number
  indicatorConfigs: ReplayIndicatorConfig[]
  drawings: DrawingShape[]
  closedTrades: ClosedReplayTrade[]
}

/** Current value of one configured indicator, or null when not computable */
function currentValue(
  cfg: ReplayIndicatorConfig,
  results: Map<string, number[] | IndicatorSeries>,
): number | null {
  let series: number[] | undefined
  if (cfg.type === 'EMA' || cfg.type === 'SMA') {
    series = results.get(`${cfg.type.toLowerCase()}_${cfg.params.period ?? (cfg.type === 'EMA' ? 9 : 20)}`) as number[] | undefined
  } else if (cfg.type === 'RSI') {
    series = results.get(`rsi_${cfg.params.period ?? 14}`) as number[] | undefined
  } else if (cfg.type === 'MACD') {
    series = (results.get('macd') as IndicatorSeries | undefined)?.macd
  } else if (cfg.type === 'BBANDS') {
    series = (results.get('bbands') as IndicatorSeries | undefined)?.middle
  }
  if (!series || series.length === 0) return null
  const last = series[series.length - 1]
  return Number.isFinite(last) ? last : null
}

function drawingSummary(d: DrawingShape, digits: number): string {
  const p = (n: number) => n.toFixed(digits)
  switch (d.kind) {
    case 'hline':
      return `hline ${p(d.points[0].price)}`
    case 'vline':
      return `vline ${d.points[0].time.slice(0, 16)}`
    case 'trendline':
      return `trendline ${p(d.points[0].price)} to ${p(d.points[1].price)}`
    case 'rect':
      return `zone ${p(Math.min(d.points[0].price, d.points[1].price))}-${p(Math.max(d.points[0].price, d.points[1].price))}`
    case 'fib':
      return `fib ${p(Math.max(d.points[0].price, d.points[1].price))} to ${p(Math.min(d.points[0].price, d.points[1].price))}`
    default:
      return d.label ?? d.kind
  }
}

export function buildReplaySnapshot(input: SnapshotInput): ReplayContextSnapshot {
  const { config, activeTf, visibleCandles, positions, orders, balance, equity, marginUsed, freeMargin, indicatorConfigs, drawings, closedTrades } = input
  const digits = priceDigits(config.pair, config.market)
  const visibleConfigs = indicatorConfigs.filter((c) => c.visible)
  const results =
    visibleConfigs.length > 0
      ? computeIndicators(
          visibleCandles,
          visibleConfigs.map((c) => ({ type: c.type, params: c.params })),
        )
      : new Map()

  return {
    pair: config.pair,
    market: config.market,
    activeTimeframe: activeTf,
    currentTime: visibleCandles[visibleCandles.length - 1]?.time ?? '',
    balance,
    equity,
    marginUsed,
    freeMargin,
    leverage: config.leverage,
    spreadPips: config.spreadPips,
    recentCandles: visibleCandles.slice(-60),
    indicators: visibleConfigs.map((c) => ({ label: `${c.type}`, value: currentValue(c, results) })),
    positions,
    pendingOrders: orders,
    closedTradeCount: closedTrades.length,
    recentClosedTrades: closedTrades.slice(-5).map((t) => ({
      direction: t.direction,
      pnlUsd: t.pnlUsd,
      pnlPips: t.pnlPips,
      exitReason: t.exitReason,
    })),
    drawingsSummary: drawings.map((d) => drawingSummary(d, digits)),
  }
}