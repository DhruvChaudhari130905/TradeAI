import type { Trade } from '@/lib/types/trade'

export function buildTradeContext(trade: Trade): string {
  const lines: string[] = ['Trade Context:']

  lines.push(`- Instrument: ${trade.pair} (${trade.market === 'forex' ? 'Forex' : 'Crypto'})`)
  lines.push(`- Direction: ${trade.direction === 'long' ? 'Long' : 'Short'}`)

  const fmt = (v: number | null | undefined, decimals = 5) =>
    v != null ? Number(v).toFixed(decimals) : 'N/A'

  lines.push(`- Entry: ${fmt(trade.entry_price)} | Exit: ${fmt(trade.exit_price)} | Stop Loss: ${fmt(trade.stop_loss)} | Take Profit: ${fmt(trade.take_profit)}`)
  lines.push(`- Lot Size: ${trade.lot_size != null ? trade.lot_size : 'N/A'} | Risk:Reward: ${trade.risk_reward_ratio != null ? `1:${Number(trade.risk_reward_ratio).toFixed(2)}` : 'N/A'}`)

  const sessionLabel = trade.session
    ? trade.session.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'N/A'
  lines.push(`- Session: ${sessionLabel}`)

  const formatTime = (d: string | null | undefined) =>
    d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'N/A'

  lines.push(`- Entry Time: ${formatTime(trade.entry_time)} | Exit Time: ${formatTime(trade.exit_time)}`)

  if (trade.outcome) {
    const outcome = trade.outcome.charAt(0).toUpperCase() + trade.outcome.slice(1)
    const pnlPart = trade.pnl_usd != null
      ? ` | PnL: ${trade.pnl_usd >= 0 ? '+' : ''}$${Number(trade.pnl_usd).toFixed(2)}`
      : ''
    const pipsPart = trade.pnl_pips != null
      ? ` (${Number(trade.pnl_pips) >= 0 ? '+' : ''}${Number(trade.pnl_pips).toFixed(1)} pips)`
      : ''
    lines.push(`- Outcome: ${outcome}${pnlPart}${pnlPart}`)
  }

  // Wrap user-supplied content in clear boundary markers to mitigate prompt injection
  if (trade.notes) {
    lines.push(`- Trader Notes: <user_trade_notes>${trade.notes}</user_trade_notes>`)
  }

  if (trade.tags && trade.tags.length > 0) {
    lines.push(`- Tags: <user_tags>${trade.tags.join(', ')}</user_tags>`)
  }

  return lines.join('\n')
}
