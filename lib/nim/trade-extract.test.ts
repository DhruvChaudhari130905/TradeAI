import { describe, it, expect } from 'vitest'
import {
  normalizeExtraction,
  normalizePairString,
  sessionFromTime,
  isRawTradeExtraction,
  type RawTradeExtraction,
} from './trade-extract-types'

describe('normalizePairString', () => {
  it('normalizes common MT4/MT5 spellings', () => {
    expect(normalizePairString('XAUUSD')).toBe('XAU/USD')
    expect(normalizePairString('XAU/USD')).toBe('XAU/USD')
    expect(normalizePairString('xauusd')).toBe('XAU/USD')
    expect(normalizePairString('EURUSD')).toBe('EUR/USD')
    expect(normalizePairString('EUR/USD')).toBe('EUR/USD')
  })

  it('returns null for unparseable input', () => {
    expect(normalizePairString('garbage string')).toBeNull()
    expect(normalizePairString('')).toBeNull()
  })
})

describe('sessionFromTime', () => {
  it('maps UTC hours to sessions', () => {
    expect(sessionFromTime('2026-08-28T10:00:00Z')).toBe('london')
    expect(sessionFromTime('2026-08-28T15:00:00Z')).toBe('new_york')
    expect(sessionFromTime('2026-08-28T23:00:00Z')).toBe('asian')
    expect(sessionFromTime('2026-08-28T06:00:00Z')).toBe('overlap')
  })

  it('returns null for invalid dates', () => {
    expect(sessionFromTime('not-a-date')).toBeNull()
  })
})

describe('isRawTradeExtraction', () => {
  it('accepts payloads with at least one value', () => {
    expect(isRawTradeExtraction({ pair: 'XAUUSD' })).toBe(true)
    expect(isRawTradeExtraction({ entry_price: 4050.5 })).toBe(true)
  })

  it('rejects empty or non-object payloads', () => {
    expect(isRawTradeExtraction({})).toBe(false)
    expect(isRawTradeExtraction(null)).toBe(false)
    expect(isRawTradeExtraction('x')).toBe(false)
  })
})

describe('normalizeExtraction', () => {
  it('derives market from pair and normalizes non-standard pair spelling', () => {
    const r = normalizeExtraction({ pair: 'XAUUSD', direction: 'long', entry_price: 4050 })
    expect(r.fields.market?.value).toBe('forex')
    expect(r.fields.pair?.value).toBe('XAU/USD')
    expect(r.fields.pair?.confidence).toBe('guessed')
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('keeps exact pairs as extracted only when model marks high', () => {
    const r = normalizeExtraction({ pair: 'EUR/USD', entry_price: 1.0852, confidence: { pair: 'high' } })
    expect(r.fields.pair?.confidence).toBe('extracted')
    expect(r.fields.market?.value).toBe('forex')
  })

  it('flags fields as guessed when model marks low confidence', () => {
    const r = normalizeExtraction({
      pair: 'EUR/USD',
      entry_price: 1.0852,
      confidence: { pair: 'high', entry_price: 'low' },
    })
    expect(r.fields.entry_price?.confidence).toBe('guessed')
    expect(r.fields.pair?.confidence).toBe('extracted')
  })

  it('marks unlisted fields as guessed (strict: only model-high is verified)', () => {
    const r = normalizeExtraction({
      pair: 'EUR/USD',
      entry_price: 1.0852,
      risk_reward_ratio: 2.24,
      confidence: { pair: 'high', entry_price: 'high' },
    })
    expect(r.fields.entry_price?.confidence).toBe('extracted')
    expect(r.fields.risk_reward_ratio?.confidence).toBe('guessed')
  })

  it('rejects bare clock times as missing entry/exit times', () => {
    const r = normalizeExtraction({ pair: 'EUR/USD', entry_time: '01:33' })
    expect(r.fields.entry_time?.value).toBeNull()
  })

  it('derives a guessed session from entry timestamp when absent', () => {
    const r = normalizeExtraction({
      pair: 'EUR/USD',
      entry_time: '2026-08-28T15:00:00Z',
    })
    expect(r.fields.session?.value).toBe('new_york')
    expect(r.fields.session?.confidence).toBe('guessed')
  })

  it('seeds draft tags from direction when no structured tags', () => {
    const r = normalizeExtraction({ pair: 'EUR/USD', direction: 'long' })
    expect(r.fields.tags?.value).toEqual(['long'])
    expect(r.fields.tags?.confidence).toBe('guessed')
  })

  it('keeps provided tags', () => {
    const r = normalizeExtraction({ pair: 'EUR/USD', tags: ['breakout', 'news'] })
    expect(r.fields.tags?.value).toEqual(['breakout', 'news'])
  })

  it('classifies the real XAU/USD screenshot extraction correctly', () => {
    // Actual output of the NIM omni model on the user's test chart image.
    const raw: RawTradeExtraction = {
      pair: 'XAUUSD',
      direction: 'long',
      entry_price: 4483.125,
      stop_loss: 4450.539,
      take_profit: 4497.684,
      lot_size: null,
      risk_reward_ratio: 2.24,
      outcome: 'open',
      pnl_usd: null,
      session: 'other',
      entry_time: '01:33',
      exit_time: null,
      notes: 'price near 4,483 level with green zone',
      tags: ['breakout'],
      confidence: {
        pair: 'high',
        entry_price: 'high',
        stop_loss: 'high',
        take_profit: 'high',
        direction: 'high',
      },
    }
    const r = normalizeExtraction(raw)
    const f = r.fields
    // Model-verified values are blue (extracted), pair normalized -> amber.
    expect(f.entry_price?.value).toBe(4483.125)
    expect(f.entry_price?.confidence).toBe('extracted')
    expect(f.stop_loss?.confidence).toBe('extracted')
    expect(f.take_profit?.confidence).toBe('extracted')
    expect(f.direction?.confidence).toBe('extracted')
    expect(f.pair?.value).toBe('XAU/USD')
    expect(f.pair?.confidence).toBe('guessed')
    // Computed/unverified fields are amber (guessed).
    expect(f.risk_reward_ratio?.value).toBe(2.24)
    expect(f.risk_reward_ratio?.confidence).toBe('guessed')
    expect(f.outcome?.confidence).toBe('guessed')
    // Bare clock time must be rejected as missing.
    expect(f.entry_time?.value).toBeNull()
    expect(f.entry_time?.confidence).toBe('missing')
    // Model tags preserved (draft).
    expect(f.tags?.value).toEqual(['breakout'])
    // market derived from pair.
    expect(f.market?.value).toBe('forex')
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})
