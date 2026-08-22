'use client'

// Indicator management popover: add/remove EMA, SMA, BBANDS (price pane) and
// RSI, MACD (sub-panes), edit periods. Configs persist via session autosave.

import { useState } from 'react'
import { ChartLine, Eye, EyeOff, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { OverlayIndicatorType, ReplayIndicatorConfig } from '@/lib/types/replay'
import { newId } from '@/lib/replay/simulation'

interface IndicatorMenuProps {
  configs: ReplayIndicatorConfig[]
  onChange: (configs: ReplayIndicatorConfig[]) => void
}

const LABELS: Record<OverlayIndicatorType, string> = {
  EMA: 'EMA',
  SMA: 'SMA',
  BBANDS: 'Bollinger Bands',
  RSI: 'RSI',
  MACD: 'MACD',
}

function defaultParams(type: OverlayIndicatorType): Record<string, number> {
  switch (type) {
    case 'EMA':
    case 'SMA':
      return { period: type === 'EMA' ? 9 : 20 }
    case 'BBANDS':
      return { period: 20, std_dev: 2 }
    case 'RSI':
      return { period: 14 }
    case 'MACD':
      return { fast: 12, slow: 26, signal: 9 }
  }
}

/** Short legend label incl. params, e.g. "EMA 9" or "MACD 12,26,9" */
export function indicatorLabel(cfg: ReplayIndicatorConfig): string {
  if (cfg.type === 'MACD') {
    return `MACD ${cfg.params.fast ?? 12},${cfg.params.slow ?? 26},${cfg.params.signal ?? 9}`
  }
  if (cfg.type === 'BBANDS') {
    return `BB ${cfg.params.period ?? 20},${cfg.params.std_dev ?? 2}`
  }
  return `${cfg.type} ${cfg.params.period ?? ''}`.trim()
}

const NUM_FIELDS: Record<OverlayIndicatorType, { key: string; label: string }[]> = {
  EMA: [{ key: 'period', label: 'Period' }],
  SMA: [{ key: 'period', label: 'Period' }],
  BBANDS: [
    { key: 'period', label: 'Period' },
    { key: 'std_dev', label: 'Std dev' },
  ],
  RSI: [{ key: 'period', label: 'Period' }],
  MACD: [
    { key: 'fast', label: 'Fast' },
    { key: 'slow', label: 'Slow' },
    { key: 'signal', label: 'Signal' },
  ],
}

export function IndicatorMenu({ configs, onChange }: IndicatorMenuProps) {
  const [open, setOpen] = useState(false)

  function addIndicator(type: OverlayIndicatorType) {
    // One instance per type — editing params beats juggling duplicates
    if (configs.some((c) => c.type === type)) return
    onChange([...configs, { id: newId(), type, visible: true, params: defaultParams(type) }])
  }

  function removeIndicator(id: string) {
    onChange(configs.filter((c) => c.id !== id))
  }

  function setParam(id: string, key: string, value: string) {
    const num = parseFloat(value)
    onChange(
      configs.map((c) =>
        c.id === id && Number.isFinite(num) && num > 0 ? { ...c, params: { ...c.params, [key]: num } } : c,
      ),
    )
  }

  const available = (Object.keys(LABELS) as OverlayIndicatorType[]).filter((t) => !configs.some((c) => c.type === t))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Indicators"
            aria-label="Indicators"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-[#1C1E26] hover:text-zinc-100"
          />
        }
      >
        <ChartLine className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-64 border-[#27272A] bg-[#12141A] p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Indicators</h4>

        {configs.length === 0 && <p className="py-1 text-xs text-zinc-600">None added</p>}

        <div className="space-y-2">
          {configs.map((cfg) => (
            <div key={cfg.id} className="rounded-md border border-[#27272A] bg-[#1C1E26] p-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{LABELS[cfg.type]}</span>
                <button
                  type="button"
                  title={cfg.visible ? 'Hide' : 'Show'}
                  onClick={() => onChange(configs.map((c) => (c.id === cfg.id ? { ...c, visible: !c.visible } : c)))}
                  className="ml-auto text-zinc-500 hover:text-zinc-100"
                >
                  {cfg.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>
                <button type="button" title="Remove" onClick={() => removeIndicator(cfg.id)} className="text-zinc-500 hover:text-[#FF4D4D]">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {cfg.visible && (
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {NUM_FIELDS[cfg.type].map(({ key, label }) => (
                    <label key={key} className="space-y-0.5">
                      <span className="block text-[10px] text-zinc-500">{label}</span>
                      <Input
                        type="number"
                        min="1"
                        value={String(cfg.params[key] ?? '')}
                        onChange={(e) => setParam(cfg.id, key, e.target.value)}
                        className="h-6 border-[#27272A] font-mono text-[11px]"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {available.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {available.map((type) => (
              <Button key={type} size="sm" variant="outline" onClick={() => addIndicator(type)}
                className="h-6 border-[#27272A] px-2 text-[11px]">
                <Plus className="mr-0.5 h-3 w-3" /> {LABELS[type]}
              </Button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
