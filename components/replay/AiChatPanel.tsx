'use client'

// Real-time AI coach chat. Builds a live session snapshot each send so the
// model always sees the current chart state; history persisted by autosave.

import { useRef, useState } from 'react'
import { Loader2, SendHorizonal, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type {
  Candle,
  ChatMessage,
  ClosedReplayTrade,
  DrawingShape,
  PendingOrder,
  ReplayIndicatorConfig,
  ReplayPosition,
  Timeframe,
} from '@/lib/types/replay'
import type { ReplaySessionConfig } from './use-replay-session'
import { computeIndicators, type IndicatorSeries } from '@/lib/replay/indicators'
import { buildReplayContext, type ReplayContextSnapshot } from '@/lib/nim/build-replay-context'

interface AiChatPanelProps {
  config: ReplaySessionConfig
  activeTf: Timeframe
  visibleCandles: Candle[]
  positions: ReplayPosition[]
  orders: PendingOrder[]
  balance: number
  equity: number
  marginUsed: number
  freeMargin: number
  indicatorConfigs: ReplayIndicatorConfig[]
  drawings: DrawingShape[]
  closedTrades: ClosedReplayTrade[]
  chatMessages: ChatMessage[]
  appendChatMessages: (messages: ChatMessage[]) => void
}

function priceDigits(pair: string, market: 'forex' | 'crypto'): number {
  return market === 'crypto' ? 2 : pair.includes('JPY') ? 3 : 5
}

/** Current value of one configured indicator, or null when not computable */
function currentValue(
  cfg: ReplayIndicatorConfig,
  results: Map<string, number[] | IndicatorSeries>,
): number | null {
  let series: number[] | undefined
  if (cfg.type === 'EMA' || cfg.type === 'SMA') {
    series = results.get(`${cfg.type.toLowerCase()}_${cfg.params.period ?? (cfg.type === 'EMA' ? 9 : 20)}`) as number[] | undefined
  } else if (cfg.type === 'RSI') {
    series = results.get(`rsi_${cfg.params.period ?? 14}`) as number[] | undefined
  } else if (cfg.type === 'MACD') {
    series = (results.get('macd') as IndicatorSeries | undefined)?.macd
  } else if (cfg.type === 'BBANDS') {
    series = (results.get('bbands') as IndicatorSeries | undefined)?.middle
  }
  if (!series || series.length === 0) return null
  const last = series[series.length - 1]
  return Number.isFinite(last) ? last : null
}

function drawingSummary(d: DrawingShape, digits: number): string {
  const p = (n: number) => n.toFixed(digits)
  switch (d.kind) {
    case 'hline':
      return `hline ${p(d.points[0].price)}`
    case 'vline':
      return `vline ${d.points[0].time.slice(0, 16)}`
    case 'trendline':
      return `trendline ${p(d.points[0].price)} to ${p(d.points[1].price)}`
    case 'rect':
      return `zone ${p(Math.min(d.points[0].price, d.points[1].price))}-${p(Math.max(d.points[0].price, d.points[1].price))}`
    case 'fib':
      return `fib ${p(Math.max(d.points[0].price, d.points[1].price))} to ${p(Math.min(d.points[0].price, d.points[1].price))}`
    default:
      return d.label ?? d.kind
  }
}

export function AiChatPanel({
  config,
  activeTf,
  visibleCandles,
  positions,
  orders,
  balance,
  equity,
  marginUsed,
  freeMargin,
  indicatorConfigs,
  drawings,
  closedTrades,
  chatMessages,
  appendChatMessages,
}: AiChatPanelProps) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  function buildSnapshot(): ReplayContextSnapshot {
    const digits = priceDigits(config.pair, config.market)
    const visibleConfigs = indicatorConfigs.filter((c) => c.visible)
    const results =
      visibleConfigs.length > 0
        ? computeIndicators(
            visibleCandles,
            visibleConfigs.map((c) => ({ type: c.type, params: c.params })),
          )
        : new Map()

    return {
      pair: config.pair,
      market: config.market,
      activeTimeframe: activeTf,
      currentTime: visibleCandles[visibleCandles.length - 1]?.time ?? '',
      balance,
      equity,
      marginUsed,
      freeMargin,
      leverage: config.leverage,
      spreadPips: config.spreadPips,
      recentCandles: visibleCandles.slice(-60),
      indicators: visibleConfigs.map((c) => ({ label: `${c.type}`, value: currentValue(c, results) })),
      positions,
      pendingOrders: orders,
      closedTradeCount: closedTrades.length,
      recentClosedTrades: closedTrades.slice(-5).map((t) => ({
        direction: t.direction,
        pnlUsd: t.pnlUsd,
        pnlPips: t.pnlPips,
        exitReason: t.exitReason,
      })),
      drawingsSummary: drawings.map((d) => drawingSummary(d, digits)),
    }
  }

  async function send() {
    const message = input.trim()
    if (!message || sending) return

    setInput('')
    setSending(true)
    try {
      const res = await fetch(`/api/replay/${config.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: chatMessages.slice(-20).map((m) => ({ role: m.role, content: m.content })),
          snapshot: buildSnapshot(),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(body?.error ?? 'AI coach unavailable.')
        return
      }
      appendChatMessages([
        { role: 'user', content: message, createdAt: new Date().toISOString() },
        { role: 'assistant', content: body.reply, createdAt: new Date().toISOString() },
      ])
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
    } catch {
      toast.error('Could not reach the AI coach.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1 pr-1">
        <div ref={scrollRef} className="space-y-3">
          {chatMessages.length === 0 && (
            <p className="py-4 text-center text-xs text-zinc-600">
              Ask about your setup, risk, or what you see on the chart.
            </p>
          )}
          {chatMessages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={`max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#00FF9C]/10 text-zinc-100'
                    : 'bg-[#1C1E26] text-zinc-300'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Coach is thinking…
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="mt-2 flex shrink-0 items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="Ask the coach…"
          rows={2}
          className="min-h-0 resize-none border-[#27272A] bg-[#1C1E26] text-xs"
        />
        <Button size="icon" onClick={() => void send()} disabled={sending || input.trim().length === 0}
          className="h-9 w-9 shrink-0 bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90">
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export function AiChatPanelHeader() {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Sparkles className="h-3.5 w-3.5 text-[#00FF9C]" />
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">AI Coach</h3>
    </div>
  )
}
