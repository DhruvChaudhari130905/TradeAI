import type { Session } from '@/lib/types/trade'
import { detectMarket } from '@/lib/types/trade'

/**
 * Field-level extraction metadata for the screenshot-driven journaling flow.
 * Confidence is UI-only (not persisted — see Q11): it drives the confirm-panel
 * coloring (blue = verified, amber = guessed, grey = not extractable) and the
 * "confirm amber before save" gate.
 */

/** All trade fields the extractor may attempt to fill. */
export type ExtractField =
  | 'pair'
  | 'market'
  | 'direction'
  | 'entry_price'
  | 'exit_price'
  | 'stop_loss'
  | 'take_profit'
  | 'lot_size'
  | 'risk_reward_ratio'
  | 'outcome'
  | 'pnl_usd'
  | 'session'
  | 'entry_time'
  | 'exit_time'
  | 'notes'
  | 'tags'

export type FieldConfidence = 'extracted' | 'guessed' | 'missing'

/** What the AI returned for one field. */
export interface ExtractedFieldValue {
  value: string | number | string[] | null
  confidence: FieldConfidence
}

/** Normalized result of reading a screenshot. */
export interface TradeImageExtraction {
  fields: Partial<Record<ExtractField, ExtractedFieldValue>>
  /** Optional human-readable flagged uncertainty, e.g. "pair matched in spirit but not exact". */
  warnings: string[]
  /** Raw model JSON, kept for debugging (never persisted). */
  raw: unknown
}

/* ------------------------------ Raw model shape ------------------------------ */

/**
 * Raw response we ask NIM to produce. The model reports both the value and a
 * coarse self-assessed confidence per field so we can color the confirm panel.
 */
export interface RawTradeExtraction {
  pair?: string | null
  direction?: 'long' | 'short' | null
  entry_price?: number | null
  exit_price?: number | null
  stop_loss?: number | null
  take_profit?: number | null
  lot_size?: number | null
  risk_reward_ratio?: number | null
  outcome?: 'win' | 'loss' | 'breakeven' | 'open' | null
  pnl_usd?: number | null
  session?: Session | null
  entry_time?: string | null
  exit_time?: string | null
  notes?: string | null
  tags?: string[] | null
  /** 'high' -> extracted (verified), 'low' -> guessed, absent/null -> missing */
  confidence?: Record<string, 'high' | 'low'>
}

/* ------------------------------ Validation ------------------------------ */

const NUMERIC_FIELDS: ExtractField[] = [
  'entry_price',
  'exit_price',
  'stop_loss',
  'take_profit',
  'lot_size',
  'risk_reward_ratio',
  'pnl_usd',
]

function normalizeValue(field: ExtractField, v: unknown): string | number | string[] | null {
  if (v === null || v === undefined || v === '') return null
  if (field === 'tags' && Array.isArray(v)) {
    return v.map((t) => String(t).trim()).filter(Boolean)
  }
  if (NUMERIC_FIELDS.includes(field)) {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  // entry/exit times must be full datetimes; a bare "01:33" clock time is unusable
  // in the form's datetime-local input, so reject it as missing.
  if (field === 'entry_time' || field === 'exit_time') {
    const s = String(v)
    if (!/^\d{4}-\d{2}-\d{2}/.test(s) || Number.isNaN(new Date(s).getTime())) return null
    return s
  }
  return String(v)
}

function confidenceOf(raw: RawTradeExtraction, field: ExtractField): FieldConfidence {
  const v = raw[field as keyof RawTradeExtraction]
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
    return 'missing'
  }
  // Strict rule per Q2-C: a field is "verified" (blue) only when NIM explicitly
  // self-assessed it "high". Anything not marked high — or not covered by the
  // confidence map at all (computed R:R, session, notes, etc.) — is "guessed" (amber).
  return raw.confidence?.[field] === 'high' ? 'extracted' : 'guessed'
}

export function isRawTradeExtraction(v: unknown): v is RawTradeExtraction {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  // Require at least one non-empty extractable value so an empty blob isn't accepted.
  return ['pair', 'entry_price', 'stop_loss', 'take_profit', 'direction'].some(
    (k) => r[k] !== null && r[k] !== undefined && r[k] !== '',
  )
}

export function normalizeExtraction(raw: RawTradeExtraction): TradeImageExtraction {
  const fields: Partial<Record<ExtractField, ExtractedFieldValue>> = {}
  const warnings: string[] = []

  const add = (field: ExtractField, v: unknown) => {
    const value = normalizeValue(field, v)
    fields[field] = { value, confidence: value === null ? 'missing' : confidenceOf(raw, field) }
  }

  add('pair', raw.pair)
  add('direction', raw.direction)
  add('entry_price', raw.entry_price)
  add('exit_price', raw.exit_price)
  add('stop_loss', raw.stop_loss)
  add('take_profit', raw.take_profit)
  add('lot_size', raw.lot_size)
  add('risk_reward_ratio', raw.risk_reward_ratio)
  add('outcome', raw.outcome)
  add('pnl_usd', raw.pnl_usd)
  add('session', raw.session)
  add('entry_time', raw.entry_time)
  add('exit_time', raw.exit_time)
  add('notes', raw.notes)
  add('tags', raw.tags)

  // market is never read from the image — it is derived from pair.
  const pair = fields.pair?.value
  if (typeof pair === 'string' && pair.length > 0) {
    const normalized = normalizePairString(pair)
    if (normalized) {
      const market = detectMarket(normalized)
      fields.market = { value: market, confidence: 'extracted' }
      if (normalized !== pair) {
        fields.pair = { value: normalized, confidence: 'guessed' }
        warnings.push(`Pair normalized "${pair}" → "${normalized}" — please confirm.`)
      }
    } else {
      warnings.push(`Could not map "${pair}" to a known instrument — pair needs manual entry.`)
    }
  }

  // Session may be derivable from an entry timestamp even when the model left it blank.
  if ((fields.session?.value ?? null) === null && typeof fields.entry_time?.value === 'string') {
    const derived = sessionFromTime(fields.entry_time.value as string)
    if (derived) fields.session = { value: derived, confidence: 'guessed' }
  }

  // Draft tags fallback — the model gave no structured tags, so seed from
  // direction/pair as an editable suggestion (green draft, not a silent value).
  const draftTags: string[] = []
  if ((fields.tags?.value as string[] | null | undefined)?.length === 0 || fields.tags?.value === null) {
    add('tags', null)
    const dir0 = fields.direction?.value
    if (typeof dir0 === 'string') draftTags.push(dir0.toLowerCase())
    fields.tags = { value: draftTags.length ? draftTags : null, confidence: 'guessed' }
  }

  return { fields, warnings, raw }
}

/** Normalize common MT4/MT5 symbol spellings ("XAUUSD" -> "XAU/USD"). */
export function normalizePairString(input: string): string | null {
  const PRECEDENCE: [RegExp, string][] = [
    [/^\s*XAU\s*\/?\s*USD\s*$/i, 'XAU/USD'],
    [/^\s*XAG\s*\/?\s*USD\s*$/i, 'XAG/USD'],
    [/^\s*([A-Z]{3})\s*\/?\s*([A-Z]{3})\s*$/i, 'PAIR'],
    [/^\s*([A-Z]{6})\s*$/i, 'FX6'],
  ]
  for (const [re, kind] of PRECEDENCE) {
    const m = re.exec(input.trim())
    if (!m) continue
    if (kind === 'PAIR') return `${m[1].toUpperCase()}/${m[2].toUpperCase()}`
    if (kind === 'FX6') return `${m[1].slice(0, 3).toUpperCase()}/${m[1].slice(3, 6).toUpperCase()}`
    return kind
  }
  return null
}

/** Guess a trading session from a UTC-ish entry timestamp (amber — user confirms). */
export function sessionFromTime(timeStr: string): Session | null {
  const d = new Date(timeStr)
  if (Number.isNaN(d.getTime())) return null
  const h = d.getUTCHours()
  if (h >= 8 && h < 13) return 'london'
  if (h >= 13 && h < 21) return 'new_york'
  if (h >= 21 || h < 4) return 'asian'
  if (h >= 4 && h < 8) return 'overlap'
  return 'other'
}

