// Pure bar-by-bar replay simulation. The React layer owns state; every function
// here takes state pieces and returns new state pieces — no React, no I/O.

import type {
  ClosedReplayTrade,
  EquityPoint,
  ExitReason,
  PendingOrder,
  ReplayPosition,
} from '@/lib/types/replay'
import {
  fillPrice,
  floatingPnl,
  marginFor,
  pipSize,
  roundLots,
  tradePnl,
  usedMargin,
  isStopOut,
} from './execution'

export interface SimConfig {
  pair: string
  market: 'forex' | 'crypto'
  leverage: number
  spreadPips: number
}

export interface SimBar {
  time: string
  open: number
  high: number
  low: number
  close: number
}

export interface SimState {
  cursorIndex: number
  balance: number
  positions: ReplayPosition[]
  orders: PendingOrder[]
  closedTrades: ClosedReplayTrade[]
}

export interface StepOutcome extends SimState {
  equityPoint: EquityPoint
  events: string[] // human-readable notices (fills, SL/TP hits, stop-out)
}

let idCounter = 0
export function newId(): string {
  idCounter += 1
  return `r${Date.now().toString(36)}${idCounter}`
}

// ── Actions (pure) ────────────────────────────────────────────────────────────

export function openMarketPosition(
  state: SimState,
  side: 'buy' | 'sell',
  lots: number,
  bar: SimBar,
  cfg: SimConfig,
  stopLoss: number | null,
  takeProfit: number | null,
): { state: SimState; event?: string } {
  const direction = side === 'buy' ? 'long' : 'short'
  const entry = fillPrice(side, bar.close, cfg.pair, cfg.market, cfg.spreadPips)

  // Margin check: require free margin (equity − used) to cover the new position
  const mid = bar.close
  const equity = state.balance + state.positions.reduce(
    (sum, p) => sum + floatingPnl(p, mid, cfg.pair, cfg.market), 0,
  )
  const used = usedMargin(state.positions, cfg.leverage, cfg.market)
  const need = marginFor(entry, lots, cfg.leverage, cfg.market)
  if (equity - used < need) {
    return { state, event: 'Order rejected: not enough free margin.' }
  }

  const position: ReplayPosition = {
    id: newId(),
    direction,
    lotSize: roundLots(lots),
    initialLots: roundLots(lots),
    entryPrice: entry,
    entryTime: bar.time,
    stopLoss,
    takeProfit,
    trailingStopPips: null,
    breakEvenMoved: false,
    partialCloses: [],
  }

  return { state: { ...state, positions: [...state.positions, position] } }
}

export function placeOrder(
  state: SimState,
  order: Omit<PendingOrder, 'id' | 'createdAt'>,
  bar: SimBar,
): SimState {
  return {
    ...state,
    orders: [...state.orders, { ...order, id: newId(), createdAt: bar.time }],
  }
}

export function cancelOrder(state: SimState, orderId: string): SimState {
  return { ...state, orders: state.orders.filter((o) => o.id !== orderId) }
}

export function modifyOrder(
  state: SimState,
  orderId: string,
  patch: Partial<Pick<PendingOrder, 'stopLoss' | 'takeProfit' | 'price'>>,
): SimState {
  return {
    ...state,
    orders: state.orders.map((o) => (o.id === orderId ? { ...o, ...patch } : o)),
  }
}

export function modifyPosition(
  state: SimState,
  positionId: string,
  patch: Partial<Pick<ReplayPosition, 'stopLoss' | 'takeProfit' | 'trailingStopPips' | 'breakEvenMoved'>>,
): SimState {
  return {
    ...state,
    positions: state.positions.map((p) => (p.id === positionId ? { ...p, ...patch } : p)),
  }
}

/** Close `lots` of a position at the given fill price. If lots >= remaining,
 *  the position closes fully and a trade record is produced. */
export function closeLots(
  state: SimState,
  positionId: string,
  lots: number,
  side: 'buy' | 'sell',
  exitFill: number,
  exitTime: string,
  cfg: SimConfig,
  exitReason: ExitReason,
): { state: SimState; closed?: ClosedReplayTrade; event?: string } {
  const position = state.positions.find((p) => p.id === positionId)
  if (!position) return { state, event: 'Position not found.' }

  const lotsToClose = Math.min(roundLots(lots), position.lotSize)
  const { pnlUsd, pnlPips } = tradePnl(
    position.direction, cfg.pair, cfg.market, position.entryPrice, exitFill, lotsToClose,
  )

  const remaining = Math.round((position.lotSize - lotsToClose) * 100) / 100

  if (remaining > 0) {
    // Partial close: realize PnL into balance, shrink the position
    return {
      state: {
        ...state,
        balance: Math.round((state.balance + pnlUsd) * 100) / 100,
        positions: state.positions.map((p) =>
          p.id === positionId
            ? {
                ...p,
                lotSize: remaining,
                partialCloses: [
                  ...p.partialCloses,
                  { lots: lotsToClose, exitPrice: exitFill, exitTime, pnlUsd },
                ],
              }
            : p,
        ),
      },
      event: `Closed ${lotsToClose} lots (+${pnlUsd.toFixed(2)} USD).`,
    }
  }

  // Full close: aggregate PnL including prior partials
  const partialsPnl = position.partialCloses.reduce((sum, pc) => sum + pc.pnlUsd, 0)
  const totalPnl = Math.round((partialsPnl + pnlUsd) * 100) / 100
  const totalPips = pnlPips // pips reported from the final exit leg
  const closed: ClosedReplayTrade = {
    id: newId(),
    direction: position.direction,
    entryPrice: position.entryPrice,
    entryTime: position.entryTime,
    exitPrice: exitFill,
    exitTime,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    lotSize: position.initialLots,
    pnlUsd: totalPnl,
    pnlPips: totalPips,
    exitReason,
    journalTradeId: null,
  }

  return {
    state: {
      ...state,
      balance: Math.round((state.balance + pnlUsd) * 100) / 100,
      positions: state.positions.filter((p) => p.id !== positionId),
      closedTrades: [...state.closedTrades, closed],
    },
    closed,
    event: `Position closed (${exitReason.replace('_', ' ')}): ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} USD.`,
  }
}

// ── Bar processing ────────────────────────────────────────────────────────────

/** Advance one bar: fill pending orders, hit SL/TP (SL before TP — conservative),
 *  update trailing stops, run stop-out, snapshot equity. */
export function processBar(
  state: SimState,
  bar: SimBar,
  cfg: SimConfig,
): StepOutcome {
  const events: string[] = []
  let s: SimState = { ...state, cursorIndex: state.cursorIndex + 1 }
  const ps = pipSize(cfg.pair, cfg.market)

  // 1. Pending order fills
  const remainingOrders: PendingOrder[] = []
  for (const order of s.orders) {
    let filled = false
    if (order.type === 'limit') {
      // Buy limit fills when price dips to/below trigger; sell limit on rise to/above
      filled = order.side === 'buy' ? bar.low <= order.price : bar.high >= order.price
    } else {
      // Stop orders trigger on breakout through the trigger
      filled = order.side === 'buy' ? bar.high >= order.price : bar.low <= order.price
    }

    if (!filled) {
      remainingOrders.push(order)
      continue
    }

    // Fill at trigger price (spread already implicit in where the user placed it)
    const direction = order.side === 'buy' ? 'long' : 'short'
    const equity = s.balance + s.positions.reduce(
      (sum, p) => sum + floatingPnl(p, bar.close, cfg.pair, cfg.market), 0,
    )
    const used = usedMargin(s.positions, cfg.leverage, cfg.market)
    const need = marginFor(order.price, order.lotSize, cfg.leverage, cfg.market)
    if (equity - used < need) {
      events.push('Pending order cancelled: not enough free margin at fill.')
      continue
    }

    s = {
      ...s,
      orders: s.orders.filter((o) => o.id !== order.id),
      positions: [
        ...s.positions,
        {
          id: newId(),
          direction,
          lotSize: order.lotSize,
          initialLots: order.lotSize,
          entryPrice: order.price,
          entryTime: bar.time,
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          trailingStopPips: null,
          breakEvenMoved: false,
          partialCloses: [],
        },
      ],
    }
    events.push(`${order.side === 'buy' ? 'Buy' : 'Sell'} ${order.type} filled at ${order.price}.`)
  }
  s = { ...s, orders: remainingOrders }

  // 2. SL/TP checks — conservative: SL evaluated before TP within the bar
  for (const position of [...s.positions]) {
    const isLong = position.direction === 'long'
    const hitSL =
      position.stopLoss !== null &&
      (isLong ? bar.low <= position.stopLoss : bar.high >= position.stopLoss)
    const hitTP =
      position.takeProfit !== null &&
      (isLong ? bar.high >= position.takeProfit : bar.low <= position.takeProfit)

    if (hitSL) {
      const side = isLong ? 'sell' : 'buy'
      const res = closeLots(s, position.id, position.lotSize, side, position.stopLoss!, bar.time, cfg, 'stop_loss')
      s = res.state
      if (res.closed) events.push(`Stop loss hit: ${res.closed.pnlUsd >= 0 ? '+' : ''}${res.closed.pnlUsd.toFixed(2)} USD.`)
    } else if (hitTP) {
      const side = isLong ? 'sell' : 'buy'
      const res = closeLots(s, position.id, position.lotSize, side, position.takeProfit!, bar.time, cfg, 'take_profit')
      s = res.state
      if (res.closed) events.push(`Take profit hit: +${res.closed.pnlUsd.toFixed(2)} USD.`)
    }
  }

  // 3. Trailing stop update (on bar close)
  s = {
    ...s,
    positions: s.positions.map((p) => {
      if (p.trailingStopPips === null) return p
      const trail = p.trailingStopPips * ps
      if (p.direction === 'long') {
        const candidate = bar.high - trail
        if (p.stopLoss === null || candidate > p.stopLoss) {
          return { ...p, stopLoss: candidate }
        }
      } else {
        const candidate = bar.low + trail
        if (p.stopLoss === null || candidate < p.stopLoss) {
          return { ...p, stopLoss: candidate }
        }
      }
      return p
    }),
  }

  // 4. Stop-out: close everything at bar close fills when equity ≤ 50% of used margin
  const equity = s.balance + s.positions.reduce(
    (sum, p) => sum + floatingPnl(p, bar.close, cfg.pair, cfg.market), 0,
  )
  const used = usedMargin(s.positions, cfg.leverage, cfg.market)
  if (isStopOut(equity, used)) {
    for (const position of [...s.positions]) {
      const side = position.direction === 'long' ? 'sell' : 'buy'
      const exitFill = fillPrice(side, bar.close, cfg.pair, cfg.market, cfg.spreadPips)
      const res = closeLots(s, position.id, position.lotSize, side, exitFill, bar.time, cfg, 'stop_out')
      s = res.state
    }
    events.push('STOP OUT: margin level fell below 50%. All positions closed.')
  }

  // 5. Equity snapshot
  const finalEquity = s.balance + s.positions.reduce(
    (sum, p) => sum + floatingPnl(p, bar.close, cfg.pair, cfg.market), 0,
  )
  const equityPoint: EquityPoint = { time: bar.time, equity: Math.round(finalEquity * 100) / 100, balance: s.balance }

  return { ...s, equityPoint, events }
}
