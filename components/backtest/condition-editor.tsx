'use client'

import type { Condition, IndicatorConfig, ConditionType } from '@/lib/types/backtest'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'

const CONDITION_TYPES: { value: ConditionType; label: string }[] = [
  { value: 'indicator_cross_above', label: 'Crosses Above' },
  { value: 'indicator_cross_below', label: 'Crosses Below' },
  { value: 'indicator_above', label: 'Indicator Above' },
  { value: 'indicator_below', label: 'Indicator Below' },
  { value: 'price_above', label: 'Price Above' },
  { value: 'price_below', label: 'Price Below' },
  { value: 'rsi_oversold', label: 'RSI Oversold' },
  { value: 'rsi_overbought', label: 'RSI Overbought' },
  { value: 'macd_histogram_positive', label: 'MACD Hist +' },
  { value: 'macd_histogram_negative', label: 'MACD Hist -' },
  { value: 'bb_lower_touch', label: 'BB Lower Touch' },
  { value: 'bb_upper_touch', label: 'BB Upper Touch' },
  { value: 'stoch_oversold', label: 'Stoch Oversold' },
  { value: 'stoch_overbought', label: 'Stoch Overbought' },
  { value: 'atr_above', label: 'ATR Above' },
  { value: 'atr_below', label: 'ATR Below' },
  { value: 'adx_above', label: 'ADX Above' },
  { value: 'adx_below', label: 'ADX Below' },
  { value: 'candle_pattern', label: 'Candle Pattern' },
]

const CANDLE_PATTERNS = ['bullish_engulfing', 'bearish_engulfing', 'pin_bar', 'doji', 'hammer']
const COMPARISON_OPS = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'eq', label: '=' },
]

interface ConditionEditorProps {
  condition: Condition
  indicators: IndicatorConfig[]
  onChange: (condition: Condition) => void
  onRemove: () => void
}

export function ConditionEditor({ condition, indicators, onChange, onRemove }: ConditionEditorProps) {
  // Generate indicator key names from the strategy's indicators
  const indicatorKeys = indicators.map((ind) => {
    switch (ind.type) {
      case 'SMA': return `sma_${ind.params.period ?? 20}`
      case 'EMA': return `ema_${ind.params.period ?? 20}`
      case 'RSI': return `rsi_${ind.params.period ?? 14}`
      case 'MACD': return 'macd'
      case 'BBANDS': return 'bbands'
      case 'ATR': return `atr_${ind.params.period ?? 14}`
      case 'STOCH': return 'stoch'
      case 'ADX': return `adx_${ind.params.period ?? 14}`
      case 'VWAP': return 'vwap'
      case 'PREV_DAY_HL': return 'prev_day'
      case 'SWING_POINTS': return 'swing'
      default: return (ind.type as string).toLowerCase()
    }
  })

  // Reserved price-action / level series always selectable alongside indicators.
  const RESERVED_SERIES = [
    'close', 'open', 'high', 'low',
    'swing_high', 'swing_low', 'prev_swing_high', 'prev_swing_low',
    'prev_day_high', 'prev_day_low', 'prev_day_open',
  ]

  // Flattened list with sub-keys for multi-series indicators
  const allKeys: string[] = []
  for (const key of indicatorKeys) {
    if (key === 'macd') {
      allKeys.push('macd', 'macd_histogram', 'macd_signal')
    } else if (key === 'bbands') {
      allKeys.push('bbands_upper', 'bbands_middle', 'bbands_lower')
    } else if (key === 'stoch') {
      allKeys.push('stoch_k', 'stoch_d')
    } else if (key === 'prev_day') {
      allKeys.push('prev_day_high', 'prev_day_low', 'prev_day_open')
    } else if (key !== 'swing') {
      allKeys.push(key)
    }
  }
  // Append reserved series (levels are auto-computed by the engine on demand;
  // selecting them here is a hint, not a requirement).
  for (const r of RESERVED_SERIES) if (!allKeys.includes(r)) allKeys.push(r)

  const needsIndicator1 = !['candle_pattern', 'macd_histogram_positive', 'macd_histogram_negative', 'bb_lower_touch', 'bb_upper_touch', 'stoch_oversold', 'stoch_overbought'].includes(condition.type)
  const needsIndicator2 = ['indicator_cross_above', 'indicator_cross_below', 'indicator_above', 'indicator_below'].includes(condition.type)
  const needsValue = ['rsi_oversold', 'rsi_overbought', 'atr_above', 'atr_below', 'adx_above', 'adx_below', 'price_above', 'price_below'].includes(condition.type)
  const needsOperator = ['indicator_above', 'indicator_below', 'price_above', 'price_below', 'atr_above', 'atr_below', 'adx_above', 'adx_below'].includes(condition.type)
  const needsPattern = condition.type === 'candle_pattern'

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-[#0A0B0E] px-3 py-2">
      {/* Condition type */}
      <Select
        value={condition.type}
        onValueChange={(v) => onChange({ ...condition, type: v as ConditionType })}
      >
        <SelectTrigger className="h-8 w-full border-zinc-700 bg-transparent text-xs text-white sm:w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-zinc-800 bg-[#12141A] max-h-64 overflow-y-auto">
          {CONDITION_TYPES.map((ct) => (
            <SelectItem key={ct.value} value={ct.value} className="text-xs text-white">
              {ct.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Indicator 1 */}
      {needsIndicator1 && (
        <Select
          value={condition.indicator1 ?? ""}
          onValueChange={(v) => onChange({ ...condition, indicator1: v || undefined })}
        >
          <SelectTrigger className="h-8 w-32 border-zinc-700 bg-transparent text-xs font-mono text-white">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent className="border-zinc-800 bg-[#12141A]">
            {allKeys.map((key) => (
              <SelectItem key={key} value={key} className="font-mono text-xs text-white">
                {key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Operator */}
      {needsOperator && (
        <Select
          value={condition.operator ?? 'gt'}
          onValueChange={(v) => onChange({ ...condition, operator: v as Condition['operator'] })}
        >
          <SelectTrigger className="h-8 w-14 border-zinc-700 bg-transparent text-xs text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-zinc-800 bg-[#12141A]">
            {COMPARISON_OPS.map((op) => (
              <SelectItem key={op.value} value={op.value} className="font-mono text-xs text-white">
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Indicator 2 */}
      {needsIndicator2 && (
        <Select
          value={condition.indicator2 ?? ""}
          onValueChange={(v) => onChange({ ...condition, indicator2: v || undefined })}
        >
          <SelectTrigger className="h-8 w-32 border-zinc-700 bg-transparent text-xs font-mono text-white">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent className="border-zinc-800 bg-[#12141A]">
            {allKeys.map((key) => (
              <SelectItem key={key} value={key} className="font-mono text-xs text-white">
                {key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Value threshold */}
      {needsValue && (
        <Input
          type="number"
          step="0.1"
          value={condition.value ?? ''}
          onChange={(e) => onChange({ ...condition, value: Number(e.target.value) || undefined })}
          placeholder="Value"
          className="h-8 w-20 border-zinc-700 bg-transparent text-xs font-mono text-white"
        />
      )}

      {/* Candle pattern */}
      {needsPattern && (
        <Select
          value={condition.pattern ?? ""}
          onValueChange={(v) => onChange({ ...condition, pattern: v || undefined })}
        >
          <SelectTrigger className="h-8 w-40 border-zinc-700 bg-transparent text-xs text-white">
            <SelectValue placeholder="Pattern" />
          </SelectTrigger>
          <SelectContent className="border-zinc-800 bg-[#12141A]">
            {CANDLE_PATTERNS.map((p) => (
              <SelectItem key={p} value={p} className="text-xs text-white capitalize">
                {p.replace('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Remove button */}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-7 w-7 p-0 text-zinc-500 hover:text-[#FF4D4D] sm:ml-auto"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
