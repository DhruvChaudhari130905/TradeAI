import type {
  Candle,
  Condition,
  ConditionType,
  BoolExpr,
  ValueExpr,
  StrategyRuleSet,
} from '@/lib/types/backtest'
import type { IndicatorSeries } from './indicators'
import {
  computeIndicators,
  resolveIndicator,
  buildPriceSeries,
} from './indicators'
import { computeLevels, LevelSeriesResult } from './levels'
import {
  evaluateCondition,
  TRIGGER_CONDITION_TYPES,
  ENTRY_SETUP_LOOKBACK,
} from './rule-engine'

// ── Expression DSL engine ─────────────────────────────────────────────────────
//
// Replaces the flat `Condition` enum with a recursive expression tree so any
// strategy logic (market structure, liquidity sweeps, OR branches, multi-bar
// setups, time windows) is expressible. Legacy `Condition` objects still in
// stored rules are valid tree leaves and delegate to the existing rule-engine
// evaluators — so old runs keep identical results.

/** The reserved level/structure series names produced by computeLevels(). */
export const LEVEL_SERIES = new Set([
  'swing_high', 'swing_low', 'prev_swing_high', 'prev_swing_low',
  'prev_day_high', 'prev_day_low', 'prev_day_open',
])

/** The built-in price series names. */
export const PRICE_SERIES = new Set(['close', 'open', 'high', 'low'])

export interface EvalContext {
  candles: Candle[]
  indicators: Map<string, number[] | IndicatorSeries>
  levels: LevelSeriesResult | null
  /** When true, legacy non-trigger state conditions get the entry setup-lookback
   *  window (preserves the pre-DSL 4-bar behavior for flat Condition leaves in
   *  entry groups). DSL nodes ignore this — they're explicit via within/strict. */
  entryMode: boolean
}

// ── Context construction ─────────────────────────────────────────────────────

/** Build the full evaluation context: compute numeric indicators, auto-compute
 *  price-action levels on demand when any rule group references a level series,
 *  and merge price + level series into the indicators map so resolveIndicator
 *  finds them. Returns the context and the list of unresolvable series refs
 *  (the safety net — surfaced as warnings rather than silent zeros). */
export function buildEvalContext(
  candles: Candle[],
  rules: StrategyRuleSet,
): { ctx: EvalContext; warnings: string[] } {
  const indicators = computeIndicators(candles, rules.indicators)

  // Pre-build price series (cheap) and merge — DSL `series` nodes reference them.
  const price = buildPriceSeries(candles)
  indicators.set('close', price.close)
  indicators.set('open', price.open)
  indicators.set('high', price.high)
  indicators.set('low', price.low)

  // Auto-compute levels on demand when any rule group needs them:
  //  (a) a `series` ref to a level name (swing_high, prev_day_low, …), OR
  //  (b) a structural leaf (structure_trend / liquidity_sweep / break_structure)
  //      that reads ctx.levels directly. These leaves emit no `series` refs, so
  //      without (b) ctx.levels stays null and every structural leaf silently
  //      evaluates false → 0 trades (the exact ICT failure this guards against).
  const refs = collectSeriesRefsFromRules(rules)
  const needsLevels = [...refs].some((r) => LEVEL_SERIES.has(r)) || usesStructuralLeaves(rules)

  let levels: LevelSeriesResult | null = null
  if (needsLevels && candles.length > 0) {
    const swingStrength = swingStrengthFromRules(rules)
    levels = computeLevels(candles, { swingStrength })
    mergeLevelSeries(indicators, levels)
  }

  const warnings = collectUnresolvableRefs(rules, indicators, levels)

  return { ctx: { candles, indicators, levels, entryMode: false }, warnings }
}

/** Look for a SWING_POINTS indicator config to get the configured swing strength. */
function swingStrengthFromRules(rules: StrategyRuleSet): number | undefined {
  for (const c of rules.indicators) {
    if (c.type === 'SWING_POINTS') {
      const s = c.params.strength ?? c.params.period
      if (typeof s === 'number' && s >= 1) return s
    }
  }
  return undefined
}

function mergeLevelSeries(map: Map<string, number[] | IndicatorSeries>, levels: LevelSeriesResult): void {
  map.set('swing_high', levels.swingHigh)
  map.set('swing_low', levels.swingLow)
  map.set('prev_swing_high', levels.prevSwingHigh)
  map.set('prev_swing_low', levels.prevSwingLow)
  map.set('prev_day_high', levels.prevDayHigh)
  map.set('prev_day_low', levels.prevDayLow)
  map.set('prev_day_open', levels.prevDayOpen)
  // structure_trend is not numeric — accessed directly via levels in evaluateBool.
}

// ── Legacy leaf detection ─────────────────────────────────────────────────────

function isLegacyCondition(expr: BoolExpr): expr is Condition {
  return !('kind' in expr)
}

// ── Group normalization ───────────────────────────────────────────────────────

/** A rule group is a BoolExpr[] AND-combined. Length 1 collapses to the single
 *  element (so a DSL tree emitted as the sole entry is evaluated as-is, not
 *  wrapped). Length 0 → an `and` with no args, which evaluates to false —
 *  matching the pre-DSL "empty group = no signal" behavior. */
export function normalizeGroup(group: BoolExpr[]): BoolExpr {
  if (group.length === 1) return group[0]
  return { kind: 'and', args: group }
}

// ── Boolean evaluation ────────────────────────────────────────────────────────

export function evaluateBool(expr: BoolExpr, i: number, ctx: EvalContext): boolean {
  // Legacy flat Condition leaf — delegate to the existing evaluators, applying
  // the entry setup-lookback window when in entry mode and the condition is a
  // state type (not an instant trigger).
  if (isLegacyCondition(expr)) {
    if (ctx.entryMode && !isTriggerType(expr.type)) {
      const lookback = ENTRY_SETUP_LOOKBACK
      for (let j = Math.max(0, i - lookback + 1); j <= i; j++) {
        if (evaluateCondition(expr, j, ctx.indicators, ctx.candles)) return true
      }
      return false
    }
    return evaluateCondition(expr, i, ctx.indicators, ctx.candles)
  }

  switch (expr.kind) {
    case 'and':
      // Empty AND = false (no conditions). Matches legacy entry behavior.
      return expr.args.length > 0 && expr.args.every((a) => evaluateBool(a, i, ctx))

    case 'or':
      return expr.args.some((a) => evaluateBool(a, i, ctx))

    case 'not':
      return !evaluateBool(expr.arg, i, ctx)

    case 'within': {
      // Child evaluated strictly at each bar in the window.
      const child = withEntryMode(ctx, false)
      for (let j = Math.max(0, i - expr.bars + 1); j <= i; j++) {
        if (evaluateBool(expr.expr, j, child)) return true
      }
      return false
    }

    case 'strict':
      // Force strict (current bar) even for legacy state leaves.
      return evaluateBool(expr.expr, i, withEntryMode(ctx, false))

    case 'prev':
      return i >= 1 && evaluateBool(expr.expr, i - 1, ctx)

    case 'cmp': {
      const a = evaluateValue(expr.a, i, ctx)
      const b = evaluateValue(expr.b, i, ctx)
      if (isNaN(a) || isNaN(b)) return false
      return compare(a, b, expr.op)
    }

    case 'cross_above':
      return evalCross(expr.a, expr.b, i, ctx, 'above')

    case 'cross_below':
      return evalCross(expr.a, expr.b, i, ctx, 'below')

    case 'pattern':
      // Reuse the existing candle-pattern detectors (fvg, engulfing, …).
      return evaluateCondition(
        { type: 'candle_pattern', pattern: expr.name },
        i, ctx.indicators, ctx.candles,
      )

    case 'liquidity_sweep':
      return evalLiquiditySweep(expr, i, ctx)

    case 'structure_trend':
      return ctx.levels?.structureTrend[i] === expr.mode

    case 'break_structure':
      return evalBreakStructure(expr, i, ctx)

    default:
      return false
  }
}

function withEntryMode(ctx: EvalContext, entryMode: boolean): EvalContext {
  if (ctx.entryMode === entryMode) return ctx
  return { ...ctx, entryMode }
}

function evalCross(a: ValueExpr, b: ValueExpr, i: number, ctx: EvalContext, dir: 'above' | 'below'): boolean {
  if (i < 1) return false
  const prevA = evaluateValue(a, i - 1, ctx)
  const prevB = evaluateValue(b, i - 1, ctx)
  const currA = evaluateValue(a, i, ctx)
  const currB = evaluateValue(b, i, ctx)
  if (isNaN(prevA) || isNaN(prevB) || isNaN(currA) || isNaN(currB)) return false
  return dir === 'above'
    ? prevA <= prevB && currA > currB
    : prevA >= prevB && currA < currB
}

/** Liquidity sweep / stop-hunt + reclaim.
 *  side 'low'  (bullish): price took out the level (some bar in the lookback
 *    window traded below it) AND the current bar closes back above it.
 *  side 'high' (bearish): took out the level above AND current bar closes below.
 *  Level defaults to the most-recent confirmed swing on that side; an explicit
 *  ValueExpr may override it (e.g. prev_day_low). Causal — only looks back. */
const SWEEP_LOOKBACK = 3

function evalLiquiditySweep(
  expr: Extract<BoolExpr, { kind: 'liquidity_sweep' }>,
  i: number,
  ctx: EvalContext,
): boolean {
  let level: number
  if (expr.level) {
    level = evaluateValue(expr.level, i, ctx)
  } else {
    const arr = expr.side === 'low' ? ctx.levels?.swingLow : ctx.levels?.swingHigh
    level = arr ? arr[i] : NaN
  }
  if (isNaN(level)) return false

  let tookLiquidity = false
  for (let j = Math.max(0, i - SWEEP_LOOKBACK + 1); j <= i; j++) {
    if (expr.side === 'low' && ctx.candles[j].low < level) tookLiquidity = true
    if (expr.side === 'high' && ctx.candles[j].high > level) tookLiquidity = true
  }
  if (!tookLiquidity) return false

  const close = ctx.candles[i].close
  return expr.side === 'low' ? close > level : close < level
}

/** Break of structure (market-structure shift).
 *  'up'   (bullish): current close breaks above the most-recent confirmed swing high
 *                   that was previously resisting (prev close ≤ level < curr close).
 *  'down' (bearish): current close breaks below the most-recent confirmed swing low. */
function evalBreakStructure(
  expr: Extract<BoolExpr, { kind: 'break_structure' }>,
  i: number,
  ctx: EvalContext,
): boolean {
  if (i < 1) return false
  let level: number
  if (expr.swing) {
    level = evaluateValue(expr.swing, i, ctx)
  } else {
    const arr = expr.side === 'up' ? ctx.levels?.swingHigh : ctx.levels?.swingLow
    level = arr ? arr[i] : NaN
  }
  if (isNaN(level)) return false
  const prevClose = ctx.candles[i - 1].close
  const currClose = ctx.candles[i].close
  return expr.side === 'up'
    ? prevClose <= level && currClose > level
    : prevClose >= level && currClose < level
}

// ── Value evaluation ──────────────────────────────────────────────────────────

export function evaluateValue(expr: ValueExpr, i: number, ctx: EvalContext): number {
  switch (expr.kind) {
    case 'series': {
      const arr = resolveIndicator(ctx.indicators, expr.name)
      if (!arr) return NaN
      const v = (arr as number[])[i]
      return typeof v === 'number' ? v : NaN
    }
    case 'const':
      return expr.value
    case 'binop': {
      const a = evaluateValue(expr.a, i, ctx)
      const b = evaluateValue(expr.b, i, ctx)
      if (isNaN(a) || isNaN(b)) return NaN
      switch (expr.op) {
        case '+': return a + b
        case '-': return a - b
        case '*': return a * b
        case '/': return b === 0 ? NaN : a / b
      }
      return NaN
    }
    case 'abs': {
      const v = evaluateValue(expr.arg, i, ctx)
      return isNaN(v) ? NaN : Math.abs(v)
    }
    default:
      return NaN
  }
}

// ── Trigger classification (shared with the legacy rule-engine) ────────────────

function isTriggerType(t: ConditionType): boolean {
  return TRIGGER_CONDITION_TYPES.has(t)
}

// ── Safety net: collect unresolvable series references ───────────────────────

/** Walk every rule group and return the set of `series` names (and legacy
 *  indicator1/indicator2 refs) that can't be resolved against the context.
 *  The engine turns these into BacktestResult warnings — so a 0-trade run says
 *  *why* instead of being a silent blank. */
export function collectUnresolvableRefs(
  rules: StrategyRuleSet,
  indicators: Map<string, number[] | IndicatorSeries>,
  levels: LevelSeriesResult | null,
): string[] {
  const refs = collectSeriesRefsFromRules(rules)
  const unresolvable: string[] = []
  for (const name of refs) {
    if (LEVEL_SERIES.has(name)) {
      // Level series are resolvable only because computeLevels ran (merged in).
      if (!levels) unresolvable.push(`${name} (level: add SWING_POINTS/PREV_DAY_HL indicator or check data)`)
      continue
    }
    if (PRICE_SERIES.has(name)) continue
    if (resolveIndicator(indicators, name) === undefined) {
      unresolvable.push(name)
    }
  }
  return unresolvable
}

/** Collect every `series` name and legacy indicator1/indicator2 reference used
 *  anywhere in the rule groups. */
export function collectSeriesRefsFromRules(rules: StrategyRuleSet): Set<string> {
  const refs = new Set<string>()
  const groups: BoolExpr[][] = [
    rules.entry_long, rules.entry_short,
    rules.exit_long, rules.exit_short, rules.invalidation,
  ]
  for (const g of groups) for (const expr of g) collectValueRefs(expr, refs)
  return refs
}

function collectValueRefs(expr: BoolExpr, refs: Set<string>): void {
  if (isLegacyCondition(expr)) {
    if (expr.indicator1) refs.add(expr.indicator1)
    if (expr.indicator2) refs.add(expr.indicator2)
    return
  }
  switch (expr.kind) {
    case 'and':
    case 'or':
      expr.args.forEach((a) => collectValueRefs(a, refs))
      break
    case 'not':
      collectValueRefs(expr.arg, refs)
      break
    case 'within':
    case 'strict':
    case 'prev':
      collectValueRefs(expr.expr, refs)
      break
    case 'cmp':
    case 'cross_above':
    case 'cross_below':
      collectValueRefsBool(expr.a, refs)
      collectValueRefsBool(expr.b, refs)
      break
    case 'liquidity_sweep':
      if (expr.level) collectValueRefsBool(expr.level, refs)
      break
    case 'break_structure':
      if (expr.swing) collectValueRefsBool(expr.swing, refs)
      break
    // pattern, structure_trend reference no series directly.
  }
}

/** True if any rule group contains a structural leaf that reads ctx.levels
 *  directly — `structure_trend` always; `liquidity_sweep` / `break_structure`
 *  when they fall back to the most-recent swing (no explicit level/swing), the
 *  common case. These leaves emit no `series` refs, so collectSeriesRefsFromRules
 *  alone won't trigger computeLevels — this is what made ICT silently 0-trade. */
function usesStructuralLeaves(rules: StrategyRuleSet): boolean {
  const groups: BoolExpr[][] = [
    rules.entry_long, rules.entry_short,
    rules.exit_long, rules.exit_short, rules.invalidation,
  ]
  for (const g of groups) for (const e of g) if (hasStructuralLeaf(e)) return true
  return false
}

function hasStructuralLeaf(expr: BoolExpr): boolean {
  if (isLegacyCondition(expr)) return false
  switch (expr.kind) {
    case 'structure_trend':
    case 'liquidity_sweep':
    case 'break_structure':
      return true
    case 'and':
    case 'or':
      return expr.args.some(hasStructuralLeaf)
    case 'not':
      return hasStructuralLeaf(expr.arg)
    case 'within':
    case 'strict':
    case 'prev':
      return hasStructuralLeaf(expr.expr)
    // cmp / cross_above / cross_below hold only ValueExprs (no boolean leaves);
    // pattern holds a name. None of these carry a structural leaf.
    default:
      return false
  }
}

function collectValueRefsBool(v: ValueExpr, refs: Set<string>): void {
  switch (v.kind) {
    case 'series': refs.add(v.name); break
    case 'binop':
      collectValueRefsBool(v.a, refs)
      collectValueRefsBool(v.b, refs)
      break
    case 'abs':
      collectValueRefsBool(v.arg, refs)
      break
    // const → no refs.
  }
}

// ── Human-readable description (AI report + UI) ───────────────────────────────

export function describeExpr(expr: BoolExpr): string {
  if (isLegacyCondition(expr)) return describeLegacyCondition(expr)
  switch (expr.kind) {
    case 'and': return `(${expr.args.map(describeExpr).join(' AND ')})`
    case 'or': return `(${expr.args.map(describeExpr).join(' OR ')})`
    case 'not': return `NOT ${describeExpr(expr.arg)}`
    case 'within': return `within ${expr.bars} bars: ${describeExpr(expr.expr)}`
    case 'strict': return `strict: ${describeExpr(expr.expr)}`
    case 'prev': return `prev: ${describeExpr(expr.expr)}`
    case 'cmp': return `${describeValue(expr.a)} ${opSymbol(expr.op)} ${describeValue(expr.b)}`
    case 'cross_above': return `${describeValue(expr.a)} crosses above ${describeValue(expr.b)}`
    case 'cross_below': return `${describeValue(expr.a)} crosses below ${describeValue(expr.b)}`
    case 'pattern': return `pattern:${expr.name}`
    case 'liquidity_sweep':
      return `liquidity sweep ${expr.side}${expr.level ? ` @ ${describeValue(expr.level)}` : ''}`
    case 'structure_trend': return `trend ${expr.mode}${expr.strength ? ` (strength ${expr.strength})` : ''}`
    case 'break_structure':
      return `break structure ${expr.side}${expr.swing ? ` @ ${describeValue(expr.swing)}` : ''}`
    default: return '(unknown)'
  }
}

function describeValue(v: ValueExpr): string {
  switch (v.kind) {
    case 'series': return v.name
    case 'const': return String(v.value)
    case 'binop': return `(${describeValue(v.a)} ${v.op} ${describeValue(v.b)})`
    case 'abs': return `|${describeValue(v.arg)}|`
    default: return '?'
  }
}

function describeLegacyCondition(c: Condition): string {
  const ind2 = c.indicator2 ?? ''
  const valOrPat = c.pattern ?? (c.value !== undefined ? String(c.value) : '')
  const parts = [c.type, c.indicator1 ?? '', c.operator ?? '', ind2, valOrPat].filter(Boolean)
  return parts.join(' ')
}

function opSymbol(op: string): string {
  switch (op) {
    case 'gt': return '>'
    case 'lt': return '<'
    case 'gte': return '>='
    case 'lte': return '<='
    case 'eq': return '='
    default: return '?'
  }
}

// ── Comparison helper (mirrors rule-engine.compare) ───────────────────────────

function compare(a: number, b: number, op: string): boolean {
  switch (op) {
    case 'gt': return a > b
    case 'lt': return a < b
    case 'gte': return a >= b
    case 'lte': return a <= b
    case 'eq': return Math.abs(a - b) < 0.0001
    default: return false
  }
}

// Re-export the session helper so callers that import from expr-engine don't
// also need to reach into rule-engine.
export { isInSession } from './rule-engine'
