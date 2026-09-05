'use client'

// Real-time AI coach chat. Builds a live session snapshot each send so the
// model always sees the current chart state; history persisted by autosave.

import { useRef, useState } from 'react'
import { SendHorizonal, Sparkles, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type { ChatMessage } from '@/lib/types/replay'
import type { ReplaySessionConfig } from './use-replay-session'
import { buildReplaySnapshot } from './build-replay-snapshot'
import type { ReplayContextSnapshot } from '@/lib/nim/build-replay-context'

interface AiChatPanelProps {
  config: ReplaySessionConfig
  activeTf: AiChatPanelSnapshotArgs['activeTf']
  visibleCandles: AiChatPanelSnapshotArgs['visibleCandles']
  positions: AiChatPanelSnapshotArgs['positions']
  orders: AiChatPanelSnapshotArgs['orders']
  balance: AiChatPanelSnapshotArgs['balance']
  equity: AiChatPanelSnapshotArgs['equity']
  marginUsed: AiChatPanelSnapshotArgs['marginUsed']
  freeMargin: AiChatPanelSnapshotArgs['freeMargin']
  indicatorConfigs: AiChatPanelSnapshotArgs['indicatorConfigs']
  drawings: AiChatPanelSnapshotArgs['drawings']
  closedTrades: AiChatPanelSnapshotArgs['closedTrades']
  chatMessages: ChatMessage[]
  appendChatMessages: (messages: ChatMessage[]) => void
  autoCoach?: boolean
  onToggleAutoCoach?: () => void
}

type AiChatPanelSnapshotArgs = Parameters<typeof buildReplaySnapshot>[0]

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
  autoCoach,
  onToggleAutoCoach,
}: AiChatPanelProps) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streamingText, setStreamingText] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  function buildSnapshot(): ReplayContextSnapshot {
    return buildReplaySnapshot({
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
    })
  }

  async function send() {
    const message = input.trim()
    if (!message || sending) return

    setInput('')
    setSending(true)
    // Echo the user's message immediately; the assistant reply streams in below
    appendChatMessages([{ role: 'user', content: message, createdAt: new Date().toISOString() }])
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
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null)
        toast.error(body?.error ?? 'AI coach unavailable.')
        return
      }

      // Stream SSE deltas into a live bubble; commit once complete so autosave
      // only ever persists the finished message.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      let buffer = ''
      setStreamingText('')
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let idx: number
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            if (!frame.startsWith('data: ')) continue
            const payload = frame.slice(6)
            if (payload === '[DONE]') continue
            try {
              acc += (JSON.parse(payload) as { delta?: string }).delta ?? ''
              setStreamingText(acc)
            } catch {
              // Malformed frame — skip it
            }
          }
        }
      } finally {
        setStreamingText(null)
        reader.releaseLock()
      }

      if (acc.trim()) {
        appendChatMessages([
          { role: 'assistant', content: acc.trim(), createdAt: new Date().toISOString() },
        ])
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
      } else {
        toast.error('AI coach unavailable. Try again.')
      }
    } catch {
      toast.error('Could not reach the AI coach.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AiChatPanelHeader
        autoCoach={autoCoach}
        onToggleAutoCoach={onToggleAutoCoach}
        active={sending || streamingText !== null}
      />
      <ScrollArea className="mt-2 min-h-0 flex-1 pr-1">
        <div ref={scrollRef} className="space-y-3">
          {chatMessages.length === 0 && (
            <p className="py-4 text-center text-xs text-zinc-600">
              Ask about your setup, risk, or what you see on the chart — the coach also chimes in on its own after notable moments.
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
                {m.proactive && (
                  <span className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#00FF9C]/70">
                    <Zap className="h-3 w-3" /> Coach suggestion
                  </span>
                )}
                {m.content}
              </div>
            </div>
          ))}
          {sending && streamingText === null && (
            <div className="flex items-center gap-1.5 px-1 py-2" role="status" aria-label="Coach is thinking">
              <span className="coach-dot inline-block h-1.5 w-1.5 rounded-full bg-[#00FF9C]" />
              <span className="coach-dot inline-block h-1.5 w-1.5 rounded-full bg-[#00FF9C]" style={{ animationDelay: '0.15s' }} />
              <span className="coach-dot inline-block h-1.5 w-1.5 rounded-full bg-[#00FF9C]" style={{ animationDelay: '0.3s' }} />
              <span className="ml-1 text-xs text-zinc-500">Coach is thinking…</span>
            </div>
          )}
          {streamingText !== null && (
            <div className="flex justify-start">
              <div className="coach-glow max-w-[90%] whitespace-pre-wrap rounded-lg bg-[#1C1E26] px-3 py-2 text-xs leading-relaxed">
                <span className={streamingText ? 'coach-shimmer' : 'text-zinc-300'}>
                  {streamingText || '…'}
                </span>
                <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-[#00FF9C]/70 align-middle" />
              </div>
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

export function AiChatPanelHeader({
  autoCoach,
  onToggleAutoCoach,
  active = false,
}: {
  autoCoach?: boolean
  onToggleAutoCoach?: () => void
  /** True while the coach is thinking or streaming — pulses the sparkle */
  active?: boolean
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Sparkles
        className={`h-3.5 w-3.5 text-[#00FF9C] ${active ? 'animate-pulse' : ''}`}
      />
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">AI Coach</h3>
      {onToggleAutoCoach && (
        <button
          type="button"
          role="switch"
          aria-checked={autoCoach}
          aria-label="Auto-coach: proactive suggestions"
          onClick={onToggleAutoCoach}
          className={`ml-auto flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
            autoCoach
              ? 'border-[#00FF9C]/40 bg-[#00FF9C]/10 text-[#00FF9C]'
              : 'border-[#27272A] text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Zap className="h-3 w-3" />
          Auto-coach {autoCoach ? 'on' : 'off'}
        </button>
      )}
    </div>
  )
}
