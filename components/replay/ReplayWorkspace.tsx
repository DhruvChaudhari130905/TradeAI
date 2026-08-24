'use client'

// Root replay layout: account strip, transport controls, chart, right rail
// (desktop) / bottom sheet (mobile).

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Keyboard, LogOut, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChartPanel } from './ChartPanel'
import { ReplayControls } from './ReplayControls'
import { TradingPanel } from './TradingPanel'
import { PositionsPanel } from './PositionsPanel'
import { DrawToolbar } from './DrawToolbar'
import { IndicatorMenu } from './IndicatorMenu'
import { AiChatPanel, AiChatPanelHeader } from './AiChatPanel'
import type { DrawTool } from './DrawingOverlay'
import type { SlTpPatch } from './SlTpOverlay'
import { useOrderSizing } from './use-order-sizing'
import { useReplayHotkeys } from './use-replay-hotkeys'
import {
  useReplaySession,
  type ReplaySessionConfig,
  type ResumeState,
} from './use-replay-session'
import type { Candle, DrawingShape } from '@/lib/types/replay'
import { pipSize } from '@/lib/replay/execution'
import { computeIndicators } from '@/lib/replay/indicators'
import { endReplaySession } from '@/lib/actions/replay'
import { ConfirmDialog } from './ConfirmDialog'

const SAVE_STATUS_STYLES: Record<'saved' | 'saving' | 'error', { label: string; text: string }> = {
  saved: { label: 'saved', text: 'text-zinc-500' },
  saving: { label: 'saving…', text: 'text-zinc-400' },
  error: { label: 'save failed', text: 'text-[#FF4D4D]' },
}

interface ReplayWorkspaceProps {
  config: ReplaySessionConfig
  candlesByTf: Record<string, Candle[]>
  resume: ResumeState | null
}

export function ReplayWorkspace({ config, candlesByTf, resume }: ReplayWorkspaceProps) {
  const router = useRouter()
  const [ending, setEnding] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeTool, setActiveTool] = useState<DrawTool | null>(null)
  const [showDrawings, setShowDrawings] = useState(true)
  // Order-form draft levels (string form for the inputs; chart lines drag these too)
  const [draftSl, setDraftSl] = useState('')
  const [draftTp, setDraftTp] = useState('')
  // Trade hotkeys start disarmed; a stray B/S/C must never move capital
  // uninvited. Armed state persists per browser so power users can leave it on.
  // Read lazily (not in an effect) so the first render already reflects it.
  const [tradeKeysArmed, setTradeKeysArmed] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem('replay-trade-keys') === 'armed',
  )
  const [showHotkeyHelp, setShowHotkeyHelp] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  function toggleTradeKeys() {
    setTradeKeysArmed((v) => {
      window.localStorage.setItem('replay-trade-keys', v ? 'disarmed' : 'armed')
      return !v
    })
  }
  const session = useReplaySession(config, candlesByTf, resume)

  function addDrawing(shape: DrawingShape) {
    setActiveTool(null)
    session.setDrawings([...session.state.drawings, shape])
  }

  const currentPrice = session.currentBar?.close ?? null
  const sizing = useOrderSizing(config.pair, config.market, session.equity)

  /** ATR(14) of the visible primary candles — null until enough bars exist */
  function currentAtr(): number | null {
    const values = computeIndicators(session.visibleCandles, [{ type: 'ATR', params: { period: 14 } }]).get('atr_14') as number[] | undefined
    if (!values) return null
    for (let i = values.length - 1; i >= 0; i--) {
      if (Number.isFinite(values[i])) return values[i]
    }
    return null
  }

  /** ATR-based protective levels so a position is never left naked */
  function atrLevels(side: 'buy' | 'sell', price: number): { sl: number | null; tp: number | null } {
    const atr = currentAtr()
    if (atr === null) return { sl: null, tp: null }
    return side === 'buy'
      ? { sl: price - 1.5 * atr, tp: price + 3 * atr }
      : { sl: price + 1.5 * atr, tp: price - 3 * atr }
  }

  // Quick-trade hotkeys: market order with ATR-based protective levels.
  // Sizing respects the trading panel's mode.
  function quickOrder(side: 'buy' | 'sell') {
    if (currentPrice === null) return
    const { sl, tp } = atrLevels(side, currentPrice)
    const lots = sizing.effectiveLots(currentPrice, sl) ?? 0.1
    session.placeMarket(side, lots, sl, tp)
    toast.info(`Quick ${side.toUpperCase()} ${lots} ${config.pair}${sl !== null ? ' · ATR SL/TP set' : ''}`)
  }

  // Panel BUY/SELL: fill blank SL/TP fields with the same ATR defaults so the
  // chart always has levels to draw knobs for.
  function marketOrderWithDefaults(side: 'buy' | 'sell', lots: number, sl: number | null, tp: number | null) {
    if (currentPrice === null) return
    let outSl = sl
    let outTp = tp
    if (outSl === null || outTp === null) {
      const d = atrLevels(side, currentPrice)
      if (outSl === null) outSl = d.sl
      if (outTp === null) outTp = d.tp
    }
    session.placeMarket(side, lots, outSl, outTp)
    if (sl === null || tp === null) toast.info(`Blank SL/TP filled with ATR defaults · drag them on the chart`)
  }

  // Chart-drag commits: live positions/orders modify in place; draft lines feed
  // the order-form inputs.
  function handleSlTpCommit(patch: SlTpPatch) {
    if (patch.kind === 'position') {
      session.modifyPositionFields(patch.id, { [patch.field]: patch.value })
    } else if (patch.kind === 'order') {
      session.modifyOrderFields(patch.id, { [patch.field]: patch.value })
    } else if (patch.field === 'sl') {
      setDraftSl(String(patch.value))
    } else {
      setDraftTp(String(patch.value))
    }
  }

  /** Execute a long/short position-plan drawing as a real order.
   *  Entry within the spread → market order; otherwise pending limit/stop
   *  at the drawn entry with the plan's SL/TP attached. */
  function executePositionDrawing(shape: DrawingShape) {
    if (currentPrice === null) return
    const entry = shape.points[0].price
    const sl = shape.points[1].price
    const tp = shape.tpPrice ?? null
    const side = shape.kind === 'long_position' ? ('buy' as const) : ('sell' as const)

    const lots = sizing.effectiveLots(entry, sl)
    if (lots === null) {
      toast.error('Invalid lot size / risk settings in the trading panel.')
      return
    }

    const halfSpread = pipSize(config.pair, config.market) * (config.spreadPips / 2)
    const label = shape.kind === 'long_position' ? 'LONG' : 'SHORT'
    const digits = config.market === 'crypto' ? 2 : config.pair.includes('JPY') ? 3 : 5

    if (Math.abs(entry - currentPrice) <= halfSpread) {
      session.placeMarket(side, lots, sl, tp)
      toast.success(`Executed ${label} ${lots} @ ~${currentPrice.toFixed(digits)} · SL/TP from plan`)
      return
    }

    // Pending: limit fills toward price, stop away from it
    const wantsBelow = side === 'buy' ? entry < currentPrice : entry > currentPrice
    session.placePending({
      type: wantsBelow ? 'limit' : 'stop',
      side,
      price: entry,
      lotSize: lots,
      stopLoss: sl,
      takeProfit: tp,
    })
    toast.success(`${label.toUpperCase()} ${wantsBelow ? 'limit' : 'stop'} placed @ ${entry.toFixed(digits)} · SL/TP attached`)
  }

  // Shared with the TradingPanel button so hotkey and click paths stay identical
  function closeAllPositions() {
    for (const p of session.state.positions) session.closePositionFull(p.id)
    if (session.state.positions.length > 0) toast.info('Closed all positions')
  }

  useReplayHotkeys(
    {
      onPlayPause: () => session.hasMoreBars && session.setPlaying(!session.state.playing),
      onStep: () => !session.state.playing && session.step(),
      onBuy: () => quickOrder('buy'),
      onSell: () => quickOrder('sell'),
      onCloseAll: closeAllPositions,
      onCancel: () => {
        if (activeTool) setActiveTool(null)
        else if (showHotkeyHelp) setShowHotkeyHelp(false)
      },
      onToggleHotkeyHelp: () => setShowHotkeyHelp((v) => !v),
    },
    tradeKeysArmed,
  )

  const markers = useMemo(
    () => ({ positions: session.state.positions, closedTrades: session.state.closedTrades }),
    [session.state.positions, session.state.closedTrades],
  )

  const freeMargin = session.equity - session.marginUsed

  async function handleEndSession() {
    setEnding(true)
    const saved = await session.flushSave()
    const res = await endReplaySession(config.id)
    setEnding(false)
    if (!res.success) {
      toast.error(res.error)
      setConfirmEnd(false)
      return
    }
    if (!saved) toast.warning('Some state may not have saved.')
    router.push(`/backtest/${config.id}/results`)
  }

  const chatSection = (
    <AiChatPanel
      config={config}
      activeTf={session.state.activeTf}
      visibleCandles={session.visibleCandles}
      positions={session.state.positions}
      orders={session.state.orders}
      balance={session.state.balance}
      equity={session.equity}
      marginUsed={session.marginUsed}
      freeMargin={freeMargin}
      indicatorConfigs={session.state.indicatorConfigs}
      drawings={session.state.drawings}
      closedTrades={session.state.closedTrades}
      chatMessages={session.state.chatMessages}
      appendChatMessages={session.appendChatMessages}
    />
  )

  const tradingSection = (
    <TradingPanel
      pair={config.pair}
      market={config.market}
      currentPrice={currentPrice}
      openPositions={session.state.positions.length}
      sizing={sizing}
      slValue={draftSl}
      tpValue={draftTp}
      onSlChange={setDraftSl}
      onTpChange={setDraftTp}
      onMarketOrder={marketOrderWithDefaults}
      onCloseAll={closeAllPositions}
    />
  )

  // Desktop rail uses dense targets; the mobile bottom sheet gets 44px touch rows
  function renderPositions(largeTargets = false) {
    return (
      <PositionsPanel
        pair={config.pair}
        market={config.market}
        currentPrice={currentPrice}
        positions={session.state.positions}
        orders={session.state.orders}
        onClosePosition={session.closePositionFull}
        onPartialClose={session.partialClosePosition}
        onModifyPosition={session.modifyPositionFields}
        onCancelOrder={session.cancelOrder}
        largeTargets={largeTargets}
      />
    )
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col gap-3 lg:h-[calc(100dvh-3.5rem)]">
      {/* ── Account strip ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[#27272A] bg-[#12141A] px-4 py-2">
        <span className="font-mono text-sm font-bold">{config.pair}</span>
        <AccountStat label="Balance" value={`$${session.state.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
        <AccountStat
          label="Equity"
          value={`$${session.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          className={session.equity >= session.state.balance ? 'text-[#00FF9C]' : 'text-[#FF4D4D]'}
        />
        <AccountStat label="Margin" value={`$${session.marginUsed.toFixed(2)}`} />
        <AccountStat
          label="Free"
          value={`$${freeMargin.toFixed(2)}`}
          className={freeMargin < 0 ? 'text-[#FF4D4D]' : undefined}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={toggleTradeKeys}
          aria-pressed={tradeKeysArmed}
          suppressHydrationWarning
          title={`B/S/C hotkeys are ${tradeKeysArmed ? 'armed — they place orders' : 'disarmed — press to enable'}`}
          className={`ml-auto h-7 border-[#27272A] px-2 text-xs ${
            tradeKeysArmed ? 'border-[#00FF9C]/50 text-[#00FF9C]' : 'text-zinc-400'
          }`}
        >
          <Keyboard className="mr-1 h-3.5 w-3.5" /> Trade keys {tradeKeysArmed ? 'ON' : 'OFF'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowHotkeyHelp((v) => !v)}
          aria-expanded={showHotkeyHelp}
          aria-label="Toggle hotkey help"
          className="h-7 px-2 text-xs text-zinc-400"
        >
          <span aria-hidden className="font-mono">?</span>
        </Button>
        <span role="status" aria-live="polite" className={`font-mono text-[10px] ${SAVE_STATUS_STYLES[session.saveStatus].text}`}>
          <span aria-hidden>●</span> {SAVE_STATUS_STYLES[session.saveStatus].label}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirmEnd(true)}
          disabled={ending}
          className="border-[#27272A] text-xs"
        >
          <LogOut className="mr-1 h-3.5 w-3.5" /> End Session
        </Button>
      </div>

      {/* ── Transport ── */}
      <ReplayControls
        playing={session.state.playing}
        speed={session.state.speed}
        activeTf={session.state.activeTf}
        timeframes={config.timeframes}
        currentBarTime={session.currentBar?.time ?? null}
        notices={session.notices}
        hasMoreBars={session.hasMoreBars}
        reversing={session.state.reversing}
        canRewind={session.canRewind}
        onPlayPause={() => session.setPlaying(!session.state.playing)}
        onToggleReverse={() => session.setReversing(!session.state.reversing)}
        onStep={session.step}
        onSpeedChange={session.setSpeed}
        onTfChange={session.setActiveTf}
      />

      {/* ── Chart + right rail ── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_340px]">
        <div className="relative min-h-[320px] rounded-lg border border-[#27272A] bg-[#0A0B0E] lg:min-h-0">
          <ChartPanel
            candles={session.visibleCandles}
            markers={markers}
            pair={config.pair}
            market={config.market}
            drawings={session.state.drawings}
            drawingsHidden={!showDrawings}
            activeTool={activeTool}
            indicatorConfigs={session.state.indicatorConfigs}
            positions={session.state.positions}
            orders={session.state.orders}
            draftSl={draftSl === '' ? null : parseFloat(draftSl) || null}
            draftTp={draftTp === '' ? null : parseFloat(draftTp) || null}
            currentPrice={currentPrice}
            equity={session.equity}
            onAddDrawing={addDrawing}
            onEraseDrawing={(id) => session.setDrawings(session.state.drawings.filter((d) => d.id !== id))}
            onEditDrawing={(id, patch) =>
              session.setDrawings(session.state.drawings.map((d) => (d.id === id ? { ...d, ...patch } : d)))
            }
            onExecutePositionDrawing={executePositionDrawing}
            onSlTpCommit={handleSlTpCommit}
          />
          <DrawToolbar
            activeTool={activeTool}
            showDrawings={showDrawings}
            onToggleVisibility={() => setShowDrawings((v) => !v)}
            onSelectTool={setActiveTool}
            onClearAll={() => {
              if (session.state.drawings.length === 0) return
              setConfirmClear(true)
            }}
            indicatorMenu={
              <IndicatorMenu configs={session.state.indicatorConfigs} onChange={session.setIndicatorConfigs} />
            }
          />

          {showHotkeyHelp && (
            <HotkeyLegend tradeKeysArmed={tradeKeysArmed} onClose={() => setShowHotkeyHelp(false)} />
          )}

          {/* Mobile trade button → bottom sheet */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={
                <Button
                  size="sm"
                  className="absolute bottom-3 right-3 z-20 h-10 rounded-full bg-[#00FF9C] px-4 font-bold text-[#0A0B0E] shadow-lg hover:bg-[#00FF9C]/90 lg:hidden"
                />
              }
            >
              <SlidersHorizontal className="mr-1 h-4 w-4" /> Trade
            </SheetTrigger>
            <SheetContent side="bottom" className="border-[#27272A] bg-[#12141A]">
              <SheetHeader>
                <SheetTitle className="text-sm">{config.pair}</SheetTitle>
              </SheetHeader>
              <Tabs defaultValue="trade" className="flex max-h-[75dvh] flex-col px-4 pb-6">
                <TabsList className="mb-3 w-full bg-[#1C1E26]">
                  <TabsTrigger value="trade" className="flex-1 text-xs">Trade</TabsTrigger>
                  <TabsTrigger value="coach" className="flex-1 text-xs">AI Coach</TabsTrigger>
                </TabsList>
                <TabsContent value="trade" className="mt-0 min-h-0 overflow-y-auto">
                  <div className="space-y-4 pb-2">
                    {tradingSection}
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Positions &amp; Orders</h3>
                      {renderPositions(true)}
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="coach" className="mt-0 flex min-h-0 flex-col data-[inactive]:hidden">
                  <div className="flex h-[55dvh] min-h-0 flex-col">{chatSection}</div>
                </TabsContent>
              </Tabs>
            </SheetContent>
          </Sheet>
        </div>

        {/* Desktop right rail */}
        <aside className="hidden min-h-0 flex-col gap-3 lg:flex">
          <div className="rounded-lg border border-[#27272A] bg-[#12141A] p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Order Entry</h3>
            {tradingSection}
          </div>
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-[#27272A] bg-[#12141A] p-4">
            <h3 className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Positions &amp; Orders
            </h3>
            <ScrollArea className="min-h-0 flex-1 pr-1">{renderPositions()}</ScrollArea>
          </div>
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-[#27272A] bg-[#12141A] p-4">
            <AiChatPanelHeader />
            <div className="mt-2 flex min-h-0 flex-1 flex-col">{chatSection}</div>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={(o) => !ending && setConfirmEnd(o)}
        title="End this session?"
        loading={ending}
        confirmLabel="End Session"
        destructive
        onConfirm={handleEndSession}
        description={
          <>
            <p>Positions stay as-is and the session becomes read-only.</p>
            <p className={session.saveStatus === 'error' ? 'text-[#FF4D4D]' : 'text-zinc-400'}>
              {session.saveStatus === 'error'
                ? 'Heads up: the latest autosave failed — progress since then may be lost.'
                : session.saveStatus === 'saving'
                  ? 'Saving progress…'
                  : 'All progress is saved.'}
            </p>
          </>
        }
      />

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear all drawings?"
        confirmLabel="Clear drawings"
        destructive
        onConfirm={() => {
          session.setDrawings([])
          setConfirmClear(false)
        }}
        description={<p>Removes every drawing from the chart. This cannot be undone.</p>}
      />
    </div>
  )
}

function AccountStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className="text-xs text-zinc-500">
      {label}{' '}
      <span className={`font-mono text-zinc-100 ${className ?? ''}`}>{value}</span>
    </span>
  )
}

const HOTKEY_ROWS: Array<[string, string]> = [
  ['Space', 'Play / pause replay'],
  ['→', 'Step one bar'],
  ['B', 'Quick buy at market'],
  ['S', 'Quick sell at market'],
  ['C', 'Close all positions'],
  ['Esc', 'Cancel active tool'],
]

function HotkeyLegend({ tradeKeysArmed, onClose }: { tradeKeysArmed: boolean; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Hotkey reference"
      className="absolute bottom-3 left-3 z-30 w-64 rounded-lg border border-[#27272A] bg-[#12141A]/95 p-3 shadow-xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-200">Hotkeys</span>
        <button
          onClick={onClose}
          aria-label="Close hotkey help"
          className="rounded px-1.5 py-0.5 font-mono text-xs text-zinc-500 hover:bg-[#1C1E26] hover:text-zinc-200"
        >
          Esc
        </button>
      </div>
      <dl className="space-y-1.5">
        {HOTKEY_ROWS.map(([key, desc]) => {
          const tradeKey = key === 'B' || key === 'S' || key === 'C'
          const dim = tradeKey && !tradeKeysArmed
          return (
            <div key={key} className={`flex items-center gap-2 ${dim ? 'opacity-50' : ''}`}>
              <dt>
                <kbd className="min-w-7 rounded border border-[#27272A] bg-[#1C1E26] px-1.5 py-0.5 text-center font-mono text-[10px] text-zinc-200">
                  {key}
                </kbd>
              </dt>
              <dd className="text-xs text-zinc-400">
                {desc}
                {dim ? ' (disarmed)' : ''}
              </dd>
            </div>
          )
        })}
        <div className="flex items-center gap-2">
          <dt>
            <kbd className="min-w-7 rounded border border-[#27272A] bg-[#1C1E26] px-1.5 py-0.5 text-center font-mono text-[10px] text-zinc-200">?</kbd>
          </dt>
          <dd className="text-xs text-zinc-400">Toggle this help</dd>
        </div>
      </dl>
      {!tradeKeysArmed && (
        <p className="mt-2 border-t border-[#27272A] pt-2 text-[11px] text-zinc-500">
          Trade keys are disarmed. Turn them on with the switch in the account strip.
        </p>
      )}
    </div>
  )
}
