import type {
  Candle,
  StrategyRuleSet,
  ExecutionConfig,
  BacktestResult,
  Position,
  CompletedTrade,
  EquityPoint,
  BoolExpr,
} from '@/lib/types/backtest'
import { isInSession } from './rule-engine'
import { buildEvalContext, evaluateBool, normalizeGroup, EvalContext, describeExpr } from './expr-engine'
import { calculateEntryCosts, calculateLotSize, calculateStopLoss, calculateTakeProfit, canOpenPosition, SlTpParams } from './execution-simulator'
import { checkSLTPHit, closePosition, applyTradeManagement } from './trade-manager'
import { computePerformance } from './performance-calculator'

const EMPTY_POSITION: Position = {
  isOpen: false,
  direction: null,
  entryPrice: null,
  entryTime: null,
  stopLoss: null,
  takeProfit: null,
  lotSize: 0,
  initialRisk: 0,
  partialExits: [],
}

/**
 * Run the deterministic backtest engine.
 *
 * Process: compute indicators → bar-by-bar evaluation → track positions → compute metrics.
 * 100% deterministic: same candles + same rules = identical result every run.
 */
export async function runBacktestEngine(params: {
  candles: Candle[]
  rules: StrategyRuleSet
  executionConfig: ExecutionConfig
  startingCapital: number
  pair: string
  /** Actual timeframe the candles were fetched on. Used for session filtering,
   *  since time-of-day sessions are only meaningful relative to the real candle
   *  timeframe (and a no-op for daily+). Falls back to rules.timeframe if omitted. */
  timeframe?: string
}): Promise<BacktestResult> {
  const { candles, rules, executionConfig, startingCapital, pair, timeframe } = params

  // Sessions are a time-of-day filter, so they apply relative to the timeframe the
  // candles were actually fetched on (daily+ candles have no meaningful session).
  // rules.timeframe is the strategy doc's *preferred* timeframe and may not match
  // the timeframe the user chose to backtest on — using it here would wrongly apply
  // an intraday session filter to daily candles and silently zero out all entries.
  const sessionTimeframe = timeframe ?? rules.timeframe

  // 1. Compute all indicators + auto-compute price-action levels on demand and
  //    build the expression-eval context. `indicators` (a view of ctx.indicators)
  //    includes the numeric indicators plus the level/price series merged in by
  //    buildEvalContext, so resolveIndicator and the legacy evaluators find them.
  const { ctx, warnings } = buildEvalContext(candles, rules)
  const indicators = ctx.indicators

  // 2. Determine lookback: find the max period from indicators
  const lookback = computeLookback(rules)

  // 3. Validate lookback vs available candles
  if (lookback >= candles.length) {
    const msg = `Not enough candles for indicator lookback. Indicators need ${lookback} bars but only ${candles.length} candles available. Extend the date range or remove indicators with long periods (e.g. MACD, ADX).`
    console.error('[engine] lookback exceeds candles:', msg)
    throw new Error(msg)
  }

  // 4. Initialize state
  let equity = startingCapital
  let balance = startingCapital
  let position: Position = { ...EMPTY_POSITION, isOpen: false }
  const trades: CompletedTrade[] = []
  const equityCurve: EquityPoint[] = []
  const balanceCurve: EquityPoint[] = []

  // 5. Get ATR for SL/TP — resolve from any configured ATR indicator
  let atrValues: number[] | null = null
  for (const indConfig of rules.indicators) {
    if (indConfig.type === 'ATR') {
      const period = indConfig.params.period ?? 14
      const key = `atr_${period}`
      const series = indicators.get(key) as number[] | undefined
      if (series) {
        atrValues = series
        break
      }
    }
  }
  // Fallback: try generic "atr_14"
  if (!atrValues) {
    atrValues = (indicators.get('atr_14') as number[] | undefined) ?? null
  }

  console.log('[engine] Starting bar-by-bar simulation:', {
    candles: candles.length,
    lookback,
    indicators: rules.indicators.map((c) => `${c.type}_${Object.values(c.params).join('_')}`),
    entryLong: rules.entry_long.length,
    entryShort: rules.entry_short.length,
    exitLong: rules.exit_long.length,
    exitShort: rules.exit_short.length,
    invalidation: rules.invalidation.length,
    hasAtr: atrValues !== null,
    slMethod: rules.stop_loss.method,
    tpMethod: rules.take_profit.method,
  })

  // 6. Bar-by-bar simulation
  for (let i = lookback; i < candles.length; i++) {
    const candle = candles[i]

    // Record equity at this bar (before any action)
    equityCurve.push({ time: candle.time, equity })
    balanceCurve.push({ time: candle.time, equity: balance })

    // a. Session filter
    if (rules.session_filter?.sessions?.length) {
      if (!isInSession(candle, rules.session_filter.sessions, sessionTimeframe)) {
        // Still check SL/TP for open positions even outside session
        if (position.isOpen) {
          const hit = checkSLTPHit(position, candle)
          if (hit) {
            const trade = closePosition(position, hit.price, hit.reason, candle.time, executionConfig, pair)
            trades.push(trade)
            equity += trade.pnlUsd
            balance += trade.pnlUsd + (trade.partial_exits.reduce((s, p) => s + p.pnl, 0))
            position = { ...EMPTY_POSITION }
          }
        }
        continue
      }
    }

    // b. If position is open: check SL/TP, apply management, evaluate exit conditions
    if (position.isOpen) {
      // Check SL/TP hit first
      const hit = checkSLTPHit(position, candle)
      if (hit) {
        const trade = closePosition(position, hit.price, hit.reason, candle.time, executionConfig, pair)
        trades.push(trade)
        equity += trade.pnlUsd
        balance += trade.pnlUsd
        position = { ...EMPTY_POSITION }
        continue
      }

      // Apply trade management rules
      const mgmt = applyTradeManagement(position, candle, rules.trade_management, indicators, i, executionConfig)

      if (mgmt.partialClose) {
        equity += mgmt.partialClose.pnl
        balance += mgmt.partialClose.pnl
      }

      // Check SL/TP again after management moved SL
      const hitAfterMgmt = checkSLTPHit(position, candle)
      if (hitAfterMgmt) {
        const trade = closePosition(position, hitAfterMgmt.price, hitAfterMgmt.reason, candle.time, executionConfig, pair)
        trades.push(trade)
        equity += trade.pnlUsd
        balance += trade.pnlUsd
        position = { ...EMPTY_POSITION }
        continue
      }

      // Evaluate exit conditions (strict — no entry setup-lookback on exits)
      const exitConditions = position.direction === 'long' ? rules.exit_long : rules.exit_short
      if (exitConditions.length > 0 && evaluateBool(normalizeGroup(exitConditions), i, { ...ctx, entryMode: false })) {
        const trade = closePosition(position, candle.close, 'Strategy exit condition', candle.time, executionConfig, pair)
        trades.push(trade)
        equity += trade.pnlUsd
        balance += trade.pnlUsd
        position = { ...EMPTY_POSITION }
        continue
      }

      // Check invalidation conditions (strict)
      if (rules.invalidation.length > 0 && evaluateBool(normalizeGroup(rules.invalidation), i, { ...ctx, entryMode: false })) {
        const trade = closePosition(position, candle.close, 'Invalidation condition met', candle.time, executionConfig, pair)
        trades.push(trade)
        equity += trade.pnlUsd
        balance += trade.pnlUsd
        position = { ...EMPTY_POSITION }
        continue
      }
    }

    // c. If no position: evaluate entry conditions
    if (!position.isOpen) {
      const atrValue = atrValues ? atrValues[i] : null

      // Try long entry. entryMode=true lets legacy state conditions use the
      // setup-lookback window (preserves pre-DSL behavior); DSL nodes are explicit.
      if (rules.entry_long.length > 0 && evaluateBool(normalizeGroup(rules.entry_long), i, { ...ctx, entryMode: true })) {
        const entry = openNewPosition(
          'long', candle, i, equity, rules, executionConfig, atrValue, pair, candles,
        )
        if (entry) {
          position = entry
          equity -= entry.lotSize * executionConfig.commission_per_lot / 2 // half commission on entry
          balance -= entry.lotSize * executionConfig.commission_per_lot / 2
        }
      }
      // Try short entry (only if no long was opened)
      else if (rules.entry_short.length > 0 && evaluateBool(normalizeGroup(rules.entry_short), i, { ...ctx, entryMode: true })) {
        const entry = openNewPosition(
          'short', candle, i, equity, rules, executionConfig, atrValue, pair, candles,
        )
        if (entry) {
          position = entry
          equity -= entry.lotSize * executionConfig.commission_per_lot / 2
          balance -= entry.lotSize * executionConfig.commission_per_lot / 2
        }
      }
    }
  }

  console.log('[engine] Bar loop complete:', {
    tradesGenerated: trades.length,
    finalEquity: equity,
    finalBalance: balance,
    positionStillOpen: position.isOpen,
  })

  // 6b. If zero trades, emit per-condition diagnostic to help debug strategy rules
  if (trades.length === 0) {
    logConditionDiagnostics(candles, rules, lookback, ctx, sessionTimeframe)
  }

  // 7. Close any remaining position at last bar's close
  if (position.isOpen && candles.length > 0) {
    const lastCandle = candles[candles.length - 1]
    const trade = closePosition(position, lastCandle.close, 'End of data', lastCandle.time, executionConfig, pair)
    trades.push(trade)
    equity += trade.pnlUsd
    balance += trade.pnlUsd

    // Update last equity curve point
    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1] = { time: lastCandle.time, equity }
    }
    if (balanceCurve.length > 0) {
      balanceCurve[balanceCurve.length - 1] = { time: lastCandle.time, equity: balance }
    }
  }

  // 8. Compute performance metrics
  const result = computePerformance(trades, equityCurve, balanceCurve, startingCapital)
  // Surface unresolvable-condition warnings so a 0-trade run explains *why*
  // (e.g. a referenced series the engine couldn't compute) instead of a silent blank.
  if (warnings.length > 0) result.warnings = warnings
  return result
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function openNewPosition(
  direction: 'long' | 'short',
  candle: Candle,
  barIndex: number,
  equity: number,
  rules: StrategyRuleSet,
  config: ExecutionConfig,
  atrValue: number | null,
  pair: string,
  candles: Candle[],
): Position | null {
  // Calculate entry price with costs
  const costs = calculateEntryCosts(candle.close, direction, 0.1, config, pair) // tentative lot size for cost calc

  const effectiveEntry = costs.effective_entry

  // Calculate SL
  const slParams: SlTpParams = {
    method: rules.stop_loss.method,
    value: rules.stop_loss.value,
    atr_multiplier: rules.stop_loss.atr_multiplier,
    entryPrice: effectiveEntry,
    direction,
    atrValue,
    pair,
    candles,
    barIndex,
  }
  const slPrice = calculateStopLoss(slParams)

  // Calculate lot size based on risk
  const lotSize = calculateLotSize({
    method: rules.position_sizing.method,
    value: rules.position_sizing.value,
    riskPct: rules.risk_per_trade_pct,
    equity,
    entryPrice: effectiveEntry,
    stopLoss: slPrice,
    pair,
  })

  // Margin check
  if (!canOpenPosition(equity, effectiveEntry, lotSize, config.leverage)) {
    return null
  }

  // Calculate TP
  const tpParams: SlTpParams & { stopLoss: number | null } = {
    method: rules.take_profit.method,
    value: rules.take_profit.value,
    rr_ratio: rules.take_profit.rr_ratio,
    atr_multiplier: rules.take_profit.atr_multiplier,
    entryPrice: effectiveEntry,
    direction,
    atrValue,
    pair,
    stopLoss: slPrice,
  }
  const tpPrice = calculateTakeProfit(tpParams)

  const initialRisk = equity * (rules.risk_per_trade_pct / 100)

  return {
    isOpen: true,
    direction,
    entryPrice: effectiveEntry,
    entryTime: candle.time,
    stopLoss: slPrice,
    takeProfit: tpPrice,
    lotSize,
    initialRisk,
    partialExits: [],
  }
}

/**
 * Compute the minimum lookback period needed for all indicators.
 * This is the earliest bar index from which indicators have valid values.
 */
function computeLookback(rules: StrategyRuleSet): number {
  let maxPeriod = 1

  for (const config of rules.indicators) {
    switch (config.type) {
      case 'SMA':
      case 'EMA':
        maxPeriod = Math.max(maxPeriod, config.params.period ?? 20)
        break
      case 'RSI':
        maxPeriod = Math.max(maxPeriod, (config.params.period ?? 14) + 1)
        break
      case 'MACD': {
        const slow = config.params.slow ?? 26
        const signal = config.params.signal ?? 9
        maxPeriod = Math.max(maxPeriod, slow + signal)
        break
      }
      case 'BBANDS':
        maxPeriod = Math.max(maxPeriod, config.params.period ?? 20)
        break
      case 'ATR':
        maxPeriod = Math.max(maxPeriod, config.params.period ?? 14)
        break
      case 'STOCH': {
        const kPeriod = config.params.k_period ?? 14
        const dPeriod = config.params.d_period ?? 3
        maxPeriod = Math.max(maxPeriod, kPeriod + dPeriod)
        break
      }
      case 'ADX':
        maxPeriod = Math.max(maxPeriod, (config.params.period ?? 14) * 2)
        break
      case 'VWAP':
        maxPeriod = Math.max(maxPeriod, 1)
        break
    }
  }

  return maxPeriod
}

// ── Diagnostic logging (runs only when zero trades generated) ──────────────────

function logConditionDiagnostics(
  candles: Candle[],
  rules: StrategyRuleSet,
  lookback: number,
  ctx: EvalContext,
  sessionTimeframe: string,
): void {
  const groups: { label: string; conditions: BoolExpr[]; entryMode: boolean }[] = [
    { label: 'entry_long', conditions: rules.entry_long, entryMode: true },
    { label: 'entry_short', conditions: rules.entry_short, entryMode: true },
    { label: 'exit_long', conditions: rules.exit_long, entryMode: false },
    { label: 'exit_short', conditions: rules.exit_short, entryMode: false },
    { label: 'invalidation', conditions: rules.invalidation, entryMode: false },
  ]

  console.log('[engine] ── Zero trades diagnostic ───────────────────────────────')

  for (const { label, conditions, entryMode } of groups) {
    if (conditions.length === 0) continue

    console.log(`[engine] ${label} (${conditions.length} expr(s), AND logic):`)

    const barCtx = { ...ctx, entryMode }
    for (const c of conditions) {
      let passes = 0
      let total = 0

      for (let i = lookback; i < candles.length; i++) {
        // Apply session filter for entry groups (same window the entry path uses)
        if (entryMode && rules.session_filter?.sessions?.length) {
          if (!isInSession(candles[i], rules.session_filter.sessions, sessionTimeframe)) continue
        }
        total++
        if (evaluateBool(c, i, barCtx)) passes++
      }

      const pct = total > 0 ? ((passes / total) * 100).toFixed(2) : '0.00'
      const desc = describeExpr(c)
      console.log(`[engine]   ${desc.padEnd(62)} ${String(passes).padStart(6)}/${String(total)}  ${pct}%`)
    }

    // Combined all-pass rate (mirrors the entry/exit path's group evaluation)
    let allPass = 0
    let totalBars = 0
    const group = normalizeGroup(conditions)
    for (let i = lookback; i < candles.length; i++) {
      if (entryMode && rules.session_filter?.sessions?.length) {
        if (!isInSession(candles[i], rules.session_filter.sessions, sessionTimeframe)) continue
      }
      totalBars++
      if (evaluateBool(group, i, barCtx)) allPass++
    }
    const combinedPct = totalBars > 0 ? ((allPass / totalBars) * 100).toFixed(3) : '0.000'
    console.log(`[engine]   ALL ${conditions.length} combined: ${String(allPass).padStart(6)}/${totalBars} ${combinedPct}%`)
    console.log()
  }

  // Session filter summary
  if (rules.session_filter?.sessions?.length) {
    let inSession = 0
    for (let i = 0; i < candles.length; i++) {
      if (isInSession(candles[i], rules.session_filter.sessions, sessionTimeframe)) inSession++
    }
    console.log(`[engine] session_filter: ${rules.session_filter.sessions.join(', ')} | bars in session: ${inSession}/${candles.length} (${((inSession / candles.length) * 100).toFixed(1)}%)`)
    console.log()
  }

  console.log('[engine] ── End diagnostic ────────────────────────────────────────')
}