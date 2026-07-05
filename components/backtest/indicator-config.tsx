'use client'

import type { IndicatorConfig, IndicatorType } from '@/lib/types/backtest'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'

const INDICATOR_TYPES: { value: IndicatorType; label: string }[] = [
  { value: 'EMA', label: 'EMA' },
  { value: 'SMA', label: 'SMA' },
  { value: 'RSI', label: 'RSI' },
  { value: 'MACD', label: 'MACD' },
  { value: 'BBANDS', label: 'Bollinger Bands' },
  { value: 'ATR', label: 'ATR' },
  { value: 'STOCH', label: 'Stochastic' },
  { value: 'ADX', label: 'ADX' },
  { value: 'VWAP', label: 'VWAP' },
  { value: 'SWING_POINTS', label: 'Swing Points' },
  { value: 'PREV_DAY_HL', label: 'Previous Day H/L' },
]

/** Default params for each indicator type */
function getDefaultParams(type: IndicatorType): Record<string, number> {
  switch (type) {
    case 'EMA': return { period: 9 }
    case 'SMA': return { period: 20 }
    case 'RSI': return { period: 14 }
    case 'MACD': return { fast: 12, slow: 26, signal: 9 }
    case 'BBANDS': return { period: 20, std_dev: 2 }
    case 'ATR': return { period: 14 }
    case 'STOCH': return { k_period: 14, d_period: 3 }
    case 'ADX': return { period: 14 }
    case 'VWAP': return {}
    case 'SWING_POINTS': return { strength: 3 }
    case 'PREV_DAY_HL': return {}
    default: return {}
  }
}

/** Parameter labels for each indicator type */
const PARAM_LABELS: Record<string, Record<string, string>> = {
  EMA: { period: 'Period' },
  SMA: { period: 'Period' },
  RSI: { period: 'Period' },
  MACD: { fast: 'Fast', slow: 'Slow', signal: 'Signal' },
  BBANDS: { period: 'Period', std_dev: 'Std Dev' },
  ATR: { period: 'Period' },
  STOCH: { k_period: 'K Period', d_period: 'D Period' },
  ADX: { period: 'Period' },
  VWAP: {},
  SWING_POINTS: { strength: 'Strength' },
  PREV_DAY_HL: {},
}

interface IndicatorConfigEditorProps {
  indicator: IndicatorConfig
  onChange: (indicator: IndicatorConfig) => void
  onRemove: () => void
}

export function IndicatorConfigEditor({ indicator, onChange, onRemove }: IndicatorConfigEditorProps) {
  const paramLabels = PARAM_LABELS[indicator.type] ?? {}

  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-[#0A0B0E] px-3 py-2">
      {/* Indicator type */}
      <Select
        value={indicator.type}
        onValueChange={(v) => {
          const newType = v as IndicatorType
          onChange({ type: newType, params: getDefaultParams(newType) })
        }}
      >
        <SelectTrigger className="h-8 w-36 border-zinc-700 bg-transparent text-xs text-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-zinc-800 bg-[#12141A]">
          {INDICATOR_TYPES.map((it) => (
            <SelectItem key={it.value} value={it.value} className="text-xs text-white">
              {it.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Param inputs */}
      {Object.entries(indicator.params).map(([key, val]) => (
        <div key={key} className="flex items-center gap-1.5">
          <Label className="text-xs text-zinc-500">{paramLabels[key] ?? key}</Label>
          <Input
            type="number"
            value={val}
            onChange={(e) => {
              const newVal = Number(e.target.value)
              onChange({ ...indicator, params: { ...indicator.params, [key]: newVal } })
            }}
            className="h-8 w-16 border-zinc-700 bg-transparent text-xs font-mono text-white"
          />
        </div>
      ))}

      {/* Remove button */}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-7 w-7 p-0 text-zinc-500 hover:text-[#FF4D4D]"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
