'use client'

// Canvas drawing overlay over the candlestick chart. Converts between chart
// coordinates (time/price) and pixels via the lightweight-charts APIs so
// drawings stay anchored while panning/zooming.
//
// Position-planner shapes (long_position / short_position) carry entry,
// stop (points[1].price) and take-profit (tpPrice); selecting one with the
// cursor tool shows an Execute/Delete badge wired to the trading sim.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Trash2 } from 'lucide-react'
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import type { Candle, DrawingKind, DrawingPoint, DrawingShape } from '@/lib/types/replay'
import { toChartTime } from '@/lib/replay/time'
import { pipSize, priceDigits } from '@/lib/replay/execution'
import {
  anchorHandleHit as anchorHandleHitImpl,
  axisLock,
  extendRay,
  FIB_LEVELS,
  getResizeCursor,
  getResizeHandles,
  HANDLE_RADIUS,
  handleResizeDrag,
  hitTestShapes,
  supportsResizeKnobs,
  type Pixel,
} from '@/lib/replay/drawing-geometry'
import { newId } from '@/lib/replay/simulation'

export type DrawTool = DrawingKind | 'eraser'

export const DRAW_TOOLS: DrawTool[] = [
  'hline', 'vline', 'trendline', 'rect', 'fib', 'text', 'measure',
  'hray', 'vray', 'ray', 'arrow', 'channel', 'price_range', 'pitchfork',
  'long_position', 'short_position',
  'eraser',
]

const LINE_COLOR = '#38BDF8'
const FIB_COLOR = '#D4A24E'
const HIT_RADIUS = 8
const POSITION_RR = 2 // default take-profit = 2× the drawn stop distance

interface DrawingOverlayProps {
  chartRef: React.RefObject<IChartApi | null>
  seriesRef: React.RefObject<ISeriesApi<'Candlestick'> | null>
  candles: Candle[]
  drawings: DrawingShape[]
  activeTool: DrawTool | null
  pair: string
  market: 'forex' | 'crypto'
  onAdd: (shape: DrawingShape) => void
  onErase: (id: string) => void
  /** In-place edit of an existing drawing (drag commit, text re-label) */
  onEdit: (id: string, patch: Partial<Pick<DrawingShape, 'points' | 'tpPrice' | 'label'>>) => void
  /** Position-planner Execute button (cursor-tool selection) */
  onExecute: (shape: DrawingShape) => void
}


/** Active edit gesture (capture-phase drag in cursor mode) */
interface EditDrag {
  mode: 'body' | 'anchor' | 'tp' | 'resize'
  shape: DrawingShape // frozen snapshot at drag start — deltas stay relative to it
  anchorIndex: number
  startPixel: Pixel
  /** Candle index + price under the cursor at drag start — deltas from these */
  startCandleIdx: number
  startPrice: number
  /** Most recent dragged copy, committed on pointerup */
  latest?: DrawingShape
}

/** How many clicks each tool needs before the shape is committed */
function anchorsNeeded(tool: DrawTool): number {
  if (tool === 'hline' || tool === 'vline' || tool === 'hray' || tool === 'vray' || tool === 'text') return 1
  if (tool === 'channel' || tool === 'pitchfork') return 3
  return 2
}

/** TradingView-style plan box: entry line, red SL zone, green TP zone */
function drawPositionPlan(
  ctx: CanvasRenderingContext2D,
  shape: DrawingShape,
  pp: Pixel[],
  size: { w: number; h: number },
  priceToY: (p: number) => number | null,
  market: 'forex' | 'crypto',
  pair: string,
) {
  const isLong = shape.kind === 'long_position'
  const entryY = priceToY(shape.points[0].price)
  const slY = priceToY(shape.points[1].price)
  const tp = shape.tpPrice ?? shape.points[0].price
  const tpY = priceToY(tp)
  if (entryY === null || slY === null || tpY === null) return

  const x0 = Math.max(0, pp[0].x)
  const width = Math.max(Math.abs(pp[1].x - pp[0].x), 90)
  const xEnd = Math.min(x0 + width, size.w)

  // Zones
  ctx.fillStyle = 'rgba(255, 77, 77, 0.32)'
  ctx.fillRect(x0, Math.min(entryY, slY), xEnd - x0, Math.abs(slY - entryY))
  ctx.fillStyle = 'rgba(0, 255, 156, 0.20)'
  ctx.fillRect(x0, Math.min(entryY, tpY), xEnd - x0, Math.abs(tpY - entryY))

  // Level lines
  const digits = priceDigits(pair, market)
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#FF4D4D'
  ctx.beginPath(); ctx.moveTo(x0, slY); ctx.lineTo(xEnd, slY); ctx.stroke()
  ctx.strokeStyle = '#00FF9C'
  ctx.beginPath(); ctx.moveTo(x0, tpY); ctx.lineTo(xEnd, tpY); ctx.stroke()
  ctx.strokeStyle = '#E4E4E7'
  ctx.beginPath(); ctx.moveTo(x0, entryY); ctx.lineTo(xEnd, entryY); ctx.stroke()

  const ps = pipSize(pair, market)
  const slPips = Math.abs(shape.points[0].price - shape.points[1].price) / ps
  const tpPips = Math.abs(tp - shape.points[0].price) / ps
  const rr = slPips > 0 ? (tpPips / slPips).toFixed(1) : '—'
  const tag = isLong ? 'LONG' : 'SHORT'
  drawLabel(ctx, x0 + 4, Math.max(slY, tpY, entryY) + 14,
    `${tag} · E ${shape.points[0].price.toFixed(digits)} · SL ${slPips.toFixed(0)}p · TP ${tpPips.toFixed(0)}p · R:R ${rr}`)
}

export function DrawingOverlay({
  chartRef,
  seriesRef,
  candles,
  drawings,
  activeTool,
  pair,
  market,
  onAdd,
  onErase,
  onEdit,
  onExecute,
}: DrawingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [rangeTick, setRangeTick] = useState(0)
  // Anchors collected so far for a multi-click tool
  const pendingRef = useRef<DrawingPoint[]>([])
  const [preview, setPreview] = useState<Pixel | null>(null)
  // Measure drag state
  const measureStartRef = useRef<DrawingPoint | null>(null)
  const [measureTo, setMeasureTo] = useState<DrawingPoint | null>(null)
  // Selected drawing (cursor mode) — any kind is selectable/editable
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [badgePos, setBadgePos] = useState<Pixel | null>(null)
  // Live copy of the shape being dragged (rendered in place of the stored one)
  const [dragShape, setDragShape] = useState<DrawingShape | null>(null)
  const editDragRef = useRef<EditDrag | null>(null)
  // Floating text-label editor — replaces native window.prompt at create/edit time
  const [textDraft, setTextDraft] = useState<
    { id: string | null; anchor: DrawingPoint | null; x: number; y: number; value: string } | null
  >(null)

  const interactive = activeTool !== null

  // ── Coordinate conversion ──

  const timeToX = useCallback(
    (time: string): number | null => {
      const chart = chartRef.current
      if (!chart) return null
      return chart.timeScale().timeToCoordinate(toChartTime(time) as UTCTimestamp)
    },
    [chartRef],
  )

  const priceToY = useCallback(
    (price: number): number | null => {
      const series = seriesRef.current
      if (!series) return null
      return series.priceToCoordinate(price)
    },
    [seriesRef],
  )

  /** Snap a pixel position to the nearest visible candle (time) + exact price */
  const snap = useCallback(
    (x: number, y: number): DrawingPoint | null => {
      const series = seriesRef.current
      if (!series) return null
      const price = series.coordinateToPrice(y)
      if (price === null) return null

      let best: { time: string; dist: number } | null = null
      for (const c of candles) {
        const cx = timeToX(c.time)
        if (cx === null) continue
        const dist = Math.abs(cx - x)
        if (best === null || dist < best.dist) best = { time: c.time, dist }
      }
      if (best === null) return null
      return { time: best.time, price }
    },
    [candles, timeToX, seriesRef],
  )

  const toPixels = useCallback(
    (p: DrawingPoint): Pixel | null => {
      const x = timeToX(p.time)
      const y = priceToY(p.price)
      if (x === null || y === null) return null
      return { x, y }
    },
    [timeToX, priceToY],
  )

  /** Candle index under a pixel x (series data == candles slice → logical == index) */
  const candleIndexAtX = useCallback(
    (x: number): number => {
      const chart = chartRef.current
      if (!chart) return -1
      const logical = chart.timeScale().coordinateToLogical(x)
      if (logical === null) return -1
      return Math.max(0, Math.min(candles.length - 1, Math.round(logical)))
    },
    [chartRef, candles.length],
  )

  const timeAtIdx = useCallback(
    (idx: number): string | null => candles[idx]?.time ?? null,
    [candles],
  )

  /** Price under a pixel y (no snapping) */
  const priceAtY = useCallback(
    (y: number): number | null => seriesRef.current?.coordinateToPrice(y) ?? null,
    [seriesRef],
  )

  // ── Canvas sizing ──

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => {
      const parent = canvas.parentElement
      if (!parent) return
      setSize({ w: parent.clientWidth, h: parent.clientHeight })
    })
    observer.observe(canvas.parentElement!)
    return () => observer.disconnect()
  }, [])

  // Redraw when the visible range pans/zooms
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const ts = chart.timeScale()
    const handler = () => setRangeTick((t) => t + 1)
    ts.subscribeVisibleLogicalRangeChange(handler)
    return () => ts.unsubscribeVisibleLogicalRangeChange(handler)
  }, [chartRef])

  // ── Geometry helpers ──

  /** Extend p0→dir infinitely toward the right edge */

  // ── Shape rendering ──

  const drawShape = useCallback(
    (ctx: CanvasRenderingContext2D, shape: DrawingShape) => {
      const pts = shape.points.map(toPixels)
      if (pts.some((p) => p === null)) return
      const pp = pts as Pixel[]
      const color = shape.color ?? (shape.kind === 'fib' ? FIB_COLOR : LINE_COLOR)

      ctx.lineWidth = 1.5
      ctx.strokeStyle = color
      ctx.fillStyle = color

      switch (shape.kind) {
        case 'hline': {
          ctx.beginPath()
          ctx.moveTo(0, pp[0].y)
          ctx.lineTo(size.w, pp[0].y)
          ctx.stroke()
          break
        }
        case 'vline': {
          ctx.beginPath()
          ctx.moveTo(pp[0].x, 0)
          ctx.lineTo(pp[0].x, size.h)
          ctx.stroke()
          break
        }
        case 'hray': {
          ctx.beginPath()
          ctx.moveTo(pp[0].x, pp[0].y)
          ctx.lineTo(size.w, pp[0].y)
          ctx.stroke()
          break
        }
        case 'vray': {
          ctx.beginPath()
          ctx.moveTo(pp[0].x, pp[0].y)
          ctx.lineTo(pp[0].x, size.h)
          ctx.stroke()
          break
        }
        case 'trendline':
        case 'measure': {
          if (shape.kind === 'measure') ctx.setLineDash([5, 4])
          ctx.beginPath()
          ctx.moveTo(pp[0].x, pp[0].y)
          ctx.lineTo(pp[1].x, pp[1].y)
          ctx.stroke()
          ctx.setLineDash([])
          if (shape.label) drawLabel(ctx, (pp[0].x + pp[1].x) / 2, (pp[0].y + pp[1].y) / 2 - 10, shape.label)
          break
        }
        case 'ray': {
          const far = extendRay(pp[0], pp[1], size.w)
          ctx.beginPath()
          ctx.moveTo(pp[0].x, pp[0].y)
          ctx.lineTo(far.x, far.y)
          ctx.stroke()
          break
        }
        case 'arrow': {
          ctx.beginPath()
          ctx.moveTo(pp[0].x, pp[0].y)
          ctx.lineTo(pp[1].x, pp[1].y)
          ctx.stroke()
          drawArrowHead(ctx, pp[0], pp[1])
          break
        }
        case 'rect': {
          const x = Math.min(pp[0].x, pp[1].x)
          const y = Math.min(pp[0].y, pp[1].y)
          const w = Math.abs(pp[1].x - pp[0].x)
          const h = Math.abs(pp[1].y - pp[0].y)
          ctx.fillStyle = hexToRgba(color, 0.1)
          ctx.fillRect(x, y, w, h)
          ctx.strokeRect(x, y, w, h)
          break
        }
        case 'price_range': {
          const x = Math.min(pp[0].x, pp[1].x)
          const y = Math.min(pp[0].y, pp[1].y)
          const w = Math.max(Math.abs(pp[1].x - pp[0].x), 60)
          const h = Math.abs(pp[1].y - pp[0].y)
          ctx.fillStyle = hexToRgba(color, 0.12)
          ctx.fillRect(x, y, w, h)
          ctx.strokeRect(x, y, w, h)
          const rangeLabel = shape.label ?? measureLabel(shape.points[0], shape.points[1], [], pair, market)
          drawLabel(ctx, x + w + 6, y + h / 2, rangeLabel)
          break
        }
        case 'channel': {
          // Main line p0→p1; parallel through p2; translucent fill between
          const ox = pp[2].x - pp[0].x
          const oy = pp[2].y - pp[0].y
          ctx.beginPath()
          ctx.moveTo(pp[0].x, pp[0].y)
          ctx.lineTo(pp[1].x, pp[1].y)
          ctx.moveTo(pp[0].x + ox, pp[0].y + oy)
          ctx.lineTo(pp[1].x + ox, pp[1].y + oy)
          ctx.stroke()
          ctx.fillStyle = hexToRgba(color, 0.08)
          ctx.beginPath()
          ctx.moveTo(pp[0].x, pp[0].y)
          ctx.lineTo(pp[1].x, pp[1].y)
          ctx.lineTo(pp[1].x + ox, pp[1].y + oy)
          ctx.lineTo(pp[0].x + ox, pp[0].y + oy)
          ctx.closePath()
          ctx.fill()
          break
        }
        case 'pitchfork': {
          // Andrews: median from A through midpoint(B,C); prongs from B and C
          const [a, b, c] = pp
          const mx = (b.x + c.x) / 2
          const my = (b.y + c.y) / 2
          const farM = extendRay(a, { x: mx, y: my }, size.w)
          const warnColor = '#D4A24E'
          ctx.strokeStyle = warnColor
          // Median line
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(farM.x, farM.y)
          ctx.stroke()
          // Upper prong: through B, parallel to median
          const offB = { x: b.x - mx, y: b.y - my }
          ctx.beginPath()
          ctx.moveTo(b.x, b.y)
          ctx.lineTo(farM.x + offB.x, farM.y + offB.y)
          ctx.stroke()
          // Lower prong: through C
          const offC = { x: c.x - mx, y: c.y - my }
          ctx.beginPath()
          ctx.moveTo(c.x, c.y)
          ctx.lineTo(farM.x + offC.x, farM.y + offC.y)
          ctx.stroke()
          // Handle A-B and A-C
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(c.x, c.y)
          ctx.stroke()
          ctx.setLineDash([])
          break
        }
        case 'fib': {
          const [a, b] = [shape.points[0], shape.points[1]]
          const x1 = Math.min(pp[0].x, pp[1].x)
          const x2 = Math.max(pp[0].x, pp[1].x)
          ctx.font = '10px ui-monospace, monospace'
          for (const level of FIB_LEVELS) {
            const price = a.price + (b.price - a.price) * level
            const y = priceToY(price)
            if (y === null) continue
            ctx.setLineDash(level === 0 || level === 1 ? [] : [4, 3])
            ctx.beginPath()
            ctx.moveTo(x1, y)
            ctx.lineTo(x2, y)
            ctx.stroke()
            ctx.setLineDash([])
            ctx.fillText(`${(level * 100).toFixed(1)}%  ${formatPrice(price, market, pair)}`, x2 + 4, y + 3)
          }
          break
        }
        case 'text': {
          ctx.font = '12px ui-sans-serif, system-ui'
          ctx.fillText(shape.label ?? '', pp[0].x, pp[0].y)
          break
        }
        case 'long_position':
        case 'short_position': {
          drawPositionPlan(ctx, shape, pp, size, priceToY, market, pair)
          break
        }
      }
    },
    [toPixels, size, priceToY, market, pair],
  )

  // ── Main draw pass ──

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

    for (const stored of drawings) {
      const shape = dragShape && stored.id === dragShape.id ? dragShape : stored
      if (selectedId && shape.id === selectedId) {
        ctx.save()
        ctx.shadowColor = 'rgba(0, 255, 156, 0.6)'
        ctx.shadowBlur = 6
        drawShape(ctx, shape)
        ctx.restore()
      } else {
        drawShape(ctx, shape)
      }
    }

    // Anchor handles on the selected drawing (cursor mode only) — small
    // circles at each anchor, plus the TP handle on position plans.
    if (!activeTool && !dragShape && selectedId) {
      const sel = drawings.find((d) => d.id === selectedId)
      if (sel && sel.kind !== 'measure') {
        const drawHandle = (px: Pixel, color: string, isResize = false) => {
          ctx.beginPath()
          ctx.arc(px.x, px.y, isResize ? 6 : 4.5, 0, Math.PI * 2)
          ctx.fillStyle = '#FFFFFF'
          ctx.fill()
          ctx.strokeStyle = color
          ctx.lineWidth = isResize ? 2 : 1.5
          ctx.stroke()
        }
        // Anchor point handles
        for (const p of sel.points) {
          const px = toPixels(p)
          if (px) drawHandle(px, sel.color ?? LINE_COLOR)
        }
        // TP handle for position plans
        if (sel.kind === 'long_position' || sel.kind === 'short_position') {
          const tpPx = toPixels({ time: sel.points[1]?.time ?? sel.points[0].time, price: sel.tpPrice ?? sel.points[0].price })
          if (tpPx) {
            drawHandle(tpPx, '#00FF9C')
            // Dashed connector from SL edge to TP handle for context
            const slPx = toPixels(sel.points[1] ?? sel.points[0])
            if (slPx) {
              ctx.strokeStyle = 'rgba(0, 255, 156, 0.5)'
              ctx.setLineDash([3, 3])
              ctx.beginPath()
              ctx.moveTo(slPx.x, slPx.y)
              ctx.lineTo(tpPx.x, tpPx.y)
              ctx.stroke()
              ctx.setLineDash([])
            }
          }
        }
        // Resize knobs (4 corners/edges) for supported shapes
        if (supportsResizeKnobs(sel.kind)) {
          const pts = sel.points.map(toPixels)
          if (pts.every((p) => p !== null)) {
            const pp = pts as Pixel[]
            const tpY = sel.kind === 'long_position' || sel.kind === 'short_position'
              ? priceToY(sel.tpPrice ?? sel.points[0].price)
              : null
            const handles = getResizeHandles(sel, pp, size, tpY)
            for (const h of handles) {
              const handleColor = h.type === 'corner' ? '#00FF9C' : '#38BDF8'
              drawHandle({ x: h.x, y: h.y }, handleColor, true)
            }
          }
        }
      }
    }

    // Rubber-band preview while collecting anchors
    const pend = pendingRef.current
    if (pend.length > 0 && preview) {
      const first = toPixels(pend[0])
      if (first) {
        // Live position-plan preview: entry at the first click, SL under the
        // cursor, TP mirrored at 2R — zones render before commit
        if (activeTool === 'long_position' || activeTool === 'short_position') {
          const slPrice = priceAtY(preview.y)
          const entry = pend[0].price
          if (slPrice !== null) {
            const slDist = Math.abs(entry - slPrice)
            const tp = activeTool === 'long_position' ? entry + slDist * POSITION_RR : entry - slDist * POSITION_RR
            const idx = Math.max(0, Math.min(candles.length - 1, candleIndexAtX(preview.x)))
            const tmp: DrawingShape = {
              id: 'preview',
              kind: activeTool,
              points: [pend[0], { time: candles[idx]?.time ?? pend[0].time, price: slPrice }],
              tpPrice: tp,
            }
            const px0 = toPixels(tmp.points[0])
            const px1 = toPixels(tmp.points[1])
            if (px0 && px1) drawPositionPlan(ctx, tmp, [px0, px1], size, priceToY, market, pair)
          }
        } else {
          ctx.strokeStyle = LINE_COLOR
          ctx.setLineDash([4, 4])
          ctx.lineWidth = 1
          if (activeTool === 'rect' || activeTool === 'price_range') {
          ctx.strokeRect(Math.min(first.x, preview.x), Math.min(first.y, preview.y),
            Math.abs(preview.x - first.x), Math.abs(preview.y - first.y))
        } else if (pend.length >= 2) {
          // Third-anchor preview for channel/pitchfork: ghost copy offset to cursor
          const second = toPixels(pend[1])
          if (second) {
            const ox = preview.x - second.x
            const oy = preview.y - second.y
            ctx.beginPath()
            ctx.moveTo(first.x, first.y)
            ctx.lineTo(second.x, second.y)
            ctx.moveTo(first.x + ox, first.y + oy)
            ctx.lineTo(second.x + ox, second.y + oy)
            ctx.stroke()
          }
        } else {
          ctx.beginPath()
          ctx.moveTo(first.x, first.y)
          ctx.lineTo(preview.x, preview.y)
          ctx.stroke()
        }
        ctx.setLineDash([])
        }
      }
    }

    // Live measure readout while dragging
    const start = measureStartRef.current
    if (start && measureTo) {
      const p = toPixels(start)
      const q = toPixels(measureTo)
      if (p && q) {
        ctx.strokeStyle = '#E4E4E7'
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(q.x, q.y)
        ctx.stroke()
        ctx.setLineDash([])
        drawLabel(ctx, q.x + 10, q.y - 10, measureLabel(start, measureTo, candles, pair, market))
      }
    }

    // Keep the Execute/Delete badge anchored to the selected plan (effect-time,
    // not render-time, so chart refs stay out of the render path)
    const sel = selectedId
      ? drawings.find((d) => d.id === selectedId && (d.kind === 'long_position' || d.kind === 'short_position'))
      : null
    setBadgePos(sel ? toPixels(sel.points[0]) : null)
  }, [drawings, dragShape, selectedId, preview, measureTo, size, rangeTick, candles, activeTool, drawShape, toPixels, priceToY, candleIndexAtX, priceAtY, pair, market])

  // ── Pointer handling ──

  function localPos(e: React.PointerEvent): Pixel {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: React.PointerEvent) {
    const pos = localPos(e)
    const point = snap(pos.x, pos.y)

    if (!activeTool) return // cursor-mode editing runs on capture listeners

    if (!point) return

    if (activeTool === 'eraser') {
      const id = hitTest(pos)
      if (id) {
        onErase(id)
        if (selectedId === id) setSelectedId(null)
      }
      return
    }

    if (anchorsNeeded(activeTool) === 1) {
      if (activeTool === 'text') {
        setTextDraft({ id: null, anchor: point, x: pos.x, y: pos.y, value: '' })
      } else {
        const id = newId()
        onAdd({ id, kind: activeTool, points: [point] })
        setSelectedId(id)
      }
      return
    }

    if (activeTool === 'measure') {
      measureStartRef.current = point
      canvasRef.current?.setPointerCapture(e.pointerId)
      return
    }

    // Multi-click tools
    const next = [...pendingRef.current, point]
    if (next.length < anchorsNeeded(activeTool)) {
      pendingRef.current = next
      setPreview(pos)
      return
    }

    pendingRef.current = []
    setPreview(null)

    if (activeTool === 'long_position' || activeTool === 'short_position') {
      const id = newId()
      const entry = next[0].price
      const slDist = Math.abs(entry - next[1].price)
      const tp = activeTool === 'long_position' ? entry + slDist * POSITION_RR : entry - slDist * POSITION_RR
      onAdd({ id, kind: activeTool, points: [next[0], next[1]], tpPrice: tp })
      setSelectedId(id)
      return
    }

    const id = newId()
    onAdd({ id, kind: activeTool, points: next })
    setSelectedId(id)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!activeTool) return
    const pos = localPos(e)
    if (measureStartRef.current) {
      setMeasureTo(snap(pos.x, pos.y))
      return
    }
    if (pendingRef.current.length > 0) setPreview(pos)
  }

  function handlePointerUp() {
    const start = measureStartRef.current
    if (!start || !measureTo) return
    measureStartRef.current = null
    setMeasureTo(null)
    if (start.time === measureTo.time && Math.abs(start.price - measureTo.price) < 1e-9) return
    onAdd({ id: newId(), kind: 'measure', points: [start, measureTo], label: measureLabel(start, measureTo, candles, pair, market) })
  }

  /** Distance-based hit test against rendered geometry; returns shape id */
  /** Distance-based hit test against rendered geometry; delegates to the pure geometry module */
  function hitTest(pos: Pixel, opts?: { skipMeasure?: boolean }): string | null {
    return hitTestShapes(drawings, pos, { toPixels, priceToY, hitRadius: HIT_RADIUS, size }, opts)
  }

  // ── Edit interactions: select / drag body / drag anchors / TP handle ──
  // Capture-phase listeners on the chart container (cursor mode only) so a
  // drawing grab blocks chart pan and the SL/TP overlay, everything else
  // falls through.


  /** Handle under pos on shape: an anchor point, the position-plan TP, or a resize knob */
  /** Handle under pos on shape: anchor point, position-plan TP, or resize knob */
  function anchorHandleHit(pos: Pixel, shape: DrawingShape): { mode: 'anchor' | 'tp' | 'resize'; index: number } | null {
    return anchorHandleHitImpl(pos, shape, { toPixels, priceToY, hitRadius: HANDLE_RADIUS, size })
  }

  useEffect(() => {
    const container = canvasRef.current?.parentElement
    if (!container) return

    function local(e: PointerEvent | MouseEvent): Pixel {
      const rect = canvasRef.current!.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }


    function beginDrag(mode: 'body' | 'anchor' | 'tp' | 'resize', shape: DrawingShape, anchorIndex: number, pos: Pixel, e: PointerEvent) {
      editDragRef.current = {
        mode,
        shape: JSON.parse(JSON.stringify(shape)) as DrawingShape, // frozen snapshot — deltas stay relative to it
        anchorIndex,
        startPixel: pos,
        startCandleIdx: candleIndexAtX(pos.x),
        startPrice: priceAtY(pos.y) ?? 0,
        latest: undefined,
      }
      try {
        container!.setPointerCapture(e.pointerId)
      } catch {
        // pointer already released
      }
    }

    function onPointerDown(e: PointerEvent) {
      // Clicks on the floating badge/text editor are DOM UI, not chart picks —
      // let them reach the button instead of clearing selection / dragging
      if ((e.target as HTMLElement | null)?.closest?.('[data-drawing-badge]')) return
      if (activeTool !== null || e.button !== 0) return
      const pos = local(e)

      // 1) Handles on the already-selected shape win
      const sel = drawings.find((d) => d.id === selectedId)
      const h = sel ? anchorHandleHit(pos, sel) : null
      if (sel && h) {
        e.stopPropagation()
        e.preventDefault()
        beginDrag(h.mode, sel, h.index, pos, e)
        return
      }

      // 2) Body of any drawing: select it and start a whole-shape drag
      const id = hitTest(pos, { skipMeasure: true })
      if (id) {
        e.stopPropagation()
        e.preventDefault()
        const shape = drawings.find((d) => d.id === id)!
        setSelectedId(id)
        beginDrag('body', shape, -1, pos, e)
        return
      }

      setSelectedId(null)
    }

    function onPointerMove(e: PointerEvent) {
      const drag = editDragRef.current
      const pos = local(e)

      if (!drag) {
        // Hover cursor feedback
        if (activeTool === null) {
          const sel = drawings.find((d) => d.id === selectedId)
          let cursor = ''
          if (sel && anchorHandleHit(pos, sel)) {
            const hit = anchorHandleHit(pos, sel)
            if (hit?.mode === 'resize') cursor = getResizeCursor(hit.index, sel.kind)
            else cursor = 'pointer'
          } else if (hitTest(pos, { skipMeasure: true })) cursor = 'grab'
          container!.style.cursor = cursor
        }
        return
      }

      container!.style.cursor = drag.mode === 'resize' ? getResizeCursor(drag.anchorIndex, drag.shape.kind) : 'grabbing'
      const price = priceAtY(pos.y)
      if (price === null) return
      const dPrice = price - drag.startPrice
      const dIdx = candleIndexAtX(pos.x) - drag.startCandleIdx
      const lock = axisLock(drag.shape.kind)

      let next: DrawingShape
      if (drag.mode === 'tp') {
        next = {
          ...drag.shape,
          tpPrice: (drag.shape.tpPrice ?? drag.shape.points[0].price) + dPrice,
        }
      } else if (drag.mode === 'anchor') {
        const pts = drag.shape.points.map((p) => ({ ...p }))
        const orig = drag.shape.points[drag.anchorIndex]
        const origIdx = candles.findIndex((c) => c.time === orig.time)
        const shiftedIdx = Math.max(0, Math.min(candles.length - 1, origIdx + dIdx))
        pts[drag.anchorIndex] = {
          time: lock === 'lockX' ? orig.time : timeAtIdx(shiftedIdx) ?? orig.time,
          price: lock === 'lockY' ? orig.price : orig.price + dPrice,
        }
        next = { ...drag.shape, points: pts }
      } else if (drag.mode === 'resize') {
        next = handleResizeDrag(drag.shape, drag.anchorIndex, pos, drag.startPixel, candles, timeToX, priceToY, lock, candleIndexAtX, priceAtY)
      } else {
        // Whole-shape move: every point shifts by the same bar/price delta
        const pts = drag.shape.points.map((p) => {
          const origIdx = candles.findIndex((c) => c.time === p.time)
          const shiftedIdx = Math.max(0, Math.min(candles.length - 1, origIdx + dIdx))
          return {
            time: lock === 'lockX' ? p.time : timeAtIdx(shiftedIdx) ?? p.time,
            price: lock === 'lockY' ? p.price : p.price + dPrice,
          }
        })
        next = { ...drag.shape, points: pts }
        if (drag.shape.tpPrice != null && lock === null) {
          next.tpPrice = drag.shape.tpPrice + dPrice
        }
      }

      editDragRef.current = { ...drag, latest: next }
      setDragShape(next)
    }

    function onPointerUp() {
      const drag = editDragRef.current
      editDragRef.current = null
      container!.style.cursor = ''
      setDragShape(null)
      if (!drag || !drag.latest) return
      const patch: Partial<Pick<DrawingShape, 'points' | 'tpPrice' | 'label'>> = { points: drag.latest.points }
      if (drag.latest.tpPrice !== undefined) patch.tpPrice = drag.latest.tpPrice
      onEdit(drag.shape.id, patch)
    }

    function onDoubleClick(e: MouseEvent) {
      if (activeTool !== null) return
      const id = hitTest(local(e), { skipMeasure: true })
      const shape = drawings.find((d) => d.id === id)
      if (!shape || shape.kind !== 'text') return
      const px = toPixels(shape.points[0])
      setTextDraft({
        id: shape.id,
        anchor: null,
        x: px?.x ?? size.w / 2,
        y: px?.y ?? size.h / 2,
        value: shape.label ?? '',
      })
    }

    // Right-click on any drawing deletes it in place, regardless of active tool
    function onContextMenu(e: MouseEvent) {
      e.preventDefault()
      const pos = local(e)
      const id = hitTest(pos)
      if (!id) return
      onErase(id)
      if (selectedId === id) setSelectedId(null)
    }

    container.addEventListener('pointerdown', onPointerDown, true)
    container.addEventListener('pointermove', onPointerMove, true)
    container.addEventListener('pointerup', onPointerUp, true)
    container.addEventListener('dblclick', onDoubleClick, true)
    container.addEventListener('contextmenu', onContextMenu)
    return () => {
      container.removeEventListener('pointerdown', onPointerDown, true)
      container.removeEventListener('pointermove', onPointerMove, true)
      container.removeEventListener('pointerup', onPointerUp, true)
      container.removeEventListener('dblclick', onDoubleClick, true)
      container.removeEventListener('contextmenu', onContextMenu)
    }
    // anchorHandleHit/hitTest are plain per-render functions; `drawings` covers them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawings, selectedId, activeTool, candles, candleIndexAtX, priceAtY, timeAtIdx, toPixels, onEdit, onErase])

  // Keyboard: Delete/Backspace removes selected, Escape deselects
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.key === 'Escape') {
        setSelectedId(null)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        onErase(selectedId)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, onErase])

  // ── Selected position-planner badge ──

  function commitTextDraft() {
    if (!textDraft) return
    const label = textDraft.value.trim()
    if (label && textDraft.id === null && textDraft.anchor) {
      const id = newId()
      onAdd({ id, kind: 'text', points: [textDraft.anchor], label })
      setSelectedId(id)
    } else if (label && textDraft.id !== null) {
      onEdit(textDraft.id, { label })
    }
    setTextDraft(null)
  }

  const selectedShape = drawings.find((d) => d.id === selectedId)

  // Badge position for any selected drawing
  const anyBadgePos = selectedId
    ? (() => {
        const sel = drawings.find((d) => d.id === selectedId)
        if (!sel) return null
        const p0 = toPixels(sel.points[0])
        return p0
      })()
    : null

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-10"
        style={{ width: size.w, height: size.h, pointerEvents: interactive ? 'auto' : 'none', cursor: 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {selectedShape && anyBadgePos && (
        <div
          data-drawing-badge
          className="absolute z-30 flex items-center gap-1 rounded-md border border-[#27272A] bg-[#12141A]/95 px-1 py-1 shadow-lg"
          style={{ left: Math.max(4, Math.min(anyBadgePos.x, size.w - 180)), top: Math.max(4, anyBadgePos.y - 40) }}
        >
          {selectedShape.kind === 'long_position' || selectedShape.kind === 'short_position' ? (
            <button
              type="button"
              className="flex items-center gap-1 rounded bg-[#00FF9C] px-2 py-1 text-[11px] font-bold text-[#0A0B0E] hover:bg-[#00FF9C]/85"
              onClick={() => {
                onExecute(selectedShape)
                setSelectedId(null)
              }}
            >
              <Play className="h-3 w-3" /> Execute {selectedShape.kind === 'long_position' ? 'Long' : 'Short'}
            </button>
          ) : null}
          <button
            type="button"
            title="Delete drawing"
            aria-label="Delete drawing"
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-[#FF4D4D]/10 hover:text-[#FF4D4D]"
            onClick={() => {
              onErase(selectedShape.id)
              setSelectedId(null)
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {textDraft && (
        <div
          data-drawing-badge
          className="absolute z-40 flex items-center gap-1 rounded-md border border-[#27272A] bg-[#12141A]/95 p-1 shadow-lg"
          style={{
            left: Math.max(4, Math.min(textDraft.x, Math.max(4, size.w - 200))),
            top: Math.max(4, Math.min(textDraft.y - 16, Math.max(4, size.h - 44))),
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              commitTextDraft()
            }}
          >
            <input
              autoFocus
              type="text"
              value={textDraft.value}
              onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setTextDraft(null)
              }}
              onBlur={commitTextDraft}
              placeholder={textDraft.id ? 'Edit label' : 'Label text'}
              aria-label="Text annotation label"
              className="h-7 w-40 rounded border border-[#27272A] bg-[#0A0B0E] px-2 text-xs text-zinc-100 outline-none focus:border-[#00FF9C]/50"
            />
          </form>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={commitTextDraft}
            className="rounded bg-[#00FF9C] px-2 py-1 text-[11px] font-bold text-[#0A0B0E] hover:bg-[#00FF9C]/85"
          >
            Save
          </button>
        </div>
      )}
    </>
  )
}

// ── Helpers ──
function drawArrowHead(ctx: CanvasRenderingContext2D, from: Pixel, to: Pixel) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const len = 10
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(to.x - len * Math.cos(angle - Math.PI / 6), to.y - len * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(to.x - len * Math.cos(angle + Math.PI / 6), to.y - len * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  ctx.font = '11px ui-monospace, monospace'
  const w = ctx.measureText(text).width
  ctx.fillStyle = 'rgba(18, 20, 26, 0.9)'
  ctx.fillRect(x - 3, y - 11, w + 6, 15)
  ctx.fillStyle = '#E4E4E7'
  ctx.fillText(text, x, y)
}

function measureLabel(a: DrawingPoint, b: DrawingPoint, _candles: Candle[], pair: string, market: 'forex' | 'crypto'): string {
  const ps = pipSize(pair, market)
  const pips = Math.abs(a.price - b.price) / ps
  const digits = priceDigits(pair, market)
  return `${pips.toFixed(1)} pips · ${(b.price - a.price >= 0 ? '+' : '')}${(b.price - a.price).toFixed(digits)}`
}


function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatPrice(price: number, market: 'forex' | 'crypto', pair: string): string {
  return price.toFixed(priceDigits(pair, market))
}
