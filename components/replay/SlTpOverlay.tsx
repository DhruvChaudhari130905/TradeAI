'use client'

// Draggable SL/TP price lines over the main chart: red stop, green target.
// Covers open positions, pending orders, and the order form's draft levels.
// The canvas is pointer-transparent — drag detection happens on the chart
// container (capture phase) so chart pan still works everywhere else.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import type { PendingOrder, ReplayPosition } from '@/lib/types/replay'
import { pipSize, pipValuePerLot } from '@/lib/replay/execution'

const HIT_RADIUS = 8

export type SlTpPatch =
  | { kind: 'position'; id: string; field: 'stopLoss' | 'takeProfit'; value: number }
  | { kind: 'order'; id: string; field: 'stopLoss' | 'takeProfit'; value: number }
  | { kind: 'draft'; field: 'sl' | 'tp'; value: number }

interface LineRef {
  key: string
  price: number
  color: string
  kind: 'position' | 'order' | 'draft'
  id: string
  field: 'stopLoss' | 'takeProfit'
}

interface SlTpOverlayProps {
  chartRef: React.RefObject<IChartApi | null>
  seriesRef: React.RefObject<ISeriesApi<'Candlestick'> | null>
  positions: ReplayPosition[]
  orders: PendingOrder[]
  /** Order-form draft levels (null = not set) */
  draftSl: number | null
  draftTp: number | null
  currentPrice: number | null
  equity: number
  pair: string
  market: 'forex' | 'crypto'
  onCommit: (patch: SlTpPatch) => void
}

interface DragState {
  line: LineRef
  previewPrice: number
}

export function SlTpOverlay({
  chartRef,
  seriesRef,
  positions,
  orders,
  draftSl,
  draftTp,
  currentPrice,
  equity,
  pair,
  market,
  onCommit,
}: SlTpOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [rangeTick, setRangeTick] = useState(0)
  const dragRef = useRef<DragState | null>(null)
  const [dragPreview, setDragPreview] = useState<DragState | null>(null)

  const ps = pipSize(pair, market)

  // ── Collect drawable lines ──
  const lines: LineRef[] = []
  for (const p of positions) {
    if (p.stopLoss !== null) lines.push({ key: `p-${p.id}-sl`, price: p.stopLoss, color: '#FF4D4D', kind: 'position', id: p.id, field: 'stopLoss' })
    if (p.takeProfit !== null) lines.push({ key: `p-${p.id}-tp`, price: p.takeProfit, color: '#00FF9C', kind: 'position', id: p.id, field: 'takeProfit' })
  }
  for (const o of orders) {
    if (o.stopLoss !== null) lines.push({ key: `o-${o.id}-sl`, price: o.stopLoss, color: '#FF4D4D', kind: 'order', id: o.id, field: 'stopLoss' })
    if (o.takeProfit !== null) lines.push({ key: `o-${o.id}-tp`, price: o.takeProfit, color: '#00FF9C', kind: 'order', id: o.id, field: 'takeProfit' })
  }
  if (draftSl !== null) lines.push({ key: 'draft-sl', price: draftSl, color: '#FF4D4D', kind: 'draft', id: '', field: 'stopLoss' })
  if (draftTp !== null) lines.push({ key: 'draft-tp', price: draftTp, color: '#00FF9C', kind: 'draft', id: '', field: 'takeProfit' })

  const priceToY = useCallback(
    (price: number): number | null => {
      const series = seriesRef.current
      if (!series) return null
      const y = series.priceToCoordinate(price)
      return y === null ? null : y
    },
    [seriesRef],
  )

  /** Screen y for a level, clamped into view — chart autoscale fits candles
   *  only, so an ATR-level price can map offscreen; pin the drawing at the
   *  edge instead of hiding it. */
  function yInView(price: number): number | null {
    const raw = priceToY(price)
    if (raw === null || size.w === 0) return null
    return Math.min(Math.max(raw, 14), size.h - 8)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !canvas.parentElement) return
    const observer = new ResizeObserver(() => {
      const parent = canvas.parentElement!
      setSize({ w: parent.clientWidth, h: parent.clientHeight })
    })
    observer.observe(canvas.parentElement)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const ts = chart.timeScale()
    const handler = () => setRangeTick((t) => t + 1)
    ts.subscribeVisibleLogicalRangeChange(handler)
    return () => ts.unsubscribeVisibleLogicalRangeChange(handler)
  }, [chartRef])

  function lineLabel(line: LineRef, price: number, dragging: boolean): string {
    // Full pip precision regardless of market — a rounded label hides the level
    const digits = pair.includes('JPY') ? 3 : 5
    const tag = line.field === 'stopLoss' ? 'SL' : 'TP'
    const suffix = dragging ? ' ⤺' : line.kind === 'draft' ? ' ◌' : ''
    return `${tag} ${price.toFixed(digits)}${suffix}`
  }

  // ── Draw pass ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w === 0) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== size.w * dpr || canvas.height !== size.h * dpr) {
      canvas.width = size.w * dpr
      canvas.height = size.h * dpr
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)

    for (const line of lines) {
      const dragging = dragPreview?.line.key === line.key
      const price = dragging ? dragPreview.previewPrice : line.price
      const y = yInView(price)
      if (y === null) continue

      ctx.strokeStyle = line.color
      ctx.lineWidth = dragging ? 2 : 1.5
      ctx.setLineDash(line.kind === 'draft' ? [6, 4] : [])
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(size.w, y)
      ctx.stroke()
      ctx.setLineDash([])

      // Grab knob (circle with grip lines) + price pill on the right edge
      const label = lineLabel(line, price, dragging)
      ctx.font = '10px ui-monospace, monospace'
      const w = ctx.measureText(label).width

      // Pill: SL/TP price
      const pillX = size.w - w - 30
      ctx.beginPath()
      ctx.roundRect(pillX, y - 9, w + 12, 18, 9)
      ctx.fillStyle = line.color
      ctx.fill()
      if (dragging) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      ctx.fillStyle = '#0A0B0E'
      ctx.fillText(label, pillX + 6, y + 3.5)

      // Knob: the click-and-drag handle
      const knobX = pillX - 16
      ctx.beginPath()
      ctx.arc(knobX, y, 9, 0, Math.PI * 2)
      ctx.fillStyle = line.color
      ctx.fill()
      ctx.strokeStyle = '#0A0B0E'
      ctx.lineWidth = 1.5
      ctx.stroke()
      // Grip dots
      ctx.fillStyle = 'rgba(10, 11, 14, 0.85)'
      for (const gx of [-3, 0, 3]) {
        ctx.beginPath()
        ctx.arc(knobX + gx, y, 1.2, 0, Math.PI * 2)
        ctx.fill()
      }

      if (dragging && currentPrice !== null) {
        // Live readout: distance from current price in pips (+ $risk where known)
        const pips = Math.abs(price - currentPrice) / ps
        let extra = ''
        if (line.kind === 'position') {
          const pos = positions.find((p) => p.id === line.id)
          if (pos) {
            const usd = pips * pipValuePerLot(pair, market, currentPrice) * pos.lotSize
            extra = ` · $${usd.toFixed(2)} (${((usd / Math.max(equity, 1)) * 100).toFixed(1)}%)`
          }
        }
        const text = `${pips.toFixed(1)} pips${extra}`
        const tw = ctx.measureText(text).width
        ctx.fillStyle = 'rgba(18, 20, 26, 0.95)'
        ctx.fillRect(10, y - 20, tw + 10, 15)
        ctx.fillStyle = '#E4E4E7'
        ctx.fillText(text, 15, y - 9)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, positions, orders, dragPreview, size, rangeTick, currentPrice, equity, pair, market])

  // ── Drag handling on the chart container, capture phase ──
  useEffect(() => {
    const container = canvasRef.current?.parentElement
    const canvas = canvasRef.current
    if (!container || !canvas) return

    function yToPrice(y: number): number | null {
      const rect = canvas!.getBoundingClientRect()
      const relY = y - rect.top
      return seriesRef.current?.coordinateToPrice(relY) ?? null
    }

    function hitTest(clientX: number, clientY: number): LineRef | null {
      const rect = canvas!.getBoundingClientRect()
      const x = clientX - rect.left
      const y = clientY - rect.top
      for (const line of lines) {
        const ly = yInView(line.price)
        if (ly === null) continue
        // Grab anywhere along the line; widest tolerance around the knob + pill
        if (Math.abs(ly - y) < HIT_RADIUS) return line
        if (x > size.w - 220 && Math.abs(ly - y) < HIT_RADIUS + 6) return line
      }
      return null
    }

    function onPointerDown(e: PointerEvent) {
      const hit = hitTest(e.clientX, e.clientY)
      if (!hit) return
      e.stopPropagation()
      e.preventDefault()
      const price = yToPrice(e.clientY)
      if (price === null) return
      const st = { line: hit, previewPrice: price }
      dragRef.current = st
      setDragPreview(st)
      container!.setPointerCapture(e.pointerId)
    }

    function onPointerMove(e: PointerEvent) {
      if (!dragRef.current) return
      const price = yToPrice(e.clientY)
      if (price === null) return
      const st = { ...dragRef.current, previewPrice: price }
      dragRef.current = st
      setDragPreview(st)
    }

    function onPointerUp() {
      const st = dragRef.current
      dragRef.current = null
      setDragPreview(null)
      if (!st) return
      const digits = market === 'crypto' ? 2 : pair.includes('JPY') ? 3 : 5
      const value = Number(st.previewPrice.toFixed(digits))
      if (st.line.kind === 'position') {
        onCommit({ kind: 'position', id: st.line.id, field: st.line.field, value })
      } else if (st.line.kind === 'order') {
        onCommit({ kind: 'order', id: st.line.id, field: st.line.field, value })
      } else {
        onCommit({ kind: 'draft', field: st.line.field === 'stopLoss' ? 'sl' : 'tp', value })
      }
    }

    container.addEventListener('pointerdown', onPointerDown, true)
    container.addEventListener('pointermove', onPointerMove, true)
    container.addEventListener('pointerup', onPointerUp, true)
    return () => {
      container.removeEventListener('pointerdown', onPointerDown, true)
      container.removeEventListener('pointermove', onPointerMove, true)
      container.removeEventListener('pointerup', onPointerUp, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, size, market, pair, onCommit])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-[15]"
      style={{ width: size.w, height: size.h }}
    />
  )
}
