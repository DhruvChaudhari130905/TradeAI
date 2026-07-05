'use client'

import { useState } from 'react'
import type {
  BoolExpr,
  ValueExpr,
  Condition,
  ConditionType,
  ComparisonOperator,
  PatternName,
  IndicatorConfig,
} from '@/lib/types/backtest'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Plus, Trash2 } from 'lucide-react'
import { ConditionEditor } from './condition-editor'

// ── Expression editor ─────────────────────────────────────────────────────────
// Recursive editor for the BoolExpr DSL. Composites (and/or/not/within/strict/
// prev) get inline controls; structural leaves (cmp/cross_above/cross_below/
// pattern/liquidity_sweep/structure_trend/break_structure) get purpose-built
// UIs; legacy flat `Condition` leaves delegate to the existing ConditionEditor.
// Arithmetic inside ValueExpr (binop/abs) is reached through an "advanced"
// JSON field on each operand — the common compare-series-vs-series / series-
// vs-const case is graphical; full arithmetic stays available but not built as
// a node-graph this pass.

const RESERVED_SERIES = [
  'close', 'open', 'high', 'low',
  'swing_high', 'swing_low', 'prev_swing_high', 'prev_swing_low',
  'prev_day_high', 'prev_day_low', 'prev_day_open',
]

const COMPARISON_OPS: { value: ComparisonOperator; label: string }[] = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'eq', label: '=' },
]

const PATTERNS: { value: PatternName; label: string }[] = [
  { value: 'bullish_engulfing', label: 'Bullish Engulfing' },
  { value: 'bearish_engulfing', label: 'Bearish Engulfing' },
  { value: 'pin_bar', label: 'Pin Bar' },
  { value: 'doji', label: 'Doji' },
  { value: 'hammer', label: 'Hammer' },
  { value: 'fvg_bullish', label: 'FVG Bullish' },
  { value: 'fvg_bearish', label: 'FVG Bearish' },
]

/** Leaf node kinds the add-menu offers (composites are added inline). */
const LEAF_KINDS = [
  { value: 'cmp', label: 'Compare' },
  { value: 'cross_above', label: 'Crosses Above' },
  { value: 'cross_below', label: 'Crosses Below' },
  { value: 'pattern', label: 'Candle Pattern' },
  { value: 'liquidity_sweep', label: 'Liquidity Sweep' },
  { value: 'structure_trend', label: 'Structure Trend' },
  { value: 'break_structure', label: 'Break of Structure' },
  { value: 'legacy', label: 'Legacy Condition' },
] as const

interface ExprEditorProps {
  expr: BoolExpr
  indicators: IndicatorConfig[]
  onChange: (expr: BoolExpr) => void
  onRemove: () => void
}

export function ExprEditor({ expr, indicators, onChange, onRemove }: ExprEditorProps) {
  // Legacy flat `Condition` leaf — render the existing per-field editor.
  if ('type' in expr) {
    return (
      <ConditionEditor
        condition={expr}
        indicators={indicators}
        onChange={(c) => onChange(c)}
        onRemove={onRemove}
      />
    )
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#0A0B0E] px-3 py-2">
      <ExprRow expr={expr} indicators={indicators} onChange={onChange} onRemove={onRemove} />
    </div>
  )
}

// ── Row dispatcher ─────────────────────────────────────────────────────────

function ExprRow({
  expr, indicators, onChange, onRemove,
}: {
  expr: Exclude<BoolExpr, Condition>
  indicators: IndicatorConfig[]
  onChange: (expr: BoolExpr) => void
  onRemove: () => void
}) {
  switch (expr.kind) {
    case 'and':
    case 'or':
      return <CompositeExpr expr={expr} indicators={indicators} onChange={onChange} onRemove={onRemove} />
    case 'not':
      return (
        <UnaryExpr label="NOT" expr={expr.arg} indicators={indicators}
          onChange={(child) => onChange({ kind: 'not', arg: child })} onRemove={onRemove} />
      )
    case 'within':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono text-[#00FF9C]">within</span>
          <Input
            type="number" min={1} value={expr.bars}
            onChange={(e) => onChange({ ...expr, bars: Math.max(1, Number(e.target.value) || 1) })}
            className="h-8 w-16 border-zinc-700 bg-transparent text-xs font-mono text-white"
          />
          <span className="text-xs text-zinc-500">bars:</span>
          <div className="w-full pl-4">
            <ExprEditor expr={expr.expr} indicators={indicators}
              onChange={(child) => onChange({ kind: 'within', expr: child, bars: expr.bars })} onRemove={onRemove} />
          </div>
        </div>
      )
    case 'strict':
      return (
        <UnaryExpr label="STRICT" expr={expr.expr} indicators={indicators}
          onChange={(child) => onChange({ kind: 'strict', expr: child })} onRemove={onRemove} />
      )
    case 'prev':
      return (
        <UnaryExpr label="PREV" expr={expr.expr} indicators={indicators}
          onChange={(child) => onChange({ kind: 'prev', expr: child })} onRemove={onRemove} />
      )
    case 'cmp':
      return (
        <CmpRow expr={expr} indicators={indicators} onChange={onChange} onRemove={onRemove} cross={null} />
      )
    case 'cross_above':
      return <CmpRow expr={expr} indicators={indicators} onChange={onChange} onRemove={onRemove} cross="above" />
    case 'cross_below':
      return <CmpRow expr={expr} indicators={indicators} onChange={onChange} onRemove={onRemove} cross="below" />
    case 'pattern':
      return (
        <LeafShell onRemove={onRemove}>
          <span className="text-xs text-zinc-500">pattern:</span>
          <Select value={expr.name} onValueChange={(v) => onChange({ kind: 'pattern', name: v ?? '' })}>
            <SelectTrigger className="h-8 w-40 border-zinc-700 bg-transparent text-xs text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-[#12141A]">
              {PATTERNS.map((p) => (
                <SelectItem key={p.value} value={p.value} className="text-xs text-white">{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LeafShell>
      )
    case 'liquidity_sweep':
      return <LiquiditySweepRow expr={expr} indicators={indicators} onChange={onChange} onRemove={onRemove} />
    case 'structure_trend':
      return (
        <LeafShell onRemove={onRemove}>
          <span className="text-xs text-zinc-500">trend:</span>
          <Select
            value={expr.mode}
            onValueChange={(v) => onChange({ kind: 'structure_trend', mode: v as 'up' | 'down', strength: expr.strength })}
          >
            <SelectTrigger className="h-8 w-24 border-zinc-700 bg-transparent text-xs text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-[#12141A]">
              <SelectItem value="up" className="text-xs text-white">Uptrend (HH/HL)</SelectItem>
              <SelectItem value="down" className="text-xs text-white">Downtrend (LH/LL)</SelectItem>
            </SelectContent>
          </Select>
        </LeafShell>
      )
    case 'break_structure':
      return <BreakStructureRow expr={expr} indicators={indicators} onChange={onChange} onRemove={onRemove} />
    default:
      return null
  }
}

// ── and / or composite ─────────────────────────────────────────────────────

function CompositeExpr({
  expr, indicators, onChange, onRemove,
}: {
  expr: Extract<BoolExpr, { kind: 'and' | 'or' }>
  indicators: IndicatorConfig[]
  onChange: (expr: BoolExpr) => void
  onRemove: () => void
}) {
  const isAnd = expr.kind === 'and'
  const toggleKind = () => onChange({ kind: isAnd ? 'or' : 'and', args: expr.args })

  const addChild = (leafValue: string) => {
    const newChild = newLeaf(leafValue)
    onChange({ kind: expr.kind, args: [...expr.args, newChild] })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost" size="sm"
          className="h-7 px-2 text-xs font-mono text-[#00FF9C] hover:text-[#00FF9C]/80"
          onClick={toggleKind}
          title="Toggle AND / OR"
        >
          {isAnd ? 'AND' : 'OR'}
        </Button>
        <span className="text-xs text-zinc-600">{expr.args.length} child(ren)</span>
        <AddLeafMenu onAdd={addChild} />
        <Button
          variant="ghost" size="sm"
          className="ml-auto h-7 w-7 p-0 text-zinc-500 hover:text-[#FF4D4D]"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="space-y-2 border-l border-zinc-800 pl-3">
        {expr.args.map((child, i) => (
          <ExprEditor
            key={i} expr={child} indicators={indicators}
            onChange={(updated) => {
              const next = [...expr.args]; next[i] = updated
              onChange({ kind: expr.kind, args: next })
            }}
            onRemove={() => onChange({ kind: expr.kind, args: expr.args.filter((_, j) => j !== i) })}
          />
        ))}
        {expr.args.length === 0 && (
          <p className="text-xs text-zinc-600">Empty {expr.kind} — add a child or this evaluates false.</p>
        )}
      </div>
    </div>
  )
}

// ── not / strict / prev wrapper ────────────────────────────────────────────

function UnaryExpr({
  label, expr, indicators, onChange, onRemove,
}: {
  label: string
  expr: BoolExpr
  indicators: IndicatorConfig[]
  onChange: (expr: BoolExpr) => void
  onRemove: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-[#00FF9C]">{label}</span>
        <Button
          variant="ghost" size="sm"
          className="ml-auto h-7 w-7 p-0 text-zinc-500 hover:text-[#FF4D4D]"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="border-l border-zinc-800 pl-3">
        <ExprEditor expr={expr} indicators={indicators} onChange={onChange} onRemove={onRemove} />
      </div>
    </div>
  )
}

// ── cmp / cross_above / cross_below ────────────────────────────────────────

function CmpRow({
  expr, indicators, onChange, onRemove, cross,
}: {
  expr: Extract<BoolExpr, { kind: 'cmp' | 'cross_above' | 'cross_below' }>
  indicators: IndicatorConfig[]
  onChange: (expr: BoolExpr) => void
  onRemove: () => void
  cross: 'above' | 'below' | null
}) {
  const a = expr.a
  const b = expr.b
  return (
    <LeafShell onRemove={onRemove}>
      <ValueExprEditor
        value={a} indicators={indicators}
        onChange={(v) => onChange({ ...expr, a: v } as BoolExpr)}
      />
      {cross === null ? (
        <Select
          value={expr.kind === 'cmp' ? expr.op : 'gt'}
          onValueChange={(v) => onChange({ kind: 'cmp', op: v as ComparisonOperator, a, b })}
        >
          <SelectTrigger className="h-8 w-14 border-zinc-700 bg-transparent text-xs font-mono text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-zinc-800 bg-[#12141A]">
            {COMPARISON_OPS.map((op) => (
              <SelectItem key={op.value} value={op.value} className="font-mono text-xs text-white">{op.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-xs font-mono text-zinc-400">crosses {cross}</span>
      )}
      <ValueExprEditor
        value={b} indicators={indicators}
        onChange={(v) => onChange({ ...expr, b: v } as BoolExpr)}
      />
    </LeafShell>
  )
}

// ── liquidity_sweep ────────────────────────────────────────────────────────

function LiquiditySweepRow({
  expr, indicators, onChange, onRemove,
}: {
  expr: Extract<BoolExpr, { kind: 'liquidity_sweep' }>
  indicators: IndicatorConfig[]
  onChange: (expr: BoolExpr) => void
  onRemove: () => void
}) {
  return (
    <LeafShell onRemove={onRemove}>
      <span className="text-xs text-zinc-500">sweep</span>
      <Select
        value={expr.side} onValueChange={(v) => onChange({ ...expr, side: v as 'low' | 'high' })}
      >
        <SelectTrigger className="h-8 w-24 border-zinc-700 bg-transparent text-xs text-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-zinc-800 bg-[#12141A]">
          <SelectItem value="low" className="text-xs text-white">Low (bull)</SelectItem>
          <SelectItem value="high" className="text-xs text-white">High (bear)</SelectItem>
        </SelectContent>
      </Select>
      <span className="text-xs text-zinc-500">@</span>
      {expr.level ? (
        <ValueExprEditor value={expr.level} indicators={indicators}
          onChange={(v) => onChange({ ...expr, level: v })} />
      ) : (
        <Button
          variant="ghost" size="sm"
          className="h-8 text-xs text-[#00FF9C] hover:text-[#00FF9C]/80"
          onClick={() => onChange({ ...expr, level: { kind: 'const', value: 0 } })}
        >
          recent swing
        </Button>
      )}
    </LeafShell>
  )
}

// ── break_structure ────────────────────────────────────────────────────────

function BreakStructureRow({
  expr, indicators, onChange, onRemove,
}: {
  expr: Extract<BoolExpr, { kind: 'break_structure' }>
  indicators: IndicatorConfig[]
  onChange: (expr: BoolExpr) => void
  onRemove: () => void
}) {
  return (
    <LeafShell onRemove={onRemove}>
      <span className="text-xs text-zinc-500">BOS</span>
      <Select
        value={expr.side} onValueChange={(v) => onChange({ ...expr, side: v as 'up' | 'down' })}
      >
        <SelectTrigger className="h-8 w-24 border-zinc-700 bg-transparent text-xs text-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-zinc-800 bg-[#12141A]">
          <SelectItem value="up" className="text-xs text-white">Up (bull)</SelectItem>
          <SelectItem value="down" className="text-xs text-white">Down (bear)</SelectItem>
        </SelectContent>
      </Select>
      {expr.swing ? (
        <ValueExprEditor value={expr.swing} indicators={indicators}
          onChange={(v) => onChange({ ...expr, swing: v })} />
      ) : (
        <Button
          variant="ghost" size="sm"
          className="h-8 text-xs text-[#00FF9C] hover:text-[#00FF9C]/80"
          onClick={() => onChange({ ...expr, swing: { kind: 'const', value: 0 } })}
        >
          recent swing
        </Button>
      )}
    </LeafShell>
  )
}

// ── ValueExpr editor (series / const / advanced JSON for binop/abs) ────────

function ValueExprEditor({
  value, indicators, onChange,
}: {
  value: ValueExpr
  indicators: IndicatorConfig[]
  onChange: (v: ValueExpr) => void
}) {
  const [advanced, setAdvanced] = useState(false)

  if (value.kind === 'series') {
    const keys = buildSeriesKeys(indicators)
    return (
      <Select value={value.name} onValueChange={(v) => onChange({ kind: 'series', name: v ?? '' })}>
        <SelectTrigger className="h-8 w-32 border-zinc-700 bg-transparent text-xs font-mono text-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-zinc-800 bg-[#12141A] max-h-64 overflow-y-auto">
          {keys.map((k) => (
            <SelectItem key={k} value={k} className="font-mono text-xs text-white">{k}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (value.kind === 'const') {
    return (
      <Input
        type="number" step="any" value={value.value}
        onChange={(e) => onChange({ kind: 'const', value: Number(e.target.value) || 0 })}
        className="h-8 w-24 border-zinc-700 bg-transparent text-xs font-mono text-white"
      />
    )
  }
  // binop / abs — advanced JSON, since these are composite arithmetic.
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="ghost" size="sm"
        className="h-8 text-xs text-zinc-400"
        onClick={() => setAdvanced((a) => !a)}
      >
        {advanced ? 'hide' : 'edit'} expr
      </Button>
      {advanced && (
        <Input
          defaultValue={JSON.stringify(value)}
          onBlur={(e) => {
            try { onChange(JSON.parse(e.target.value) as ValueExpr) } catch { /* keep on parse err */ }
          }}
          className="h-8 w-64 border-zinc-700 bg-transparent text-xs font-mono text-white"
        />
      )}
    </div>
  )
}

// ── small shared shell ─────────────────────────────────────────────────────

function LeafShell({ onRemove, children }: { onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      <Button
        variant="ghost" size="sm"
        className="ml-auto h-7 w-7 p-0 text-zinc-500 hover:text-[#FF4D4D]"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

function AddLeafMenu({ onAdd }: { onAdd: (leafValue: string) => void }) {
  return (
    <Select value="" onValueChange={(v) => v && onAdd(v)}>
      <SelectTrigger className="h-7 w-28 border-zinc-700 bg-transparent text-xs text-[#00FF9C]">
        <span className="flex items-center gap-1"><Plus className="h-3 w-3" /> Add</span>
      </SelectTrigger>
      <SelectContent className="border-zinc-800 bg-[#12141A]">
        {LEAF_KINDS.map((k) => (
          <SelectItem key={k.value} value={k.value} className="text-xs text-white">{k.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── factories ──────────────────────────────────────────────────────────────

function newLeaf(value: string): BoolExpr {
  switch (value) {
    case 'cmp': return { kind: 'cmp', op: 'gt', a: { kind: 'series', name: 'close' }, b: { kind: 'const', value: 0 } }
    case 'cross_above': return { kind: 'cross_above', a: { kind: 'series', name: 'close' }, b: { kind: 'series', name: 'ema_20' } }
    case 'cross_below': return { kind: 'cross_below', a: { kind: 'series', name: 'close' }, b: { kind: 'series', name: 'ema_20' } }
    case 'pattern': return { kind: 'pattern', name: 'bullish_engulfing' }
    case 'liquidity_sweep': return { kind: 'liquidity_sweep', side: 'low' }
    case 'structure_trend': return { kind: 'structure_trend', mode: 'up' }
    case 'break_structure': return { kind: 'break_structure', side: 'up' }
    case 'legacy': return { type: 'indicator_cross_above', indicator1: 'ema_9', indicator2: 'ema_21' } as Condition
    default: return { kind: 'cmp', op: 'gt', a: { kind: 'series', name: 'close' }, b: { kind: 'const', value: 0 } }
  }
}

// Build the selectable series list: price + reserved level series + every
// indicator key the strategy declares. Mirrors ConditionEditor's key derivation.
function buildSeriesKeys(indicators: IndicatorConfig[]): string[] {
  const keys: string[] = [...RESERVED_SERIES]
  for (const ind of indicators) {
    switch (ind.type) {
      case 'SMA': keys.push(`sma_${ind.params.period ?? 20}`); break
      case 'EMA': keys.push(`ema_${ind.params.period ?? 20}`); break
      case 'RSI': keys.push(`rsi_${ind.params.period ?? 14}`); break
      case 'MACD': keys.push('macd', 'macd_histogram', 'macd_signal'); break
      case 'BBANDS': keys.push('bbands_upper', 'bbands_middle', 'bbands_lower'); break
      case 'ATR': keys.push(`atr_${ind.params.period ?? 14}`); break
      case 'STOCH': keys.push('stoch_k', 'stoch_d'); break
      case 'ADX': keys.push(`adx_${ind.params.period ?? 14}`); break
      case 'VWAP': keys.push('vwap'); break
      case 'PREV_DAY_HL': keys.push('prev_day_high', 'prev_day_low', 'prev_day_open'); break
      case 'SWING_POINTS': keys.push('swing_high', 'swing_low', 'prev_swing_high', 'prev_swing_low'); break
    }
  }
  return [...new Set(keys)]
}
