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
import { formatUsd, pnlTone } from '@/lib/format'

const compactUsd = (v: number) =>
  `${v < 0 ? '\u2212' : ''}$${Math.abs(v) >= 1000 ? `${(Math.abs(v) / 1000).toFixed(1)}k` : Math.abs(v).toFixed(0)}`

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
      <Card className="border-border bg-card">
        <CardContent className="flex h-72 items-center justify-center p-5">
          <p className="text-sm text-muted-foreground">No closed trades to chart yet</p>
        </CardContent>
      </Card>
    )
  }

  const finalPnl = data[data.length - 1]?.pnl ?? 0
  const isProfit = finalPnl >= 0
  const strokeColor = isProfit ? '#00FF9C' : '#FF4D4D'
  const gradientId = 'pnlGradient'

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Cumulative P&amp;L</h3>
          <span className={`font-mono text-sm font-semibold ${pnlTone(finalPnl)}`}>
            {formatUsd(finalPnl, { signed: true })}
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
              tick={{ fill: '#8A8A94', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#27272A' }}
            />
            <YAxis
              tick={{ fill: '#8A8A94', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#27272A' }}
              tickFormatter={compactUsd}
              width={56}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1C1E26',
                border: '1px solid #27272A',
                borderRadius: '8px',
                color: '#E4E4E7',
                fontSize: 12,
              }}
              formatter={(value) => [formatUsd(Number(value), { signed: true }), 'Cumulative P&L']}
            />
            <ReferenceLine y={0} stroke="#8A8A94" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="pnl"
              stroke={strokeColor}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              animationDuration={300}
            />
          </AreaChart>
        </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
