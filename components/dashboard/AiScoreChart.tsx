'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import type { TradeWithScore } from '@/lib/actions/dashboard'

interface AiScoreChartProps {
  trades: TradeWithScore[]
}

export function AiScoreChart({ trades }: AiScoreChartProps) {
  // Only include trades that have AI review scores
  const data = trades
    .filter((t) => t.trade_reviews?.[0]?.composite_score != null)
    .map((t, i) => ({
      index: i + 1,
      time: t.entry_time
        ? new Date(t.entry_time).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
        : `#${i + 1}`,
      score: t.trade_reviews[0].composite_score as number,
    }))

  if (data.length === 0) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="flex h-72 items-center justify-center p-5">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">No AI scores yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Get trades reviewed to see your improvement trend
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const avgScore = data.reduce((s, d) => s + d.score, 0) / data.length

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">AI Score Trend</h3>
          <span className="font-mono text-sm text-muted-foreground">
            avg {avgScore.toFixed(1)}/10
          </span>
        </div>
        <div style={{ height: 240, minHeight: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
            <XAxis
              dataKey="time"
              tick={{ fill: '#8A8A94', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#27272A' }}
            />
            <YAxis
              domain={[0, 10]}
              ticks={[0, 2, 4, 6, 8, 10]}
              tick={{ fill: '#8A8A94', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#27272A' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1C1E26',
                border: '1px solid #27272A',
                borderRadius: '8px',
                color: '#E4E4E7',
                fontSize: 12,
              }}
              formatter={(value) => [`${Number(value).toFixed(1)}/10`, 'AI Score']}
            />
            <ReferenceLine
              y={avgScore}
              stroke="#8B5CF6"
              strokeDasharray="3 3"
              strokeOpacity={0.5}
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke="#8B5CF6"
              strokeWidth={2}
              dot={{ r: 4, fill: '#8B5CF6', strokeWidth: 0 }}
              activeDot={{ r: 6, fill: '#8B5CF6', stroke: '#0A0B0E', strokeWidth: 2 }}
              animationDuration={300}
            />
          </LineChart>
        </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
