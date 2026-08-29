import { describe, expect, it } from 'vitest'
import {
  closeLots,
  openMarketPosition,
  placeOrder,
  processBar,
  type SimBar,
  type SimConfig,
  type SimState,
} from './simulation'

// Deterministic id factory: ids come out as id-1, id-2, … in call order
const cfg: SimConfig = {
  pair: 'EUR/USD',
  market: 'forex',
  leverage: 100,
  spreadPips: 2,
  makeId: (() => {
    let n = 0
    return (salt: string) => `id-${++n}-${salt}`
  })(),
}

const bar = (time: string, o: number, h: number, l: number, c: number): SimBar => ({ time, open: o, high: h, low: l, close: c })

const empty: SimState = { cursorIndex: 0, balance: 10000, positions: [], orders: [], closedTrades: [] }

describe('openMarketPosition', () => {
  it('fills a buy at ask and uses injected ids', () => {
    const { state } = openMarketPosition(empty, 'buy', 1, bar('t1', 1.1, 1.1, 1.1, 1.1), cfg, 1.095, 1.11)
    expect(state.positions).toHaveLength(1)
    expect(state.positions[0].entryPrice).toBeCloseTo(1.1001, 10)
    expect(state.positions[0].id).toMatch(/^id-1-/)
  })
  it('rejects when free margin is insufficient', () => {
    const broke: SimState = { ...empty, balance: 0 }
    const res = openMarketPosition(broke, 'buy', 10, bar('t1', 1.1, 1.1, 1.1, 1.1), cfg, null, null)
    expect(res.event).toMatch(/not enough free margin/)
    expect(res.state.positions).toHaveLength(0)
  })
})

describe('placeOrder', () => {
  it('stores a pending order with an injected id and bar time', () => {
    const order = { side: 'buy' as const, type: 'limit' as const, price: 1.05, lotSize: 1, stopLoss: null, takeProfit: null }
    const s = placeOrder(empty, order, bar('t1', 1.1, 1.1, 1.1, 1.1), cfg)
    expect(s.orders[0].id).toMatch(/^id-\d+-ord:t1$/)
    expect(s.orders[0].createdAt).toBe('t1')
  })
})

describe('closeLots', () => {
  it('partial close shrinks the position and books PnL, no trade record', () => {
    const opened = openMarketPosition(empty, 'buy', 1, bar('t1', 1.1, 1.1, 1.1, 1.1), cfg, null, null)
    const res = closeLots(opened.state, opened.state.positions[0].id, 0.5, 'sell', 1.105, 't2', cfg, 'manual')
    expect(res.closed).toBeUndefined()
    expect(res.state.balance).toBe(10000 + 245) // 49 pips × 0.5 lot (entry filled at ask)
    expect(res.state.positions[0].lotSize).toBe(0.5)
  })
  it('full close produces a ClosedReplayTrade with aggregated PnL', () => {
    const opened = openMarketPosition(empty, 'buy', 1, bar('t1', 1.1, 1.1, 1.1, 1.1), cfg, null, null)
    const res = closeLots(opened.state, opened.state.positions[0].id, 1, 'sell', 1.105, 't2', cfg, 'take_profit')
    expect(res.closed?.pnlUsd).toBe(490)
    expect(res.closed?.exitReason).toBe('take_profit')
    expect(res.state.balance).toBe(10490)
  })
})

describe('processBar', () => {
  it('hits SL before TP within the same bar (conservative)', () => {
    const opened = openMarketPosition(empty, 'buy', 1, bar('t0', 1.1, 1.1, 1.1, 1.1), cfg, 1.095, 1.12)
    const res = processBar(opened.state, bar('t1', 1.1, 1.12, 1.0949, 1.11), cfg)
    expect(res.events.join(' ')).toMatch(/Stop loss hit/)
    expect(res.positions).toHaveLength(0)
  })
  it('hits TP and books the win', () => {
    const opened = openMarketPosition(empty, 'buy', 1, bar('t0', 1.1, 1.1, 1.1, 1.1), cfg, 1.095, 1.11)
    const res = processBar(opened.state, bar('t1', 1.1, 1.111, 1.0999, 1.105), cfg)
    expect(res.events.join(' ')).toMatch(/Take profit hit: \+990\.00/)
    expect(res.balance).toBe(10990)
  })
  it('rewind re-simulation is deterministic with injected ids', () => {
    const mk = () => ({ ...cfg, makeId: (() => { let n = 0; return (salt: string) => `id-${++n}-${salt}` })() })
    const a = openMarketPosition(empty, 'buy', 1, bar('t0', 1.1, 1.1, 1.1, 1.1), mk(), 1.095, 1.11)
    const b = openMarketPosition(empty, 'buy', 1, bar('t0', 1.1, 1.1, 1.1, 1.1), mk(), 1.095, 1.11)
    const ra = processBar(a.state, bar('t1', 1.1, 1.111, 1.0999, 1.105), mk())
    const rb = processBar(b.state, bar('t1', 1.1, 1.111, 1.0999, 1.105), mk())
    expect(JSON.stringify({ ...ra, equityPoint: ra.equityPoint })).toBe(JSON.stringify({ ...rb, equityPoint: rb.equityPoint }))
  })
  it('stop-out closes everything at 50% margin level', () => {
    const levered = { ...cfg, leverage: 500 }
    const poor: SimState = { ...empty, balance: 300 }
    const opened = openMarketPosition(poor, 'buy', 1, bar('t0', 1.1, 1.1, 1.1, 1.1), levered, null, null)
    // price collapse → equity ≤ 50% of used margin (≈1100)
    const res = processBar(opened.state, bar('t1', 1.1, 1.1, 1.04, 1.04), levered)
    expect(res.events.join(' ')).toMatch(/STOP OUT/)
    expect(res.positions).toHaveLength(0)
  })
})
