'use client'

// Central replay session state: updates over one state object, candles kept in
// a ref (too big for state), debounced autosave to Supabase.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  Candle,
  ChatMessage,
  ClosedReplayTrade,
  DrawingShape,
  EquityPoint,
  PendingOrder,
  ReplayIndicatorConfig,
  ReplayPosition,
  Timeframe,
} from '@/lib/types/replay'
import {
  closeLots,
  modifyOrder as simModifyOrder,
  modifyPosition,
  newId,
  openMarketPosition,
  placeOrder,
  cancelOrder as simCancelOrder,
  processBar,
  type SimBar,
  type SimConfig,
  type SimState,
} from '@/lib/replay/simulation'
import { fillPrice, floatingPnl, usedMargin } from '@/lib/replay/execution'
import { recordClosedTrade, saveReplayState } from '@/lib/actions/replay'
import { visibleHigherTfCandles } from '@/lib/replay/time'

export interface ReplaySessionConfig {
  id: string
  pair: string
  market: 'forex' | 'crypto'
  leverage: number
  spreadPips: number
  startingBalance: number
  timeframes: Timeframe[]
}

export interface ResumeState {
  cursorIndex: number
  balance: number
  positions: ReplayPosition[]
  orders: PendingOrder[]
  drawings: DrawingShape[]
  indicatorConfigs: ReplayIndicatorConfig[]
  closedTrades: ClosedReplayTrade[]
  equityCurve: EquityPoint[]
  chatMessages: ChatMessage[]
}

export interface ReplayUiState extends SimState {
  playing: boolean
  speed: number // bars per second
  activeTf: Timeframe
  drawings: DrawingShape[]
  indicatorConfigs: ReplayIndicatorConfig[]
  chatMessages: ChatMessage[]
  equityCurve: EquityPoint[]
}

export interface ReplayNotice {
  id: number
  text: string
}

const AUTOSAVE_DEBOUNCE_MS = 1500

function toSimBar(c: Candle): SimBar {
  return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }
}

export function useReplaySession(
  config: ReplaySessionConfig,
  candlesByTf: Record<string, Candle[]>,
  resume: ResumeState | null,
) {
  const primaryTf = config.timeframes[0]
  const primaryCandles = candlesByTf[primaryTf] ?? []

  const simConfig = useMemo<SimConfig>(
    () => ({ pair: config.pair, market: config.market, leverage: config.leverage, spreadPips: config.spreadPips }),
    [config],
  )
  const primaryRef = useRef(primaryCandles)
  useEffect(() => {
    primaryRef.current = primaryCandles
  }, [primaryCandles])

  const [state, setState] = useState<ReplayUiState>(() => ({
    cursorIndex: resume?.cursorIndex ?? Math.min(100, Math.max(0, primaryCandles.length - 1)),
    balance: resume?.balance ?? config.startingBalance,
    positions: resume?.positions ?? [],
    orders: resume?.orders ?? [],
    closedTrades: resume?.closedTrades ?? [],
    playing: false,
    speed: 2,
    activeTf: primaryTf,
    drawings: resume?.drawings ?? [],
    indicatorConfigs: resume?.indicatorConfigs ?? [],
    chatMessages: resume?.chatMessages ?? [],
    equityCurve: resume?.equityCurve ?? [],
  }))

  const [notices, setNotices] = useState<ReplayNotice[]>([])
  const noticeId = useRef(0)
  const pushNotices = useCallback((texts: string[]) => {
    if (texts.length === 0) return
    setNotices((prev) => {
      const next = [...prev]
      for (const text of texts) {
        noticeId.current += 1
        next.push({ id: noticeId.current, text })
      }
      return next.slice(-4)
    })
  }, [])

  /** Journal insert for a newly fully-closed trade; stamps the returned id.
   *  Deferred past the current render: callers invoke this inside setState
   *  updaters, and the action's revalidatePath must not touch the router
   *  mid-render. */
  const recordToJournal = useCallback(
    (trade: ClosedReplayTrade) => {
      setTimeout(() => {
        void (async () => {
        try {
          const res = await recordClosedTrade({
            sessionId: config.id,
            pair: config.pair,
            market: config.market,
            direction: trade.direction,
            entryPrice: trade.entryPrice,
            exitPrice: trade.exitPrice,
            stopLoss: trade.stopLoss,
            takeProfit: trade.takeProfit,
            lotSize: trade.lotSize,
            pnlUsd: trade.pnlUsd,
            pnlPips: trade.pnlPips,
            entryTime: trade.entryTime,
            exitTime: trade.exitTime,
          })
          if (res.success) {
            setState((cur) => ({
              ...cur,
              closedTrades: cur.closedTrades.map((t) =>
                t.id === trade.id ? { ...t, journalTradeId: res.data.tradeId } : t,
              ),
            }))
          }
          } catch {
            // Journal insert failure must not break replay; autosave keeps the
            // trade in closed_trades so it can be re-recorded later.
          }
        })()
      }, 0)
    },
    [config],
  )

  // ── Step ──

  const step = useCallback(() => {
    setState((prev) => {
      const candles = primaryRef.current
      const nextIndex = prev.cursorIndex + 1
      if (nextIndex >= candles.length) {
        return { ...prev, playing: false }
      }

      const previousCount = prev.closedTrades.length
      const outcome = processBar(prev, toSimBar(candles[nextIndex]), simConfig)
      pushNotices(outcome.events)
      for (const trade of outcome.closedTrades.slice(previousCount)) {
        recordToJournal(trade)
      }

      return {
        ...outcome,
        playing: nextIndex < candles.length - 1 ? prev.playing : false,
        speed: prev.speed,
        activeTf: prev.activeTf,
        drawings: prev.drawings,
        indicatorConfigs: prev.indicatorConfigs,
        chatMessages: prev.chatMessages,
        equityCurve: [...prev.equityCurve, outcome.equityPoint],
      }
    })
  }, [simConfig, pushNotices, recordToJournal])

  // ── Play clock ──

  useEffect(() => {
    if (!state.playing) return
    const intervalMs = Math.max(50, Math.round(1000 / state.speed))
    const timer = setInterval(step, intervalMs)
    return () => clearInterval(timer)
  }, [state.playing, state.speed, step])

  const setPlaying = useCallback((playing: boolean) => setState((p) => ({ ...p, playing })), [])
  const setSpeed = useCallback((speed: number) => setState((p) => ({ ...p, speed })), [])
  const setActiveTf = useCallback((tf: Timeframe) => setState((p) => ({ ...p, activeTf: tf })), [])

  // ── Trading actions ──

  const placeMarket = useCallback(
    (side: 'buy' | 'sell', lots: number, stopLoss: number | null, takeProfit: number | null) => {
      setState((prev) => {
        const bar = primaryRef.current[prev.cursorIndex]
        if (!bar) return prev
        const res = openMarketPosition(prev, side, lots, toSimBar(bar), simConfig, stopLoss, takeProfit)
        if (res.event) toast.error(res.event)
        return { ...prev, ...res.state }
      })
    },
    [simConfig],
  )

  const placePending = useCallback(
    (order: Omit<PendingOrder, 'id' | 'createdAt'>) => {
      setState((prev) => {
        const bar = primaryRef.current[prev.cursorIndex]
        if (!bar) return prev
        return { ...prev, ...placeOrder(prev, order, toSimBar(bar)) }
      })
    },
    [],
  )

  const cancelOrder = useCallback((orderId: string) => {
    setState((prev) => ({ ...prev, ...simCancelOrder(prev, orderId) }))
  }, [])

  const modifyPositionFields = useCallback(
    (positionId: string, patch: Partial<Pick<ReplayPosition, 'stopLoss' | 'takeProfit' | 'trailingStopPips' | 'breakEvenMoved'>>) => {
      setState((prev) => ({ ...prev, ...modifyPosition(prev, positionId, patch) }))
    },
    [],
  )

  const modifyOrderFields = useCallback(
    (orderId: string, patch: Partial<Pick<PendingOrder, 'stopLoss' | 'takeProfit' | 'price'>>) => {
      setState((prev) => ({ ...prev, ...simModifyOrder(prev, orderId, patch) }))
    },
    [],
  )

  const closePositionFull = useCallback(
    (positionId: string) => {
      setState((prev) => {
        const bar = primaryRef.current[prev.cursorIndex]
        const position = prev.positions.find((p) => p.id === positionId)
        if (!bar || !position) return prev
        const side = position.direction === 'long' ? 'sell' : 'buy'
        const exitFill = fillPrice(side, bar.close, simConfig.pair, simConfig.market, simConfig.spreadPips)
        const res = closeLots(prev, positionId, position.lotSize, side, exitFill, bar.time, simConfig, 'manual')
        pushNotices(res.event ? [res.event] : [])
        if (res.closed && !res.closed.journalTradeId) recordToJournal(res.closed)
        return { ...prev, ...res.state }
      })
    },
    [simConfig, pushNotices, recordToJournal],
  )

  const partialClosePosition = useCallback(
    (positionId: string, lots: number) => {
      setState((prev) => {
        const bar = primaryRef.current[prev.cursorIndex]
        const position = prev.positions.find((p) => p.id === positionId)
        if (!bar || !position) return prev
        const side = position.direction === 'long' ? 'sell' : 'buy'
        const exitFill = fillPrice(side, bar.close, simConfig.pair, simConfig.market, simConfig.spreadPips)
        const res = closeLots(prev, positionId, lots, side, exitFill, bar.time, simConfig, 'manual')
        pushNotices(res.event ? [res.event] : [])
        return { ...prev, ...res.state }
      })
    },
    [simConfig, pushNotices],
  )

  // ── Drawings / indicators / chat ──

  const setDrawings = useCallback((drawings: DrawingShape[]) => setState((p) => ({ ...p, drawings })), [])
  const setIndicatorConfigs = useCallback((configs: ReplayIndicatorConfig[]) => setState((p) => ({ ...p, indicatorConfigs: configs })), [])
  const appendChatMessages = useCallback((messages: ChatMessage[]) => setState((p) => ({ ...p, chatMessages: [...p.chatMessages, ...messages] })), [])

  // ── Derived data ──

  /** Candles visible at the current cursor on the ACTIVE timeframe (no future leak) */
  const visibleCandles = useMemo(() => {
    const tf = state.activeTf
    const all = candlesByTf[tf] ?? []
    if (tf === primaryTf) return all.slice(0, state.cursorIndex + 1)
    const primaryBar = primaryCandles[state.cursorIndex]
    if (!primaryBar) return []
    return visibleHigherTfCandles(all, tf, primaryBar.time)
  }, [state.activeTf, state.cursorIndex, candlesByTf, primaryTf, primaryCandles])

  const currentBar = primaryCandles[state.cursorIndex] ?? null

  const floatingTotal = useMemo(() => {
    if (!currentBar) return 0
    return state.positions.reduce(
      (sum, p) => sum + floatingPnl(p, currentBar.close, config.pair, config.market),
      0,
    )
  }, [state.positions, currentBar, config])

  const marginUsed = useMemo(() => usedMargin(state.positions, config.leverage, config.market), [state.positions, config])

  const equity = state.balance + floatingTotal

  // ── Autosave ──

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  /** Persist current state immediately */
  const flushSave = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const snapshot = stateRef.current
    try {
      const res = await saveReplayState({
        sessionId: config.id,
        cursorIndex: snapshot.cursorIndex,
        balance: snapshot.balance,
        positions: snapshot.positions,
        orders: snapshot.orders,
        drawings: snapshot.drawings,
        indicatorConfigs: snapshot.indicatorConfigs,
        closedTrades: snapshot.closedTrades,
        equityCurve: snapshot.equityCurve.slice(-5000),
        chatMessages: snapshot.chatMessages.slice(-200),
      })
      if (!res.success) console.warn('[replay-autosave]', res.error)
      return res.success
    } catch {
      return false
    }
  }, [config])

  // Debounced save whenever persisted slices change (skips the very first mount)
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void flushSave()
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [
    state.cursorIndex, state.balance, state.positions, state.orders, state.drawings,
    state.indicatorConfigs, state.closedTrades, state.equityCurve, state.chatMessages,
    flushSave,
  ])

  return {
    state,
    notices,
    step,
    setPlaying,
    setSpeed,
    setActiveTf,
    placeMarket,
    placePending,
    cancelOrder,
    modifyPositionFields,
    modifyOrderFields,
    closePositionFull,
    partialClosePosition,
    setDrawings,
    setIndicatorConfigs,
    appendChatMessages,
    visibleCandles,
    currentBar,
    equity,
    marginUsed,
    flushSave,
    primaryTf,
    hasMoreBars: state.cursorIndex < primaryCandles.length - 1,
  }
}

export type { ClosedReplayTrade, PendingOrder, ReplayPosition }
export { newId }
