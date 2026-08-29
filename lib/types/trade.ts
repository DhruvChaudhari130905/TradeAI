export type Market = 'forex' | 'crypto'
export type Direction = 'long' | 'short'
export type Outcome = 'win' | 'loss' | 'breakeven' | 'open'
export type Session = 'london' | 'new_york' | 'asian' | 'overlap' | 'other'

export interface Trade {
  id: string
  user_id: string
  pair: string
  market: Market
  direction: Direction
  entry_price: number
  exit_price?: number | null
  stop_loss?: number | null
  take_profit?: number | null
  lot_size?: number | null
  risk_reward_ratio?: number | null
  outcome?: Outcome | null
  pnl_usd?: number | null
  pnl_pips?: number | null
  entry_time?: string | null
  exit_time?: string | null
  session?: Session | null
  notes?: string | null
  screenshot_urls?: string[] | null
  tags?: string[] | null
  source?: 'live' | 'backtest' | null
  session_id?: string | null
  created_at: string
  updated_at: string
}

export interface TradeWithReview extends Trade {
  review?: {
    composite_score: number | null
  } | null
}

import { z } from 'zod'

// Preprocessor: convert empty strings to undefined
const emptyToUndefined = z.preprocess((v) => v === '' ? undefined : v, z.undefined())
// Preprocessor: coerce to number if not empty, else undefined
const optionalNumber = z.preprocess(
  (v) => v === '' || v === undefined ? undefined : Number(v),
  z.number().positive().optional(),
)
// Preprocessor: coerce to number if not empty, else undefined (allows 0 and negatives)
const optionalNumberAny = z.preprocess(
  (v) => v === '' || v === undefined ? undefined : Number(v),
  z.number().optional(),
)
// Preprocessor: convert empty strings to undefined for string fields
const optionalString = z.preprocess(
  (v) => v === '' ? undefined : v,
  z.string().optional(),
)
// Preprocessor: convert empty strings to undefined for enum fields
function optionalEnum<T extends [string, ...string[]]>(values: T) {
  return z.preprocess(
    (v) => v === '' ? undefined : v,
    z.enum(values).optional(),
  )
}

export const tradeSchema = z.object({
  pair: z.string().min(1, 'Pair is required'),
  market: z.enum(['forex', 'crypto']),
  direction: z.enum(['long', 'short']),
  entry_price: optionalNumber,
  exit_price: optionalNumber,
  stop_loss: optionalNumber,
  take_profit: optionalNumber,
  lot_size: optionalNumber,
  risk_reward_ratio: optionalNumber,
  outcome: optionalEnum(['win', 'loss', 'breakeven', 'open']),
  pnl_usd: optionalNumberAny,
  pnl_pips: optionalNumberAny,
  entry_time: optionalString,
  exit_time: optionalString,
  session: optionalEnum(['london', 'new_york', 'asian', 'overlap', 'other']),
  notes: optionalString,
  tags: optionalString,
  screenshot_urls: z.array(z.string().url()).optional().default([]),
})

// Schema for server actions — tags already parsed to string[]
export const tradeSubmitSchema = tradeSchema.extend({
  tags: z.array(z.string()).optional(),
  entry_price: z.coerce.number().positive('Entry price must be positive'),
})

export type TradeFormData = z.infer<typeof tradeSubmitSchema>

// Major FX pairs + top crypto pairs for dropdowns
export const FOREX_PAIRS = [
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD',
  'NZD/USD', 'USD/CAD', 'EUR/GBP', 'EUR/JPY', 'GBP/JPY',
  'EUR/CHF', 'EUR/AUD', 'GBP/CHF', 'GBP/AUD', 'AUD/JPY',
  'NZD/JPY', 'CAD/JPY', 'CHF/JPY', 'AUD/NZD', 'EUR/NZD',
]

export const CRYPTO_PAIRS = [
  'BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD',
  'DOGE/USD', 'AVAX/USD', 'DOT/USD', 'MATIC/USD', 'LINK/USD',
  'UNI/USD', 'ATOM/USD', 'LTC/USD', 'BCH/USD', 'NEAR/USD',
  'ALGO/USD', 'FIL/USD', 'HBAR/USD', 'FTM/USD', 'AAVE/USD',
]

/** Spot metals via TwelveData — kept separate in the UI, routed as forex math
 *  internally with commodity contract sizes in lib/replay/execution.ts */
export const COMMODITY_PAIRS = ['XAU/USD', 'XAG/USD']

export const ALL_PAIRS = [...FOREX_PAIRS, ...CRYPTO_PAIRS]

export function detectMarket(pair: string): Market {
  return CRYPTO_PAIRS.includes(pair) ? 'crypto' : 'forex'
}
