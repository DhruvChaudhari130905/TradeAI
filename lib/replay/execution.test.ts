import { describe, expect, it } from 'vitest'
import {
  fillPrice,
  floatingPnl,
  formatPrice,
  isStopOut,
  marginFor,
  pipSize,
  priceDigits,
  roundLots,
  tradePnl,
  usedMargin,
} from './execution'

const FX = { pair: 'EUR/USD', market: 'forex' as const }
const JPY = { pair: 'USD/JPY', market: 'forex' as const }
const CRYPTO = { pair: 'BTC/USD', market: 'crypto' as const }
const GOLD = { pair: 'XAU/USD', market: 'forex' as const }
const SILVER = { pair: 'XAG/USD', market: 'forex' as const }

describe('pipSize', () => {
  it('is 0.0001 for FX, 0.01 for JPY, 1 for crypto', () => {
    expect(pipSize(FX.pair, FX.market)).toBe(0.0001)
    expect(pipSize(JPY.pair, JPY.market)).toBe(0.01)
    expect(pipSize(CRYPTO.pair, CRYPTO.market)).toBe(1)
  })
  it('uses commodity tick sizes: 0.01 gold, 0.001 silver', () => {
    expect(pipSize(GOLD.pair, GOLD.market)).toBe(0.01)
    expect(pipSize(SILVER.pair, SILVER.market)).toBe(0.001)
  })
})

describe('fillPrice', () => {
  it('buys at ask, sells at bid (spread 2 pips)', () => {
    // 2 pips × 0.0001 = 0.0002 spread; half per side
    expect(fillPrice('buy', 1.1, FX.pair, FX.market, 2)).toBeCloseTo(1.1001, 10)
    expect(fillPrice('sell', 1.1, FX.pair, FX.market, 2)).toBeCloseTo(1.0999, 10)
  })
})

describe('tradePnl', () => {
  it('pays $10/pip per standard lot for EUR/USD', () => {
    const r = tradePnl('long', FX.pair, FX.market, 1.1, 1.105, 1) // 50 pips
    expect(r.pnlUsd).toBe(500)
    expect(r.pnlPips).toBe(50)
  })
  it('short loses when price rises', () => {
    const r = tradePnl('short', FX.pair, FX.market, 1.1, 1.101, 0.1) // 10 pips × 0.1 lot
    expect(r.pnlUsd).toBe(-10)
  })
  it('converts JPY quote PnL to USD at pair rate', () => {
    // entry 150, 10 pips, 1 lot: raw JPY/pip = 0.01×100k = 1000 → 10 pips = 10k JPY → /150 ≈ $66.67
    const r = tradePnl('long', JPY.pair, JPY.market, 150, 150.1, 1)
    expect(r.pnlPips).toBe(10)
    expect(r.pnlUsd).toBeCloseTo(10 * 1000 / 150, 1)
  })
  it('crypto PnL is (exit − entry) × lots', () => {
    expect(tradePnl('long', CRYPTO.pair, CRYPTO.market, 50000, 51000, 0.5).pnlUsd).toBe(500)
  })
  it('gold: 1 lot × 100oz, $1 per 0.01 tick → $100 per $1 move', () => {
    // entry 4000 → 4001 is 100 ticks of 0.01 × $1/contract-lot... entry→exit 4001
    const r = tradePnl('long', GOLD.pair, GOLD.market, 4000, 4001, 1)
    // diff 1 / pip 0.01 = 100 pips; pipValue = 0.01×100 = $1 → pnl $100
    expect(r.pnlUsd).toBe(100)
    expect(r.pnlPips).toBe(100)
  })
  it('silver: pip 0.001 × 5000oz → $5 per pip', () => {
    const r = tradePnl('long', SILVER.pair, SILVER.market, 30, 30.5, 1) // 500 pips
    expect(r.pnlPips).toBe(500)
    expect(r.pnlUsd).toBe(2500)
  })
})

describe('floatingPnl', () => {
  it('marks long at mid above entry', () => {
    expect(floatingPnl({ direction: 'long', entryPrice: 1.1, lotSize: 1 }, 1.1002, FX.pair, FX.market)).toBeCloseTo(20, 6)
  })
})

describe('margin', () => {
  it('is notional / leverage (FX 100k contract)', () => {
    expect(marginFor(1.1, 1, 100, FX.market)).toBeCloseTo(1100, 6)
    expect(marginFor(50000, 2, 10, CRYPTO.market)).toBe(10000)
  })
  it('usedMargin sums positions', () => {
    const positions = [
      { entryPrice: 1.1, lotSize: 1 },
      { entryPrice: 1.2, lotSize: 1 },
    ] as Array<Parameters<typeof usedMargin>[0][number]>
    expect(usedMargin(positions, 100, FX.market, FX.pair)).toBeCloseTo(2300, 6)
  })
  it('usedMargin uses commodity contract sizes for metals', () => {
    const gold = [ { entryPrice: 4000, lotSize: 1 } ] as Array<Parameters<typeof usedMargin>[0][number]>
    // gold contract 100oz → margin = 1×100×4000/100 = 4000
    expect(usedMargin(gold, 100, 'forex', 'XAU/USD')).toBeCloseTo(4000, 6)
  })
  it('stop-out triggers at ≤50% margin level', () => {
    expect(isStopOut(500, 1000)).toBe(true)
    expect(isStopOut(501, 1000)).toBe(false)
    expect(isStopOut(100, 0)).toBe(false) // no margin used → never
  })
})

describe('lots & formatting', () => {
  it('rounds lots and floors at 0.01', () => {
    expect(roundLots(0.12345)).toBe(0.12)
    expect(roundLots(0)).toBe(0.01)
  })
  it('priceDigits follows instrument convention', () => {
    expect(priceDigits(FX.pair, FX.market)).toBe(5)
    expect(priceDigits(JPY.pair, JPY.market)).toBe(3)
    expect(priceDigits(CRYPTO.pair, CRYPTO.market)).toBe(2)
    expect(priceDigits(GOLD.pair, GOLD.market)).toBe(2)
    expect(priceDigits(SILVER.pair, SILVER.market)).toBe(3)
  })
  it('formatPrice pads to the instrument precision', () => {
    expect(formatPrice(1.1, FX.pair, FX.market)).toBe('1.10000')
    expect(formatPrice(150.1, JPY.pair, JPY.market)).toBe('150.100')
    expect(formatPrice(50000, CRYPTO.pair, CRYPTO.market)).toBe('50000.00')
  })
})
