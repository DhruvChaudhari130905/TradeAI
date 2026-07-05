'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import type { TradeWithScore } from '@/lib/actions/dashboard'

const COLORS: Record<string, string> = {
  Win: '#00FF9C',
  Loss: '#FF4D4D',
  Breakeven: '#F59E0B',
  Open: '#71717A',
}

interface WinLossChartProps {
  trades: TradeWithScore[]
}

export function WinLossChart({ trades }: WinLossChartProps) {
  const counts = trades.reduce<Record<string, number>>(
    (acc, t) => {
      const key =
        t.outcome === 'win'
          ? 'Win'
          : t.outcome === 'loss'
            ? 'Loss'
            : t.outcome === 'breakeven'
              ? 'Breakeven'
              : 'Open'
      acc[key] = (acc[key] || 0) + 1
      return acc
    },
    {},
  )

  const data = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }))

  if (data.length === 0) {
    return (
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardContent className="flex h-72 items-center justify-center p-6">
          <p className="text-sm text-zinc-500">No outcome data yet</p>
        </CardContent>
      </Card>
    )
  }

  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <Card className="border-zinc-800 bg-[#12141A]">
      <CardContent className="p-6">
        <h3 className="mb-4 text-sm font-semibold text-white">Win / Loss</h3>
        <div className="flex items-center gap-6">
          <ResponsiveContainer width="60%" height={200}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
                dataKey="value"
                animationDuration={800}
                stroke="none"
              >
                {data.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={COLORS[entry.name] || '#71717A'}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1C1E26',
                  border: '1px solid #27272A',
                  borderRadius: '8px',
                  color: '#E4E4E7',
                  fontSize: 12,
                }}
                formatter={(value, name) => [
                  `${value} (${((Number(value) / total) * 100).toFixed(0)}%)`,
                  String(name),
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Legend */}
          <div className="flex flex-col gap-3">
            {data.map((entry) => (
              <div key={entry.name} className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: COLORS[entry.name] }}
                />
                <span className="text-xs text-zinc-400">{entry.name}</span>
                <span className="font-mono text-xs font-semibold text-white">
                  {entry.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
