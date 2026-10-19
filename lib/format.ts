import { priceDigits } from '@/lib/replay/execution'

type Market = 'forex' | 'crypto'

const MINUS = '−'
const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Price at the instrument's quoted precision (5 dp FX, 3 dp JPY, 2 dp gold/crypto) */
export function formatPrice(value: number | string | null | undefined, pair: string, market: Market): string {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const digits = priceDigits(pair, market)
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** Dollar amount with thousands separators and a true minus sign: −$63.02.
 *  `signed` also prefixes gains with + (for P&L). */
export function formatUsd(value: number | null | undefined, { signed = false } = {}): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const body = `$${usd.format(Math.abs(value))}`
  if (value < 0) return `${MINUS}${body}`
  return signed && value > 0 ? `+${body}` : body
}

/** Signed number without currency, e.g. pips: +22.2 / −6.3 */
export function formatSigned(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const body = Math.abs(value).toFixed(digits)
  if (value < 0) return `${MINUS}${body}`
  return value > 0 ? `+${body}` : body
}

/** Text color class that carries P&L meaning */
export function pnlTone(value: number | null | undefined): string {
  if (value == null || value === 0 || !Number.isFinite(value)) return 'text-muted-foreground'
  return value > 0 ? 'text-gain' : 'text-loss'
}

/** R:R as 1:2.33 */
export function formatRR(value: number | string | null | undefined, digits = 2): string {
  if (value == null || value === '') return '—'
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? `1:${n.toFixed(digits)}` : '—'
}
