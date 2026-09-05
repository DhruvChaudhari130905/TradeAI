'use client'

// Proactive AI coach: fires unprompted when the session monitor flags a
// notable moment (trade closed, consecutive losses, margin stress). Rate
// limited by a bar-based cooldown and a per-session cap; suggestions land in
// the same chat message list and persist via autosave.

import { useCallback, useEffect, useRef, useState } from 'react'
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
import { buildReplaySnapshot } from './build-replay-snapshot'

const MAX_SUGGESTIONS_PER_SESSION = 5
const COOLDOWN_BARS = 20
const CONSECUTIVE_LOSSES_TRIGGER = 3
const MARGIN_STRESS_RATIO = 0.8

const LOCALSTORAGE_KEY = 'replay-autocoach'

interface ProactiveCoachInput {
  config: ReplaySessionConfig
  activeTf: Timeframe
  cursorIndex: number
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

function countLossStreak(closedTrades: ClosedReplayTrade[]): number {
  let streak = 0
  for (let i = closedTrades.length - 1; i >= 0; i--) {
    if (closedTrades[i].pnlUsd < 0) streak++
    else break
  }
  return streak
}

export function useProactiveCoach(input: ProactiveCoachInput) {
  const [autoCoach, setAutoCoachState] = useState(
    () =>
      typeof window === 'undefined' ||
      window.localStorage.getItem(LOCALSTORAGE_KEY) !== 'off',
  )

  const setAutoCoach = useCallback((on: boolean) => {
    window.localStorage.setItem(LOCALSTORAGE_KEY, on ? 'on' : 'off')
    setAutoCoachState(on)
  }, [])

  const enabledRef = useRef(autoCoach)
  useEffect(() => {
    enabledRef.current = autoCoach
  }, [autoCoach])

  const lastFiredCursor = useRef<number | null>(null)
  const seenTradeKeys = useRef<Set<string> | null>(null)
  const lastLossStreakFired = useRef(0)
  const lastMarginFired = useRef(false)
  const busy = useRef(false)

  const tradeKey = (t: ClosedReplayTrade) => `${t.entryTime}|${t.exitTime}|${t.pnlUsd.toFixed(2)}`

  /** Fire one proactive suggestion. All rate-limit guard checks happen here. */
  const requestSuggestion = useCallback(
    async (trigger: string) => {
      if (!enabledRef.current || busy.current) return
      if (lastFiredCursor.current !== null && input.cursorIndex - lastFiredCursor.current < COOLDOWN_BARS) return
      if (input.chatMessages.filter((m) => m.proactive).length >= MAX_SUGGESTIONS_PER_SESSION) return

      busy.current = true
      lastFiredCursor.current = input.cursorIndex
      try {
        const res = await fetch(`/api/replay/${input.config.id}/suggestions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trigger,
            history: input.chatMessages.slice(-20).map((m) => ({ role: m.role, content: m.content })),
            snapshot: buildReplaySnapshot(input),
          }),
        })
        const body = await res.json().catch(() => null)
        if (res.ok && body?.reply) {
          input.appendChatMessages([
            { role: 'assistant', content: body.reply as string, createdAt: new Date().toISOString(), proactive: true },
          ])
        }
      } catch {
        // Proactive coaching must never disrupt the session — swallow silently
      } finally {
        busy.current = false
      }
    },
    // Rebuilt on every state change so the snapshot it captures is always fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.cursorIndex, input.chatMessages, input.config.id],
  )

  const requestRef = useRef(requestSuggestion)
  useEffect(() => {
    requestRef.current = requestSuggestion
  }, [requestSuggestion])

  useEffect(() => {
    // Initialize seen-trade tracking from already-closed trades (fresh mount or
    // resume) so history never fires retroactively
    if (seenTradeKeys.current === null) {
      seenTradeKeys.current = new Set(input.closedTrades.map(tradeKey))
      lastLossStreakFired.current = countLossStreak(input.closedTrades)
      return
    }

    const newTrades = input.closedTrades.filter((t) => !seenTradeKeys.current!.has(tradeKey(t)))
    for (const t of newTrades) seenTradeKeys.current.add(tradeKey(t))

    const streak = countLossStreak(input.closedTrades)
    const marginStressed = input.equity > 0 && input.marginUsed / input.equity > MARGIN_STRESS_RATIO
    if (!marginStressed) lastMarginFired.current = false

    let trigger: string | null = null
    if (marginStressed && !lastMarginFired.current) {
      lastMarginFired.current = true
      trigger = `Margin stress: margin used ($${input.marginUsed.toFixed(2)}) is over 80% of equity ($${input.equity.toFixed(2)}).`
    } else if (newTrades.length > 0) {
      const last = newTrades[newTrades.length - 1]
      const pnl = last.pnlUsd
      if (last.exitReason === 'stop_out') {
        trigger = `A position was force-closed by STOP OUT: ${last.direction} lost $${Math.abs(pnl).toFixed(2)}.`
      } else if (pnl < 0 && streak >= CONSECUTIVE_LOSSES_TRIGGER && streak > lastLossStreakFired.current) {
        trigger = `${streak} consecutive losing trades this session. Last: ${last.direction} closed $${pnl.toFixed(2)} (${last.exitReason.replace(/_/g, ' ')}).`
      } else {
        trigger = `Trade just closed: ${last.direction} ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${last.exitReason.replace(/_/g, ' ')}). Review the execution.`
      }
    }

    if (trigger !== null && newTrades.length > 0) lastLossStreakFired.current = streak
    if (trigger !== null) void requestRef.current(trigger)
  }, [input.closedTrades, input.equity, input.marginUsed])

  return { autoCoach, setAutoCoach }
}