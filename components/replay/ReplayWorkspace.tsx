'use client'

// Root replay layout: account strip, transport controls, chart, right rail
// (desktop) / bottom sheet (mobile).

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { LogOut, SlidersHorizontal } from 'lucide-react'
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
import { useReplayHotkeys } from './use-replay-hotkeys'
import {
  useReplaySession,
  type ReplaySessionConfig,
  type ResumeState,
} from './use-replay-session'
import type { Candle, DrawingShape } from '@/lib/types/replay'
import { endReplaySession } from '@/lib/actions/replay'

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
  const session = useReplaySession(config, candlesByTf, resume)

  function addDrawing(shape: DrawingShape) {
    setActiveTool(null)
    session.setDrawings([...session.state.drawings, shape])
  }

  const currentPrice = session.currentBar?.close ?? null

  // Quick-trade hotkeys fire a 0.1-lot market order with no SL/TP; the trading
  // panel remains the way to set sizing and levels precisely.
  function quickOrder(side: 'buy' | 'sell') {
    session.placeMarket(side, 0.1, null, null)
    toast.info(`Quick ${side.toUpperCase()} 0.1 ${config.pair}`)
  }

  useReplayHotkeys({
    onPlayPause: () => session.hasMoreBars && session.setPlaying(!session.state.playing),
    onStep: () => !session.state.playing && session.step(),
    onBuy: () => quickOrder('buy'),
    onSell: () => quickOrder('sell'),
    onClosePosition: () => {
      for (const p of session.state.positions) session.closePositionFull(p.id)
      if (session.state.positions.length > 0) toast.info('Closed all positions')
    },
  })

  const markers = useMemo(
    () => ({ positions: session.state.positions, closedTrades: session.state.closedTrades }),
    [session.state.positions, session.state.closedTrades],
  )

  const freeMargin = session.equity - session.marginUsed

  async function handleEndSession() {
    if (!window.confirm('End this session? Positions will be left as-is and the session becomes read-only.')) {
      return
    }
    setEnding(true)
    const saved = await session.flushSave()
    const res = await endReplaySession(config.id)
    setEnding(false)
    if (!res.success) {
      toast.error(res.error)
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
      equity={session.equity}
      onMarketOrder={session.placeMarket}
      onPendingOrder={session.placePending}
    />
  )

  const positionsSection = (
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
    />
  )

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
          onClick={handleEndSession}
          disabled={ending}
          className="ml-auto border-[#27272A] text-xs"
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
        onPlayPause={() => session.setPlaying(!session.state.playing)}
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
            onAddDrawing={addDrawing}
            onEraseDrawing={(id) => session.setDrawings(session.state.drawings.filter((d) => d.id !== id))}
          />
          <DrawToolbar
            activeTool={activeTool}
            showDrawings={showDrawings}
            onToggleVisibility={() => setShowDrawings((v) => !v)}
            onSelectTool={setActiveTool}
            onClearAll={() => {
              if (session.state.drawings.length === 0) return
              if (window.confirm('Clear all drawings?')) session.setDrawings([])
            }}
            indicatorMenu={
              <IndicatorMenu configs={session.state.indicatorConfigs} onChange={session.setIndicatorConfigs} />
            }
          />

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
                      {positionsSection}
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
            <ScrollArea className="min-h-0 flex-1 pr-1">{positionsSection}</ScrollArea>
          </div>
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-[#27272A] bg-[#12141A] p-4">
            <AiChatPanelHeader />
            <div className="mt-2 flex min-h-0 flex-1 flex-col">{chatSection}</div>
          </div>
        </aside>
      </div>
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
