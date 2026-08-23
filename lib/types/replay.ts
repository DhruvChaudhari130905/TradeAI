// ── Timeframes & Candles (moved from lib/types/backtest.ts) ─────────────────

export const TIMEFRAMES = [
  '1m', '5m', '15m', '30m', '1H', '4H', '1D', '1W', '1M',
] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

/** Map our timeframe labels to Twelve Data interval strings */
export const TF_TO_TWELVE_DATA: Record<Timeframe, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '1H': '1h',
  '4H': '4h',
  '1D': '1day',
  '1W': '1week',
  '1M': '1month',
}

/** Duration of one bar in seconds — used for higher-TF future-leak filtering */
export const TF_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1H': 3600,
  '4H': 14400,
  '1D': 86400,
  '1W': 604800,
  '1M': 2592000,
}

export interface Candle {
  time: string   // ISO date string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

// ── Replay Session (DB row shape) ────────────────────────────────────────────

export type ReplaySessionStatus = 'active' | 'complete' | 'abandoned'

export interface ReplaySessionRow {
  id: string
  user_id: string
  pair: string
  market: 'forex' | 'crypto'
  timeframes: Timeframe[]
  date_from: string
  date_to: string
  starting_balance: number
  leverage: number
  spread_pips: number
  status: ReplaySessionStatus
  cursor_index: number
  balance: number
  positions: ReplayPosition[]
  orders: PendingOrder[]
  drawings: DrawingShape[]
  indicator_configs: ReplayIndicatorConfig[]
  closed_trades: ClosedReplayTrade[]
  equity_curve: EquityPoint[]
  chat_messages: ChatMessage[]
  personality_reviews: PersonalityReviewSet | null
  /** Cached OHLCV per timeframe — written once after first fetch, null until then */
  candles: Record<string, Candle[]> | null
  created_at: string
  updated_at: string
}

// ── Trading State ─────────────────────────────────────────────────────────────

export interface PartialCloseRecord {
  lots: number
  exitPrice: number
  exitTime: string
  pnlUsd: number
}

export interface ReplayPosition {
  id: string
  direction: 'long' | 'short'
  lotSize: number            // remaining lots (reduced by partial closes)
  initialLots: number
  entryPrice: number         // spread-applied fill price
  entryTime: string          // candle time of fill
  stopLoss: number | null
  takeProfit: number | null
  trailingStopPips: number | null
  breakEvenMoved: boolean
  partialCloses: PartialCloseRecord[]
}

export interface PendingOrder {
  id: string
  type: 'limit' | 'stop'
  side: 'buy' | 'sell'
  price: number              // trigger price
  lotSize: number
  stopLoss: number | null
  takeProfit: number | null
  createdAt: string
}

export type ExitReason = 'manual' | 'stop_loss' | 'take_profit' | 'stop_out' | 'session_end' | 'trailing_stop'

export interface ClosedReplayTrade {
  id: string
  direction: 'long' | 'short'
  entryPrice: number
  entryTime: string
  exitPrice: number
  exitTime: string
  stopLoss: number | null
  takeProfit: number | null
  lotSize: number            // total lots at entry
  pnlUsd: number             // net, including partial closes
  pnlPips: number
  exitReason: ExitReason
  journalTradeId: string | null
}

// ── Drawings ──────────────────────────────────────────────────────────────────

export type DrawingKind = 'hline' | 'vline' | 'trendline' | 'rect' | 'fib' | 'text' | 'measure'

export interface DrawingPoint {
  time: string   // ISO date string of the anchor candle
  price: number
}

export interface DrawingShape {
  id: string
  kind: DrawingKind
  points: DrawingPoint[]     // 1 for hline/vline/text, 2 for the rest
  color?: string
  label?: string             // text tool content; measure caches its readout
}

// ── Indicators (chart overlays) ───────────────────────────────────────────────

export type OverlayIndicatorType = 'EMA' | 'SMA' | 'BBANDS' | 'RSI' | 'MACD'

export interface ReplayIndicatorConfig {
  id: string
  type: OverlayIndicatorType
  visible: boolean
  params: Record<string, number>  // { period }, { fast, slow, signal }, { period, std_dev }
}

// ── AI Chat ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

// ── Equity curve ──────────────────────────────────────────────────────────────

export interface EquityPoint {
  time: string
  equity: number
  balance: number
}

// ── Personality review set (backtest-specific dimensions) ────────────────────

export interface ReplayPersonalityReview {
  rule_quality: number
  risk_management: number
  strategy_consistency: number
  robustness: number
  overall: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  verdict: string
  strengths: string[]
  weaknesses: string[]
  improvements: string[]
  prop_firm_suitable: boolean
}

export interface PersonalityReviewSet {
  prop_firm_evaluator: ReplayPersonalityReview | null
  trading_psychologist: ReplayPersonalityReview | null
  institutional_trader: ReplayPersonalityReview | null
  quantitative_analyst: ReplayPersonalityReview | null
  risk_manager: ReplayPersonalityReview | null
  composite_score: number | null
}
