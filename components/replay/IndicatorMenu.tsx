'use client'

// Indicator management popover: add/remove any engine indicator (overlays on
// the price pane or sub-panes), multiple instances with per-instance params.
// Configs persist via session autosave.

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
  ATR: 'ATR',
  STOCH: 'Stochastic',
  ADX: 'ADX',
  VWAP: 'VWAP',
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
    case 'ATR':
    case 'ADX':
      return { period: 14 }
    case 'STOCH':
      return { k_period: 14, d_period: 3 }
    case 'VWAP':
      return {}
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
  if (cfg.type === 'STOCH') {
    return `Stoch ${cfg.params.k_period ?? 14},${cfg.params.d_period ?? 3}`
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
  ATR: [{ key: 'period', label: 'Period' }],
  ADX: [{ key: 'period', label: 'Period' }],
  STOCH: [
    { key: 'k_period', label: '%K period' },
    { key: 'd_period', label: '%D period' },
  ],
  VWAP: [],
}

export function IndicatorMenu({ configs, onChange }: IndicatorMenuProps) {
  const [open, setOpen] = useState(false)

  function addIndicator(type: OverlayIndicatorType) {
    // Duplicates allowed (EMA 20 + EMA 50); each instance gets its own params
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

  const available = Object.keys(LABELS) as OverlayIndicatorType[]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Indicators"
            aria-label="Indicators"
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          />
        }
      >
        <ChartLine className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-64 border-border bg-card p-3">
        <h4 className="mb-2 text-sm font-semibold text-foreground">Indicators</h4>

        {configs.length === 0 && <p className="py-1 text-xs text-muted-foreground">None added</p>}

        <div className="space-y-2">
          {configs.map((cfg) => (
            <div key={cfg.id} className="rounded-md border border-border bg-muted p-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-medium">{indicatorLabel(cfg)}</span>
                <button
                  type="button"
                  title={cfg.visible ? 'Hide' : 'Show'}
                  onClick={() => onChange(configs.map((c) => (c.id === cfg.id ? { ...c, visible: !c.visible } : c)))}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                >
                  {cfg.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>
                <button type="button" title="Remove" onClick={() => removeIndicator(cfg.id)} className="text-muted-foreground hover:text-loss">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {cfg.visible && (
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {NUM_FIELDS[cfg.type].map(({ key, label }) => (
                    <label key={key} className="space-y-0.5">
                      <span className="block text-[11px] text-muted-foreground">{label}</span>
                      <Input
                        type="number"
                        min="1"
                        value={String(cfg.params[key] ?? '')}
                        onChange={(e) => setParam(cfg.id, key, e.target.value)}
                        className="h-6 border-border font-mono text-[11px]"
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
                className="h-6 border-border px-2 text-[11px]">
                <Plus className="mr-0.5 h-3 w-3" /> {LABELS[type]}
              </Button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
