// ── Enums & Literal Types ────────────────────────────────────────────────────

export type IndicatorType = 'EMA' | 'SMA' | 'RSI' | 'MACD' | 'BBANDS' | 'ATR' | 'STOCH' | 'VWAP' | 'ADX' | 'SWING_POINTS' | 'PREV_DAY_HL'

export type ConditionType =
  | 'indicator_cross_above' | 'indicator_cross_below'
  | 'indicator_above' | 'indicator_below'
  | 'price_above' | 'price_below'
  | 'rsi_oversold' | 'rsi_overbought'
  | 'macd_histogram_positive' | 'macd_histogram_negative'
  | 'bb_lower_touch' | 'bb_upper_touch'
  | 'stoch_oversold' | 'stoch_overbought'
  | 'atr_above' | 'atr_below'
  | 'adx_above' | 'adx_below'
  | 'candle_pattern'

export type ComparisonOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq'

export type SlMethod = 'fixed_pips' | 'atr_based' | 'swing_low_high' | 'indicator'
export type TpMethod = 'fixed_pips' | 'risk_reward' | 'atr_based' | 'indicator'
export type PositionSizingMethod = 'fixed_lot' | 'risk_based' | 'percent_equity'
export type OrderType = 'market' | 'limit' | 'stop'
export type TradeManagementType = 'trailing_stop' | 'break_even' | 'partial_exit' | 'move_sl_to_entry'
export type SessionName = 'london' | 'new_york' | 'asian' | 'overlap'
export type SessionAlignment = 'entry_only' | 'exit_only' | 'both'
export type BacktestStatus = 'extracting' | 'extracted' | 'approved' | 'running' | 'complete' | 'error'

// ── Core Data Types ──────────────────────────────────────────────────────────

export interface Candle {
  time: string   // ISO date string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

// ── Strategy Rule Types ──────────────────────────────────────────────────────

export interface IndicatorConfig {
  type: IndicatorType
  params: Record<string, number>  // e.g. { period: 14 }, { fast: 12, slow: 26, signal: 9 }
}

export interface Condition {
  type: ConditionType
  indicator1?: string  // e.g. "ema_9"
  indicator2?: string  // e.g. "ema_21" (for crossover conditions)
  value?: number       // threshold for RSI/ATR/ADX comparisons
  operator?: ComparisonOperator
  pattern?: string     // for candle_pattern: e.g. "bullish_engulfing", "pin_bar"
}

// ── Expression DSL ────────────────────────────────────────────────────────────
// Conditions are an expression tree so any strategy logic (structure, liquidity,
// multi-bar setups, OR branches, time windows) is expressible without per-family
// enumerated types. The flat `Condition` above is a valid tree leaf — existing
// stored rules (Condition[]) keep working as depth-1 AND-combined trees.

export type PatternName =
  | 'bullish_engulfing' | 'bearish_engulfing'
  | 'pin_bar' | 'doji' | 'hammer'
  | 'fvg_bullish' | 'fvg_bearish'

/** Series names the engine knows how to resolve. Custom names are allowed but
 *  surface as warnings if they can't be resolved. */
export type ReservedSeries =
  | 'close' | 'open' | 'high' | 'low'                      // price
  | `ema_${number}` | `sma_${number}` | `rsi_${number}` | `atr_${number}` | `adx_${number}`
  | 'macd' | 'macd_signal' | 'macd_histogram'
  | 'bbands_upper' | 'bbands_middle' | 'bbands_lower' | 'stoch_k' | 'stoch_d' | 'vwap'
  | 'swing_high' | 'swing_low' | 'prev_swing_high' | 'prev_swing_low'  // auto-computed PA levels
  | 'prev_day_high' | 'prev_day_low' | 'prev_day_open'

export type BinaryOp = '+' | '-' | '*' | '/'

/** Evaluates to a number at a given bar. */
export type ValueExpr =
  | { kind: 'series'; name: string }
  | { kind: 'const'; value: number }
  | { kind: 'binop'; op: BinaryOp; a: ValueExpr; b: ValueExpr }
  | { kind: 'abs'; arg: ValueExpr }

/** Evaluates to boolean at a given bar. */
export type BoolExpr =
  | Condition                                       // legacy flat leaf (back-compat)
  | { kind: 'and'; args: BoolExpr[] }
  | { kind: 'or'; args: BoolExpr[] }
  | { kind: 'not'; arg: BoolExpr }
  | { kind: 'within'; expr: BoolExpr; bars: number }   // held any bar in [i-bars+1, i]
  | { kind: 'strict'; expr: BoolExpr }                  // held on bar i exactly (triggers)
  | { kind: 'prev'; expr: BoolExpr }                    // held on bar i-1
  | { kind: 'cmp'; op: ComparisonOperator; a: ValueExpr; b: ValueExpr }
  | { kind: 'cross_above'; a: ValueExpr; b: ValueExpr }
  | { kind: 'cross_below'; a: ValueExpr; b: ValueExpr }
  | { kind: 'pattern'; name: PatternName | string }
  | { kind: 'liquidity_sweep'; side: 'low' | 'high'; level?: ValueExpr }
  | { kind: 'structure_trend'; mode: 'up' | 'down'; strength?: number }
  | { kind: 'break_structure'; side: 'up' | 'down'; swing?: ValueExpr }

export interface TradeManagementRule {
  type: TradeManagementType
  params: Record<string, number>
  // trailing_stop: { activation_r: 1.0, trail_pct: 0.5 }
  // break_even: { activation_r: 1.0 }
  // partial_exit: { r_multiple: 2.0, close_pct: 50 }
  // move_sl_to_entry: { activation_r: 1.0 }
}

export interface SessionFilter {
  sessions: SessionName[]
  alignment: SessionAlignment
}

export interface StopLossConfig {
  method: SlMethod
  value?: number         // for fixed_pips
  atr_multiplier?: number // for atr_based
}

export interface TakeProfitConfig {
  method: TpMethod
  value?: number           // for fixed_pips
  rr_ratio?: number        // for risk_reward
  atr_multiplier?: number  // for atr_based
}

export interface PositionSizingConfig {
  method: PositionSizingMethod
  value?: number  // fixed_lot: lot size, percent_equity: percentage
}

export interface StrategyRuleSet {
  name: string
  indicators: IndicatorConfig[]
  // Each group is an array of expression trees AND-combined. A flat `Condition`
  // is a valid `BoolExpr` leaf, so existing stored rules keep working unchanged.
  entry_long: BoolExpr[]
  entry_short: BoolExpr[]
  exit_long: BoolExpr[]
  exit_short: BoolExpr[]
  stop_loss: StopLossConfig
  take_profit: TakeProfitConfig
  risk_per_trade_pct: number
  position_sizing: PositionSizingConfig
  session_filter: SessionFilter | null
  invalidation: BoolExpr[]
  trade_management: TradeManagementRule[]
  order_type: OrderType
  timeframe: string
  notes: string
}

// ── Execution Config ─────────────────────────────────────────────────────────

export interface ExecutionConfig {
  spread_pips: number           // default: 1.0 (forex), 5.0 (crypto)
  slippage_pips: number         // default: 0.5
  commission_per_lot: number    // default: 7.0 round turn
  swap_long_per_day: number     // default: 0
  swap_short_per_day: number    // default: 0
  leverage: number              // default: 100
}

// ── Trade Types ──────────────────────────────────────────────────────────────

export interface Position {
  isOpen: boolean
  direction: 'long' | 'short' | null
  entryPrice: number | null
  entryTime: string | null
  stopLoss: number | null
  takeProfit: number | null
  lotSize: number
  initialRisk: number       // equity × risk_pct at entry
  partialExits: { r_multiple: number; close_pct: number; pnl: number }[]
}

export interface PartialExit {
  r_multiple: number
  close_pct: number
  pnl: number
}

export interface CompletedTrade {
  direction: 'long' | 'short'
  entryPrice: number
  entryTime: string
  exitPrice: number
  exitTime: string
  stopLoss: number | null
  takeProfit: number | null
  pnlUsd: number
  pnlPips: number
  exitReason: string
  // execution details
  lotSize: number
  commission: number
  swap: number
  slippage_cost: number
  initial_risk: number
  r_multiple: number
  entryType: OrderType
  partial_exits: PartialExit[]
}

// ── Backtest Result Types ────────────────────────────────────────────────────

export interface EquityPoint {
  time: string
  equity: number
}

export interface MonthlyReturn {
  month: string    // e.g. "2024-01"
  pnl: number
  pct: number
}

export interface DrawdownPoint {
  time: string
  drawdown_pct: number
}

export interface TradeDistributionBucket {
  range: string   // e.g. "$0 - $50", "-$50 - $0"
  count: number
}

export interface BacktestResult {
  // core stats
  total_trades: number
  winning_trades: number
  losing_trades: number
  win_rate: number
  total_pnl_usd: number
  total_pnl_pct: number
  max_drawdown_pct: number
  avg_rr: number
  profit_factor: number
  expectancy: number
  // curves
  equity_curve: EquityPoint[]
  balance_curve: EquityPoint[]
  // extended metrics
  monthly_returns: MonthlyReturn[]
  drawdown_curve: DrawdownPoint[]
  trade_distribution: TradeDistributionBucket[]
  win_loss_ratio: string
  max_consecutive_wins: number
  max_consecutive_losses: number
  avg_r_multiple: number
  sharpe_ratio: number | null
  margin_used_pct: number
  total_commission: number
  total_swap: number
  total_slippage_cost: number
  // trade log
  trade_log: CompletedTrade[]
  // non-fatal issues that affected the run, e.g. a condition referenced an
  // unknown series and was dropped, or a structural concept had no data. When
  // present (often with 0 trades), this is the "why" instead of a silent blank.
  warnings?: string[]
}

// ── Backtest Run (DB row shape) ─────────────────────────────────────────────

export interface BacktestRun {
  id: string
  user_id: string
  strategy_name: string | null
  strategy_doc_url: string | null
  market: 'forex' | 'crypto'
  pair: string
  timeframe: string
  date_from: string | null
  date_to: string | null
  starting_capital: number
  status: BacktestStatus
  result: BacktestResult | null
  ai_report: string | null
  extracted_rules: StrategyRuleSet | null
  approved_rules: StrategyRuleSet | null
  execution_config: ExecutionConfig | null
  personality_reviews: BacktestPersonalityReview[] | null
  created_at: string
}

// ── AI Personality Review Types ─────────────────────────────────────────────

export interface BacktestPersonalityReview {
  personality: string       // e.g. "Prop Firm Evaluator"
  rule_quality: number      // 1-10
  risk_management: number   // 1-10
  strategy_consistency: number // 1-10
  robustness: number        // 1-10
  overall: number           // 1-10
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  verdict: string
  strengths: string[]
  weaknesses: string[]
  improvements: string[]
  prop_firm_suitable: boolean
}

// ── Backtest State (internal engine use) ─────────────────────────────────────

export interface BacktestState {
  equity: number
  trades: CompletedTrade[]
  position: Position
  equityCurve: EquityPoint[]
  balanceCurve: EquityPoint[]
}

// ── Timeframe Options ────────────────────────────────────────────────────────

export const BACKTEST_TIMEFRAMES = [
  '1m', '5m', '15m', '30m', '1H', '4H', '1D', '1W', '1M',
] as const
export type BacktestTimeframe = (typeof BACKTEST_TIMEFRAMES)[number]

/** Map our timeframe labels to Twelve Data interval strings */
export const TF_TO_TWELVE_DATA: Record<BacktestTimeframe, string> = {
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

// ── Legacy types kept for backward compatibility with existing journal reviews ──

export interface StrategyRules {
  name: string
  entry_conditions: string[]
  exit_conditions: string[]
  stop_loss_method: string
  take_profit_method: string
  timeframe: string
  risk_per_trade_pct: number
  notes: string
}
