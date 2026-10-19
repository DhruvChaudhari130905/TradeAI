'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import type { TradeWithScore } from '@/lib/actions/dashboard'

const COLORS: Record<string, string> = {
  Win: '#00FF9C',
  Loss: '#FF4D4D',
  Breakeven: '#F59E0B',
  Open: '#8A8A94',
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
      <Card className="border-border bg-card">
        <CardContent className="flex h-72 items-center justify-center p-5">
          <p className="text-sm text-muted-foreground">No outcome data yet</p>
        </CardContent>
      </Card>
    )
  }

  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-5">
        <h3 className="mb-4 text-sm font-semibold text-foreground">Win / Loss</h3>
        <div className="flex items-center gap-6">
          <div style={{ width: '60%', height: 200, minHeight: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
                dataKey="value"
                animationDuration={300}
                stroke="none"
              >
                {data.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={COLORS[entry.name] || '#8A8A94'}
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
          </div>
          {/* Legend */}
          <div className="flex flex-col gap-3">
            {data.map((entry) => (
              <div key={entry.name} className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: COLORS[entry.name] }}
                />
                <span className="text-xs text-muted-foreground">{entry.name}</span>
                <span className="font-mono text-xs font-semibold text-foreground">
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
