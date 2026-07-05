'use client'

import { useState } from 'react'
import type { StrategyRuleSet, IndicatorConfig, BoolExpr, TradeManagementRule, StopLossConfig, TakeProfitConfig, PositionSizingConfig, SessionFilter } from '@/lib/types/backtest'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Settings2 } from 'lucide-react'
import { IndicatorConfigEditor } from './indicator-config'
import { ExprEditor } from './expr-editor'

interface RuleBuilderProps {
  rules: StrategyRuleSet
  onChange: (rules: StrategyRuleSet) => void
}

const EMPTY_CONDITION: BoolExpr = { type: 'indicator_cross_above' }
const EMPTY_INDICATOR: IndicatorConfig = { type: 'EMA', params: { period: 14 } }
const EMPTY_TRADE_MANAGEMENT: TradeManagementRule = { type: 'trailing_stop', params: { activation_r: 1.0, trail_pct: 0.5 } }

export function RuleBuilder({ rules, onChange }: RuleBuilderProps) {
  const update = (patch: Partial<StrategyRuleSet>) => {
    onChange({ ...rules, ...patch })
  }

  return (
    <div className="space-y-6">
      {/* Strategy Name & Timeframe */}
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-zinc-400">Strategy Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-zinc-500">Strategy Name</Label>
              <Input
                value={rules.name}
                onChange={(e) => update({ name: e.target.value })}
                className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white"
              />
            </div>
            <div>
              <Label className="text-xs text-zinc-500">Timeframe</Label>
              <Select value={rules.timeframe} onValueChange={(v) => update({ timeframe: v ?? '1D' })}>
                <SelectTrigger className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-zinc-800 bg-[#12141A]">
                  {['1m', '5m', '15m', '30m', '1H', '4H', '1D', '1W', '1M'].map((tf) => (
                    <SelectItem key={tf} value={tf} className="font-mono text-white">{tf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Indicators */}
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-zinc-400">Indicators</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-[#00FF9C] hover:text-[#00FF9C]/80"
              onClick={() => update({ indicators: [...rules.indicators, { ...EMPTY_INDICATOR }] })}
            >
              <Plus className="h-3 w-3" /> Add
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {rules.indicators.map((ind, i) => (
            <IndicatorConfigEditor
              key={i}
              indicator={ind}
              onChange={(updated) => {
                const next = [...rules.indicators]
                next[i] = updated
                update({ indicators: next })
              }}
              onRemove={() => {
                update({ indicators: rules.indicators.filter((_, j) => j !== i) })
              }}
            />
          ))}
          {rules.indicators.length === 0 && (
            <p className="text-xs text-zinc-600 py-2">No indicators added. Add one to get started.</p>
          )}
        </CardContent>
      </Card>

      {/* Entry/Exit Conditions */}
      {(['entry_long', 'entry_short', 'exit_long', 'exit_short'] as const).map((group) => (
        <Card key={group} className="border-zinc-800 bg-[#12141A]">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-zinc-400">
                {group.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Conditions
                <span className="ml-2 text-xs text-zinc-600">All must be met (AND)</span>
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-[#00FF9C] hover:text-[#00FF9C]/80"
                onClick={() => update({ [group]: [...rules[group], { ...EMPTY_CONDITION }] })}
              >
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {rules[group].map((cond, i) => (
              <ExprEditor
                key={i}
                expr={cond}
                indicators={rules.indicators}
                onChange={(updated) => {
                  const next = [...rules[group]]
                  next[i] = updated
                  update({ [group]: next })
                }}
                onRemove={() => {
                  update({ [group]: rules[group].filter((_, j) => j !== i) })
                }}
              />
            ))}
            {rules[group].length === 0 && (
              <p className="text-xs text-zinc-600 py-2">No conditions defined.</p>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Risk Management */}
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-zinc-400 flex items-center gap-2">
            <Settings2 className="h-4 w-4" /> Risk Management
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {/* Stop Loss */}
            <div>
              <Label className="text-xs text-zinc-500">SL Method</Label>
              <Select
                value={rules.stop_loss.method}
                onValueChange={(v) => update({ stop_loss: { ...rules.stop_loss, method: v as StopLossConfig['method'] } })}
              >
                <SelectTrigger className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-zinc-800 bg-[#12141A]">
                  <SelectItem value="fixed_pips" className="text-white">Fixed Pips</SelectItem>
                  <SelectItem value="atr_based" className="text-white">ATR Based</SelectItem>
                  <SelectItem value="swing_low_high" className="text-white">Swing Low/High</SelectItem>
                  <SelectItem value="indicator" className="text-white">Indicator</SelectItem>
                </SelectContent>
              </Select>
              {rules.stop_loss.method === 'fixed_pips' && (
                <Input
                  type="number"
                  value={rules.stop_loss.value ?? ''}
                  onChange={(e) => update({ stop_loss: { ...rules.stop_loss, value: Number(e.target.value) } })}
                  placeholder="Pips"
                  className="mt-2 h-8 border-zinc-800 bg-[#0A0B0E] text-xs text-white"
                />
              )}
              {rules.stop_loss.method === 'atr_based' && (
                <Input
                  type="number"
                  step="0.1"
                  value={rules.stop_loss.atr_multiplier ?? ''}
                  onChange={(e) => update({ stop_loss: { ...rules.stop_loss, atr_multiplier: Number(e.target.value) } })}
                  placeholder="ATR multiplier"
                  className="mt-2 h-8 border-zinc-800 bg-[#0A0B0E] text-xs text-white"
                />
              )}
            </div>

            {/* Take Profit */}
            <div>
              <Label className="text-xs text-zinc-500">TP Method</Label>
              <Select
                value={rules.take_profit.method}
                onValueChange={(v) => update({ take_profit: { ...rules.take_profit, method: v as TakeProfitConfig['method'] } })}
              >
                <SelectTrigger className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-zinc-800 bg-[#12141A]">
                  <SelectItem value="fixed_pips" className="text-white">Fixed Pips</SelectItem>
                  <SelectItem value="risk_reward" className="text-white">Risk:Reward</SelectItem>
                  <SelectItem value="atr_based" className="text-white">ATR Based</SelectItem>
                  <SelectItem value="indicator" className="text-white">Indicator</SelectItem>
                </SelectContent>
              </Select>
              {rules.take_profit.method === 'fixed_pips' && (
                <Input
                  type="number"
                  value={rules.take_profit.value ?? ''}
                  onChange={(e) => update({ take_profit: { ...rules.take_profit, value: Number(e.target.value) } })}
                  placeholder="Pips"
                  className="mt-2 h-8 border-zinc-800 bg-[#0A0B0E] text-xs text-white"
                />
              )}
              {rules.take_profit.method === 'risk_reward' && (
                <Input
                  type="number"
                  step="0.1"
                  value={rules.take_profit.rr_ratio ?? ''}
                  onChange={(e) => update({ take_profit: { ...rules.take_profit, rr_ratio: Number(e.target.value) } })}
                  placeholder="R:R ratio"
                  className="mt-2 h-8 border-zinc-800 bg-[#0A0B0E] text-xs text-white"
                />
              )}
              {rules.take_profit.method === 'atr_based' && (
                <Input
                  type="number"
                  step="0.1"
                  value={rules.take_profit.atr_multiplier ?? ''}
                  onChange={(e) => update({ take_profit: { ...rules.take_profit, atr_multiplier: Number(e.target.value) } })}
                  placeholder="ATR multiplier"
                  className="mt-2 h-8 border-zinc-800 bg-[#0A0B0E] text-xs text-white"
                />
              )}
            </div>

            {/* Risk % & Position Sizing */}
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-zinc-500">Risk per Trade (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={rules.risk_per_trade_pct}
                  onChange={(e) => update({ risk_per_trade_pct: Number(e.target.value) })}
                  className="mt-1.5 h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white"
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-500">Position Sizing</Label>
                <Select
                  value={rules.position_sizing.method}
                  onValueChange={(v) => update({ position_sizing: { ...rules.position_sizing, method: v as PositionSizingConfig['method'] } })}
                >
                  <SelectTrigger className="h-9 border-zinc-800 bg-[#0A0B0E] text-sm text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-[#12141A]">
                    <SelectItem value="fixed_lot" className="text-white">Fixed Lot</SelectItem>
                    <SelectItem value="risk_based" className="text-white">Risk Based</SelectItem>
                    <SelectItem value="percent_equity" className="text-white">Percent Equity</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Session Filter */}
          <div>
            <Label className="text-xs text-zinc-500">Session Filter (optional)</Label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {(['london', 'new_york', 'asian', 'overlap'] as const).map((session) => {
                const active = rules.session_filter?.sessions?.includes(session) ?? false
                return (
                  <Badge
                    key={session}
                    variant="outline"
                    className={`cursor-pointer text-xs ${
                      active ? 'border-[#00FF9C]/30 bg-[#00FF9C]/10 text-[#00FF9C]' : 'border-zinc-700 text-zinc-500'
                    }`}
                    onClick={() => {
                      const current = rules.session_filter?.sessions ?? []
                      const next = active ? current.filter((s) => s !== session) : [...current, session]
                      update({
                        session_filter: next.length > 0
                          ? { sessions: next, alignment: rules.session_filter?.alignment ?? 'entry_only' }
                          : null,
                      })
                    }}
                  >
                    {session.charAt(0).toUpperCase() + session.slice(1)}
                  </Badge>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trade Management */}
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-zinc-400">Trade Management Rules</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-[#00FF9C] hover:text-[#00FF9C]/80"
              onClick={() => update({ trade_management: [...rules.trade_management, { ...EMPTY_TRADE_MANAGEMENT }] })}
            >
              <Plus className="h-3 w-3" /> Add
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {rules.trade_management.map((tm, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-[#0A0B0E] px-3 py-2">
              <Select
                value={tm.type}
                onValueChange={(v) => {
                  const next = [...rules.trade_management]
                  next[i] = { type: v as TradeManagementRule['type'], params: getDefaultTmParams(v ?? '') }
                  update({ trade_management: next })
                }}
              >
                <SelectTrigger className="h-8 w-36 border-zinc-700 bg-transparent text-xs text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-zinc-800 bg-[#12141A]">
                  <SelectItem value="trailing_stop" className="text-white">Trailing Stop</SelectItem>
                  <SelectItem value="break_even" className="text-white">Break Even</SelectItem>
                  <SelectItem value="partial_exit" className="text-white">Partial Exit</SelectItem>
                  <SelectItem value="move_sl_to_entry" className="text-white">Move SL to Entry</SelectItem>
                </SelectContent>
              </Select>
              {Object.entries(tm.params).map(([key, val]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <Label className="text-xs text-zinc-500">{key}</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={val}
                    onChange={(e) => {
                      const next = [...rules.trade_management]
                      next[i] = { ...next[i], params: { ...next[i].params, [key]: Number(e.target.value) } }
                      update({ trade_management: next })
                    }}
                    className="h-8 w-20 border-zinc-700 bg-transparent text-xs text-white"
                  />
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 w-7 p-0 text-zinc-500 hover:text-[#FF4D4D]"
                onClick={() => update({ trade_management: rules.trade_management.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          {rules.trade_management.length === 0 && (
            <p className="text-xs text-zinc-600 py-2">No trade management rules. Strategy will use static SL/TP only.</p>
          )}
        </CardContent>
      </Card>

      {/* Notes */}
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-zinc-400">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            value={rules.notes}
            onChange={(e) => update({ notes: e.target.value })}
            placeholder="Any additional strategy rules, context, or constraints..."
            className="w-full rounded-md border border-zinc-800 bg-[#0A0B0E] p-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
            rows={3}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function getDefaultTmParams(type: string): Record<string, number> {
  switch (type) {
    case 'trailing_stop': return { activation_r: 1.0, trail_pct: 0.5 }
    case 'break_even': return { activation_r: 1.0 }
    case 'partial_exit': return { r_multiple: 2.0, close_pct: 50 }
    case 'move_sl_to_entry': return { activation_r: 1.0 }
    default: return {}
  }
}
