import { getNimClient, NIM_MODEL, NIM_FALLBACK_MODEL } from '@/lib/nim/client'
import { parseNimJson } from '@/lib/nim/parse-nim-json'
import { STRATEGY_EXTRACTOR_PROMPT } from '@/lib/prompts/backtest-system-prompts'
import { LEVEL_SERIES, PRICE_SERIES } from '@/lib/backtest/expr-engine'
import type { StrategyRuleSet, BoolExpr, ValueExpr, Condition } from '@/lib/types/backtest'

const DEFAULT_EXECUTION: Partial<StrategyRuleSet> = {
  risk_per_trade_pct: 1,
  position_sizing: { method: 'risk_based' },
  order_type: 'market',
  session_filter: null,
  trade_management: [],
  invalidation: [],
  notes: '',
}

/**
 * Extract structured strategy rules (StrategyRuleSet) from raw text using NIM.
 * Primary model → fallback model → primary model with strict retry prompt.
 * Up to 3 attempts total.
 */
export async function extractStrategyRules(docText: string): Promise<StrategyRuleSet> {
  const client = getNimClient()

  // Attempt 1: Primary model
  try {
    return await callExtractor(client, docText, NIM_MODEL, false)
  } catch (err) {
    console.error('[extractStrategyRules] primary model failed:', err)
  }

  // Attempt 2: Fallback model (larger, better instruction-following)
  try {
    return await callExtractor(client, docText, NIM_FALLBACK_MODEL, false)
  } catch (err) {
    console.error('[extractStrategyRules] fallback model failed:', err)
  }

  // Attempt 3: Primary model with strict retry (prepend JSON-only instruction to user message)
  return await callExtractor(client, docText, NIM_MODEL, true)
}

async function callExtractor(
  client: ReturnType<typeof getNimClient>,
  docText: string,
  model: string,
  strictRetry: boolean,
): Promise<StrategyRuleSet> {
  const userContent = strictRetry
    ? `⚠️ PREVIOUS ATTEMPT FAILED — YOU MUST OUTPUT ONLY JSON.\nYour response must start with "{" and contain nothing else.\n\n<strategy_document>${docText}</strategy_document>`
    : `<strategy_document>${docText}</strategy_document>`

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: STRATEGY_EXTRACTOR_PROMPT },
      { role: 'user', content: userContent },
    ],
    max_tokens: 2048,
    temperature: 0, // must be deterministic — nemotron models prose at >0
    // @ts-expect-error chat_template_kwargs is an NVIDIA NIM extension, not in the OpenAI SDK types.
    // Disables Nemotron-3 reasoning ("thinking"), which otherwise emits chain-of-thought as
    // message.content and consumes the token budget before JSON is produced.
    chat_template_kwargs: { enable_thinking: false },
  })

  const raw = completion.choices[0]?.message?.content
  if (!raw) throw new Error('Empty response from NIM for strategy extraction')

  try {
    const rules = parseNimJson<StrategyRuleSet>(raw)
    return validateAndApplyDefaults(rules)
  } catch (parseError) {
    // Log truncated raw response for debugging
    const preview = raw.length > 300 ? raw.slice(0, 300) + '…' : raw
    console.error('[extractStrategyRules] NIM returned non-JSON:', preview)
    throw parseError
  }
}

function validateAndApplyDefaults(rules: StrategyRuleSet): StrategyRuleSet {
  // Validate minimum shape
  if (!rules.indicators || !Array.isArray(rules.indicators)) {
    throw new Error('Invalid strategy rules: missing indicators array')
  }
  if (!rules.entry_long || !Array.isArray(rules.entry_long)) {
    throw new Error('Invalid strategy rules: missing entry_long array')
  }
  if (!rules.entry_short || !Array.isArray(rules.entry_short)) {
    throw new Error('Invalid strategy rules: missing entry_short array')
  }
  if (!rules.exit_long || !Array.isArray(rules.exit_long)) {
    throw new Error('Invalid strategy rules: missing exit_long array')
  }
  if (!rules.exit_short || !Array.isArray(rules.exit_short)) {
    throw new Error('Invalid strategy rules: missing exit_short array')
  }

  // Reject strategies with no entry conditions in either direction
  if (rules.entry_long.length === 0 && rules.entry_short.length === 0) {
    throw new Error(
      'Strategy extraction failed: no entry conditions could be identified from the document. ' +
      'Try re-uploading the document with clearer formatting, or use Manual mode to define rules directly.',
    )
  }

  // Apply defaults for missing fields
  if (typeof rules.risk_per_trade_pct !== 'number' || rules.risk_per_trade_pct <= 0) {
    rules.risk_per_trade_pct = DEFAULT_EXECUTION.risk_per_trade_pct!
  }
  if (!rules.position_sizing || !rules.position_sizing.method) {
    rules.position_sizing = DEFAULT_EXECUTION.position_sizing!
  }
  if (!rules.stop_loss || !rules.stop_loss.method) {
    rules.stop_loss = { method: 'atr_based', atr_multiplier: 1.5 }
  }
  if (!rules.take_profit || !rules.take_profit.method) {
    rules.take_profit = { method: 'risk_reward', rr_ratio: 2 }
  }
  if (!rules.order_type) {
    rules.order_type = DEFAULT_EXECUTION.order_type!
  }
  if (!rules.session_filter || !rules.session_filter.sessions || !Array.isArray(rules.session_filter.sessions) || rules.session_filter.sessions.length === 0) {
    rules.session_filter = DEFAULT_EXECUTION.session_filter!
  }
  if (!rules.trade_management || !Array.isArray(rules.trade_management)) {
    rules.trade_management = DEFAULT_EXECUTION.trade_management!
  }
  if (!rules.invalidation || !Array.isArray(rules.invalidation)) {
    rules.invalidation = DEFAULT_EXECUTION.invalidation!
  }
  if (!rules.notes) {
    rules.notes = DEFAULT_EXECUTION.notes!
  }
  if (!rules.name) {
    rules.name = 'Untitled Strategy'
  }
  if (!rules.timeframe) {
    rules.timeframe = '1D'
  }

  // Canonicalize LLM drift and drop unresolvable leaves. This is a first pass;
  // the engine's runtime collectUnresolvableRefs is the authoritative guard.
  rules = canonicalizeAndPrune(rules)

  return rules
}

// ── Canonicalization & pruning ──────────────────────────────────────────────

// Common hallucinated series names → real reserved series. The extractor prompt
// lists the exact reserved keys, but llama drift still invents these synonyms,
// so we map them rather than silently dropping the condition.
const SERIES_SYNONYMS: Record<string, string> = {
  lower_high: 'prev_swing_high',
  recent_lower_high: 'prev_swing_high',
  recent_swing_high: 'swing_high',
  recent_swing_low: 'swing_low',
  previous_day_low: 'prev_day_low',
  previous_day_high: 'prev_day_high',
  previous_day_open: 'prev_day_open',
  prev_day_low_level: 'prev_day_low',
  prev_swing: 'prev_swing_high',
}

/** Canonicalize series names in a ValueExpr (recursing into binop/abs). */
function canonValue(v: ValueExpr): ValueExpr {
  switch (v.kind) {
    case 'series':
      return { kind: 'series', name: SERIES_SYNONYMS[v.name] ?? v.name }
    case 'binop':
      return { kind: 'binop', op: v.op, a: canonValue(v.a), b: canonValue(v.b) }
    case 'abs':
      return { kind: 'abs', arg: canonValue(v.arg) }
    default:
      return v
  }
}

/** True iff every series ref in the tree resolves against the declared indicator
 *  set + price/level series. Used to drop leaves that would silently zero an entry. */
function isResolvable(expr: BoolExpr, known: Set<string>): boolean {
  const refs = new Set<string>()
  collectRefs(expr, refs)
  for (const r of refs) {
    if (LEVEL_SERIES.has(r) || PRICE_SERIES.has(r)) continue
    if (!known.has(r) && !(known.has('macd') && r.startsWith('macd_')) && !(known.has('bbands') && r.startsWith('bbands_')) && !(known.has('stoch') && r.startsWith('stoch_'))) {
      return false
    }
  }
  return true
}

function collectRefs(expr: BoolExpr, refs: Set<string>): void {
  if ('type' in expr) {
    if (expr.indicator1) refs.add(expr.indicator1)
    if (expr.indicator2) refs.add(expr.indicator2)
    return
  }
  switch (expr.kind) {
    case 'and':
    case 'or':
      expr.args.forEach((a) => collectRefs(a, refs)); break
    case 'not':
      collectRefs(expr.arg, refs); break
    case 'within':
    case 'strict':
    case 'prev':
      collectRefs(expr.expr, refs); break
    case 'cmp':
    case 'cross_above':
    case 'cross_below':
      collectValueRefs(expr.a, refs); collectValueRefs(expr.b, refs); break
    case 'liquidity_sweep':
      if (expr.level) collectValueRefs(expr.level, refs); break
    case 'break_structure':
      if (expr.swing) collectValueRefs(expr.swing, refs); break
    default: break
  }
}

function collectValueRefs(v: ValueExpr, refs: Set<string>): void {
  switch (v.kind) {
    case 'series': refs.add(v.name); break
    case 'binop': collectValueRefs(v.a, refs); collectValueRefs(v.b, refs); break
    case 'abs': collectValueRefs(v.arg, refs); break
    default: break
  }
}

/** Canonicalize the tree and drop any top-level leaf still referencing an
 *  unknown series (with a note appended to rules.notes) so it can't silently
 *  zero the group. Composites whose children all became unresolvable are also
 *  dropped. */
function canonicalizeAndPrune(rules: StrategyRuleSet): StrategyRuleSet {
  // Build the set of indicator keys the strategy declares (so we know what's resolvable).
  const known = new Set<string>(['close', 'open', 'high', 'low'])
  for (const ind of rules.indicators) {
    switch (ind.type) {
      case 'SMA': known.add(`sma_${ind.params.period ?? 20}`); break
      case 'EMA': known.add(`ema_${ind.params.period ?? 20}`); break
      case 'RSI': known.add(`rsi_${ind.params.period ?? 14}`); break
      case 'MACD': known.add('macd'); break
      case 'BBANDS': known.add('bbands'); break
      case 'ATR': known.add(`atr_${ind.params.period ?? 14}`); break
      case 'STOCH': known.add('stoch'); break
      case 'ADX': known.add(`adx_${ind.params.period ?? 14}`); break
      case 'VWAP': known.add('vwap'); break
      case 'SWING_POINTS': for (const s of ['swing_high', 'swing_low', 'prev_swing_high', 'prev_swing_low']) known.add(s); break
      case 'PREV_DAY_HL': for (const s of ['prev_day_high', 'prev_day_low', 'prev_day_open']) known.add(s); break
    }
  }

  const notes: string[] = []
  const pruned = (rules.notes && rules.notes.trim()) ? [rules.notes.trim()] : []

  const processGroup = (group: BoolExpr[], label: string): BoolExpr[] => {
    const out: BoolExpr[] = []
    for (const expr of group) {
      const canon = canonExpr(expr)
      if (isResolvable(canon, known)) {
        out.push(canon)
      } else {
        const desc = describeShort(canon)
        notes.push(`${label}: dropped "${desc}" (references an unknown series — add the indicator or use a reserved name)`)
      }
    }
    return out
  }

  rules.entry_long = processGroup(rules.entry_long, 'entry_long')
  rules.entry_short = processGroup(rules.entry_short, 'entry_short')
  rules.exit_long = processGroup(rules.exit_long, 'exit_long')
  rules.exit_short = processGroup(rules.exit_short, 'exit_short')
  rules.invalidation = processGroup(rules.invalidation, 'invalidation')

  if (notes.length > 0) {
    rules.notes = [...pruned, ...notes].join('\n')
  }
  return rules
}

function canonExpr(expr: BoolExpr): BoolExpr {
  if ('type' in expr) {
    const c = expr as Condition
    if (c.indicator1 && SERIES_SYNONYMS[c.indicator1]) c.indicator1 = SERIES_SYNONYMS[c.indicator1]
    if (c.indicator2 && SERIES_SYNONYMS[c.indicator2]) c.indicator2 = SERIES_SYNONYMS[c.indicator2]
    return c
  }
  switch (expr.kind) {
    case 'and':
    case 'or':
      return { ...expr, args: expr.args.map(canonExpr) }
    case 'not':
      return { ...expr, arg: canonExpr(expr.arg) }
    case 'within':
      return { ...expr, expr: canonExpr(expr.expr) }
    case 'strict':
    case 'prev':
      return { ...expr, expr: canonExpr(expr.expr) }
    case 'cmp':
      return { ...expr, a: canonValue(expr.a), b: canonValue(expr.b) }
    case 'cross_above':
    case 'cross_below':
      return { ...expr, a: canonValue(expr.a), b: canonValue(expr.b) }
    case 'liquidity_sweep':
      return { ...expr, level: expr.level ? canonValue(expr.level) : undefined }
    case 'break_structure':
      return { ...expr, swing: expr.swing ? canonValue(expr.swing) : undefined }
    default:
      return expr
  }
}

function describeShort(expr: BoolExpr): string {
  if ('type' in expr) return `${expr.type} ${expr.indicator1 ?? ''} ${expr.indicator2 ?? ''}`.trim()
  return expr.kind
}
