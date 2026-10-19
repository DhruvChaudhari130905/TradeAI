'use client'

// Open positions + pending orders management: floating PnL, modify SL/TP,
// breakeven, trailing stop, partial close, cancel.

import { useState } from 'react'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import type { ClosedReplayTrade, PendingOrder, ReplayPosition } from '@/lib/types/replay'
import { floatingPnl, pipSize, priceDigits } from '@/lib/replay/execution'

interface PositionsPanelProps {
  pair: string
  market: 'forex' | 'crypto'
  currentPrice: number | null
  positions: ReplayPosition[]
  orders: PendingOrder[]
  closedTrades: ClosedReplayTrade[]
  onClosePosition: (id: string) => void
  onPartialClose: (id: string, lots: number) => void
  onModifyPosition: (id: string, patch: Partial<Pick<ReplayPosition, 'stopLoss' | 'takeProfit' | 'trailingStopPips' | 'breakEvenMoved'>>) => void
  onCancelOrder: (id: string) => void
  /** 44px touch targets for the mobile bottom-sheet context */
  largeTargets?: boolean
}

/** Max rows of open positions/orders visible before the list scrolls (~4 rows) */
const OPEN_LIST_MAX_HEIGHT_CLASS = 'max-h-[15rem]'

export function PositionsPanel({
  pair,
  market,
  currentPrice,
  positions,
  orders,
  closedTrades,
  onClosePosition,
  onPartialClose,
  onModifyPosition,
  onCancelOrder,
  largeTargets = false,
}: PositionsPanelProps) {
  if (positions.length === 0 && orders.length === 0 && closedTrades.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">No open positions or orders</p>
  }

  const closedNewestFirst = closedTrades.slice(-20).reverse()

  return (
    <div className="space-y-2">
      {/* Open positions + pending orders — capped at ~4 rows, rest scrolls */}
      {(positions.length > 0 || orders.length > 0) && (
        <div className={`space-y-2 overflow-y-auto pr-1 ${OPEN_LIST_MAX_HEIGHT_CLASS}`}>
          {positions.map((p) => (
            <PositionRow
              key={p.id}
              position={p}
              pair={pair}
              market={market}
              currentPrice={currentPrice}
              onClose={onClosePosition}
              onPartialClose={onPartialClose}
              onModify={onModifyPosition}
              largeTargets={largeTargets}
            />
          ))}
          {orders.map((o) => (
            <div key={o.id} className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
              <Badge variant="secondary" className="text-[11px] uppercase">{o.type}</Badge>
              <span className={`font-mono text-xs ${o.side === 'buy' ? 'text-primary' : 'text-loss'}`}>
                {o.side.toUpperCase()} {o.lotSize} @ {o.price}
              </span>
              <button
                onClick={() => onCancelOrder(o.id)}
                aria-label={`Cancel ${o.side} ${o.type} order at ${o.price}`}
                className={`ml-auto flex items-center justify-center rounded text-muted-foreground hover:bg-loss/10 hover:text-loss ${
                  largeTargets ? 'h-11 w-11' : 'h-7 w-7'
                }`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Closed trades this session — newest first, last 20 */}
      {closedNewestFirst.length > 0 && (
        <div>
          <h4 className="sticky top-0 bg-card py-1 text-xs font-medium text-muted-foreground">
            Closed Trades ({closedTrades.length})
          </h4>
          <div className="max-h-[15rem] space-y-1 overflow-y-auto pr-1">
            {closedNewestFirst.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-md border border-border bg-raised px-3 py-1.5 text-[11px]"
              >
                <span className={`font-mono font-semibold ${t.direction === 'long' ? 'text-primary' : 'text-loss'}`}>
                  {t.direction.toUpperCase()}
                </span>
                <span className="font-mono text-muted-foreground">
                  {t.entryPrice.toFixed(priceDigits(pair, market))} → {t.exitPrice.toFixed(priceDigits(pair, market))}
                </span>
                <span
                  className={`ml-auto font-mono font-semibold ${
                    t.pnlUsd > 0 ? 'text-primary' : t.pnlUsd < 0 ? 'text-loss' : 'text-muted-foreground'
                  }`}
                >
                  {t.pnlUsd >= 0 ? '+' : ''}${t.pnlUsd.toFixed(2)}
                </span>
                <span className="font-mono text-muted-foreground">{t.pnlPips.toFixed(1)}p</span>
                <span className="text-[11px] text-muted-foreground">{t.exitReason.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PositionRow({
  position,
  pair,
  market,
  currentPrice,
  onClose,
  onPartialClose,
  onModify,
  largeTargets,
}: {
  position: ReplayPosition
  pair: string
  market: 'forex' | 'crypto'
  currentPrice: number | null
  onClose: (id: string) => void
  onPartialClose: (id: string, lots: number) => void
  onModify: (id: string, patch: Partial<Pick<ReplayPosition, 'stopLoss' | 'takeProfit' | 'trailingStopPips' | 'breakEvenMoved'>>) => void
  largeTargets: boolean
}) {
  const [partialOpen, setPartialOpen] = useState(false)
  const pnl = currentPrice !== null ? floatingPnl(position, currentPrice, pair, market) : 0
  const digits = priceDigits(pair, market)

  function moveBreakeven() {
    if (!currentPrice) return
    // Only meaningful once price has moved past entry in the trade's favor
    onModify(position.id, { stopLoss: position.entryPrice, breakEvenMoved: true })
  }

  function toggleTrailing() {
    // Toggle a 15-pip trail (10 for JPY-quote, $1 per coin for crypto is too
    // tight — use 1% of price for crypto)
    if (position.trailingStopPips !== null) {
      onModify(position.id, { trailingStopPips: null })
    } else {
      const pips = market === 'crypto' ? Math.round(currentPrice! * 0.01 / pipSize(pair, market)) : 15
      onModify(position.id, { trailingStopPips: pips })
    }
  }

  return (
    <div className="rounded-md border border-border bg-muted px-3 py-2">
      <div className="flex items-center gap-2">
        <Badge
          variant="secondary"
          className={`text-[11px] font-bold ${position.direction === 'long' ? 'bg-primary/10 text-primary' : 'bg-loss/10 text-loss'}`}
        >
          {position.direction === 'long' ? 'LONG' : 'SHORT'}
        </Badge>
        <span className="font-mono text-xs">{position.lotSize}</span>
        <span className="font-mono text-xs text-muted-foreground">@ {position.entryPrice.toFixed(digits)}</span>
        <span className={`ml-auto font-mono text-xs font-bold ${pnl >= 0 ? 'text-primary' : 'text-loss'}`}>
          {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
        </span>
        <button
          onClick={() => onClose(position.id)}
          aria-label={`Close ${position.direction} ${position.lotSize} lots at ${position.entryPrice}`}
          className={`flex items-center justify-center rounded text-muted-foreground hover:bg-loss/10 hover:text-loss ${
            largeTargets ? 'h-11 w-11' : 'h-7 w-7'
          }`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span>SL {position.stopLoss !== null ? position.stopLoss.toFixed(digits) : '—'}</span>
        <span>TP {position.takeProfit !== null ? position.takeProfit.toFixed(digits) : '—'}</span>
        {position.trailingStopPips !== null && <span className="text-sky-400">trail {position.trailingStopPips}p</span>}
        {position.partialCloses.length > 0 && (
          <span>{position.partialCloses.length} partial{position.partialCloses.length > 1 ? 's' : ''}</span>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        {/* Modify SL/TP dialog */}
        <ModifyDialog position={position} digits={digits} onModify={onModify} largeTargets={largeTargets} />

        <Button size="sm" variant="outline" onClick={moveBreakeven} disabled={position.breakEvenMoved}
          aria-label="Move stop loss to entry (breakeven)"
          className={`${largeTargets ? 'h-11 px-3 text-xs' : 'h-6 px-2 text-[11px]'} border-border`}>
          BE
        </Button>
        <Button size="sm" variant="outline" onClick={toggleTrailing} aria-pressed={position.trailingStopPips !== null}
          className={`${largeTargets ? 'h-11 px-3 text-xs' : 'h-6 px-2 text-[11px]'} border-border ${position.trailingStopPips !== null ? 'text-sky-400' : ''}`}>
          Trail
        </Button>

        {/* Partial close */}
        <Dialog open={partialOpen} onOpenChange={setPartialOpen}>
          <DialogTrigger
            render={
              <Button size="sm" variant="outline" disabled={position.lotSize <= 0.01}
                className={`${largeTargets ? 'h-11 px-3 text-xs' : 'h-6 px-2 text-[11px]'} border-border`} />
            }
          >
            Partial
          </DialogTrigger>
          <DialogContent className="border-border bg-card sm:max-w-xs">
            <DialogHeader>
              <DialogTitle className="text-sm">Partial close ({position.lotSize} open)</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-2">
              {[25, 50, 75].map((pct) => {
                const lotsToClose = Math.max(0.01, Math.floor(position.lotSize * (pct / 100) * 100) / 100)
                return (
                  <Button
                    key={pct}
                    variant="outline"
                    className="border-border font-mono"
                    onClick={() => {
                      if (lotsToClose >= position.lotSize) {
                        toast.error('Cannot close more than the remaining size.')
                        return
                      }
                      onPartialClose(position.id, lotsToClose)
                      setPartialOpen(false)
                    }}
                  >
                    {pct}%
                    <span className="block text-[11px] text-muted-foreground">{lotsToClose} lots</span>
                  </Button>
                )
              })}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

function ModifyDialog({
  position,
  digits,
  onModify,
  largeTargets,
}: {
  position: ReplayPosition
  digits: number
  onModify: (id: string, patch: Partial<Pick<ReplayPosition, 'stopLoss' | 'takeProfit'>>) => void
  largeTargets: boolean
}) {
  const [open, setOpen] = useState(false)
  const [sl, setSl] = useState(position.stopLoss?.toString() ?? '')
  const [tp, setTp] = useState(position.takeProfit?.toString() ?? '')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            className={`${largeTargets ? 'h-11 px-3 text-xs' : 'h-6 px-2 text-[11px]'} border-border`}
          />
        }
      >
        Modify
      </DialogTrigger>
      <DialogContent className="border-border bg-card sm:max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm">Modify SL / TP</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Stop loss</Label>
            <Input type="number" step="any" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="none"
              className="border-border font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Take profit</Label>
            <Input type="number" step="any" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="none"
              className="border-border font-mono" />
          </div>
          <Button
            className="w-full bg-primary text-primary-foreground"
            onClick={() => {
              const slNum = parseFloat(sl)
              const tpNum = parseFloat(tp)
              onModify(position.id, {
                stopLoss: Number.isFinite(slNum) && slNum > 0 ? slNum : null,
                takeProfit: Number.isFinite(tpNum) && tpNum > 0 ? tpNum : null,
              })
              setOpen(false)
            }}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
