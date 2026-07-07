'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import type { TradeWithScore } from '@/lib/actions/dashboard'

interface PnlChartProps {
  trades: TradeWithScore[]
}

export function PnlChart({ trades }: PnlChartProps) {
  // Build cumulative PnL data
  const data = trades.reduce<{ time: string; pnl: number }[]>((acc, trade) => {
    const prevPnl = acc.length > 0 ? acc[acc.length - 1].pnl : 0
    const tradePnl = Number(trade.pnl_usd) || 0
    acc.push({
      time: trade.entry_time
        ? new Date(trade.entry_time).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
        : `Trade ${acc.length + 1}`,
      pnl: prevPnl + tradePnl,
    })
    return acc
  }, [])

  if (data.length === 0) {
    return (
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardContent className="flex h-72 items-center justify-center p-6">
          <p className="text-sm text-zinc-500">No PnL data yet</p>
        </CardContent>
      </Card>
    )
  }

  const finalPnl = data[data.length - 1]?.pnl ?? 0
  const isProfit = finalPnl >= 0
  const strokeColor = isProfit ? '#00FF9C' : '#FF4D4D'
  const gradientId = 'pnlGradient'

  return (
    <Card className="border-zinc-800 bg-[#12141A]">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Cumulative PnL</h3>
          <span
            className={`font-mono text-sm font-bold ${
              isProfit ? 'text-[#00FF9C]' : 'text-[#FF4D4D]'
            }`}
          >
            ${finalPnl.toFixed(2)}
          </span>
        </div>
        <div style={{ height: 240, minHeight: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
            <XAxis
              dataKey="time"
              tick={{ fill: '#71717A', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#27272A' }}
            />
            <YAxis
              tick={{ fill: '#71717A', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#27272A' }}
              tickFormatter={(v: number) => `$${v}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1C1E26',
                border: '1px solid #27272A',
                borderRadius: '8px',
                color: '#E4E4E7',
                fontSize: 12,
              }}
              formatter={(value) => [`$${Number(value).toFixed(2)}`, 'PnL']}
            />
            <ReferenceLine y={0} stroke="#71717A" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="pnl"
              stroke={strokeColor}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              animationDuration={1200}
            />
          </AreaChart>
        </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
