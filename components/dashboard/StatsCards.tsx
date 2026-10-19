import { StatStrip } from '@/components/ui/stat-strip'
import { formatUsd, pnlTone } from '@/lib/format'
import type { DashboardStats } from '@/lib/actions/dashboard'

interface StatsCardsProps {
  stats: DashboardStats
  wins: number
  losses: number
  reviewed: number
}

export function StatsCards({ stats, wins, losses, reviewed }: StatsCardsProps) {
  const avgPerTrade = stats.totalTrades > 0 ? stats.netPnl / stats.totalTrades : null

  return (
    <StatStrip
      items={[
        { label: 'Trades', value: stats.totalTrades.toString(), sub: `${wins}W · ${losses}L` },
        {
          label: 'Win rate',
          value: wins + losses > 0 ? `${stats.winRate.toFixed(1)}%` : '—',
          sub: 'of closed trades',
        },
        {
          label: 'Net P&L',
          value: formatUsd(stats.netPnl, { signed: true }),
          tone: pnlTone(stats.netPnl),
          sub: avgPerTrade != null ? `${formatUsd(avgPerTrade, { signed: true })} per trade` : undefined,
        },
        {
          label: 'Avg AI score',
          value: stats.avgAiScore != null ? `${stats.avgAiScore.toFixed(1)}/10` : '—',
          sub: `${reviewed} reviewed`,
        },
      ]}
    />
  )
}
