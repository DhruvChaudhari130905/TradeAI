import { BarChart3, Percent, TrendingUp, TrendingDown, Brain } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { DashboardStats } from '@/lib/actions/dashboard'

export function StatsCards({ stats }: { stats: DashboardStats }) {
  const cards = [
    {
      label: 'Total Trades',
      value: stats.totalTrades.toString(),
      icon: BarChart3,
      iconBg: 'bg-[#00FF9C]/10',
      iconColor: 'text-[#00FF9C]',
      valueColor: 'text-white',
    },
    {
      label: 'Win Rate',
      value: `${stats.winRate.toFixed(1)}%`,
      icon: Percent,
      iconBg: 'bg-[#3B82F6]/10',
      iconColor: 'text-[#3B82F6]',
      valueColor: 'text-white',
    },
    {
      label: 'Net PnL',
      value: `$${stats.netPnl.toFixed(2)}`,
      icon: stats.netPnl >= 0 ? TrendingUp : TrendingDown,
      iconBg: stats.netPnl >= 0 ? 'bg-[#00FF9C]/10' : 'bg-[#FF4D4D]/10',
      iconColor: stats.netPnl >= 0 ? 'text-[#00FF9C]' : 'text-[#FF4D4D]',
      valueColor: stats.netPnl >= 0 ? 'text-[#00FF9C]' : 'text-[#FF4D4D]',
    },
    {
      label: 'Avg AI Score',
      value: stats.avgAiScore != null ? `${stats.avgAiScore.toFixed(1)}/10` : '—',
      icon: Brain,
      iconBg: 'bg-[#8B5CF6]/10',
      iconColor: 'text-[#8B5CF6]',
      valueColor: 'text-white',
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="border-zinc-800 bg-[#12141A] overflow-hidden relative group">
          {/* Subtle glow on hover */}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-[#00FF9C]/5 via-transparent to-transparent pointer-events-none" />
          <CardContent className="flex items-center gap-4 p-5">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${card.iconBg} transition-transform group-hover:scale-110 duration-300`}>
              <card.icon className={`h-6 w-6 ${card.iconColor}`} />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                {card.label}
              </p>
              <p className={`font-mono text-2xl font-bold ${card.valueColor} mt-0.5`}>
                {card.value}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
