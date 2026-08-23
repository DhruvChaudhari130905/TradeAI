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
import { pipSize } from '@/lib/replay/execution'
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
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
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
  /** Position-planner Execute button (cursor-tool selection) */
  onExecute: (shape: DrawingShape) => void
}

interface Pixel {
  x: number
  y: number
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
  ctx.fillStyle = 'rgba(255, 77, 77, 0.15)'
  ctx.fillRect(x0, Math.min(entryY, slY), xEnd - x0, Math.abs(slY - entryY))
  ctx.fillStyle = 'rgba(0, 255, 156, 0.12)'
  ctx.fillRect(x0, Math.min(entryY, tpY), xEnd - x0, Math.abs(tpY - entryY))

  // Level lines
  const digits = market === 'crypto' ? 2 : pair.includes('JPY') ? 3 : 5
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
  // Selected position-planner (cursor tool only)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [badgePos, setBadgePos] = useState<Pixel | null>(null)

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
  function extendRay(p0: Pixel, dir: Pixel, w: number): Pixel {
    const dx = dir.x - p0.x
    const dy = dir.y - p0.y
    if (dx === 0 && dy === 0) return dir
    const scale = (w * 2) / Math.hypot(dx, dy)
    return { x: p0.x + dx * scale, y: p0.y + dy * scale }
  }

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
            ctx.fillText(`${(level * 100).toFixed(1)}%  ${formatPrice(price, market)}`, x2 + 4, y + 3)
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

    for (const shape of drawings) {
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

    // Rubber-band preview while collecting anchors
    const pend = pendingRef.current
    if (pend.length > 0 && preview) {
      const first = toPixels(pend[0])
      if (first) {
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
  }, [drawings, selectedId, preview, measureTo, size, rangeTick, candles, activeTool, drawShape, toPixels, pair, market])

  // ── Pointer handling ──

  function localPos(e: React.PointerEvent): Pixel {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: React.PointerEvent) {
    const pos = localPos(e)
    const point = snap(pos.x, pos.y)

    // Cursor mode: select/deselect position planners
    if (!activeTool) {
      const id = point ? hitTest(pos) : null
      setSelectedId(id && drawings.some((d) => d.id === id && (d.kind === 'long_position' || d.kind === 'short_position')) ? id : null)
      return
    }

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
        const label = window.prompt('Text label:')
        if (label && label.trim()) onAdd({ id: newId(), kind: 'text', points: [point], label: label.trim() })
      } else {
        onAdd({ id: newId(), kind: activeTool, points: [point] })
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
      const entry = next[0].price
      const slDist = Math.abs(entry - next[1].price)
      const tp = activeTool === 'long_position' ? entry + slDist * POSITION_RR : entry - slDist * POSITION_RR
      onAdd({ id: newId(), kind: activeTool, points: [next[0], next[1]], tpPrice: tp })
      return
    }

    onAdd({ id: newId(), kind: activeTool, points: next })
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
  function hitTest(pos: Pixel): string | null {
    for (let i = drawings.length - 1; i >= 0; i--) {
      const shape = drawings[i]
      const pts = shape.points.map(toPixels)
      if (pts.some((p) => p === null)) continue
      const pp = pts as Pixel[]
      let hit = false
      switch (shape.kind) {
        case 'hline':
        case 'hray':
          hit = pos.x >= pp[0].x - HIT_RADIUS && Math.abs(pp[0].y - pos.y) < HIT_RADIUS
          break
        case 'vline':
        case 'vray':
          hit = pos.y <= pp[0].y + HIT_RADIUS && Math.abs(pp[0].x - pos.x) < HIT_RADIUS
          break
        case 'trendline':
        case 'measure':
        case 'arrow':
          hit = distToSegment(pos, pp[0], pp[1]) < HIT_RADIUS
          break
        case 'ray': {
          const far = extendRay(pp[0], pp[1], size.w)
          hit = distToSegment(pos, pp[0], far) < HIT_RADIUS
          break
        }
        case 'channel': {
          const dx = pp[1].x - pp[0].x
          const dy = pp[1].y - pp[0].y
          hit =
            distToSegment(pos, pp[0], pp[1]) < HIT_RADIUS ||
            distToSegment(pos, { x: pp[0].x + dx, y: pp[0].y + dy }, { x: pp[1].x + dx, y: pp[1].y + dy }) < HIT_RADIUS
          break
        }
        case 'pitchfork': {
          const [a, b, c] = pp
          const mx = (b.x + c.x) / 2
          const my = (b.y + c.y) / 2
          const farM = extendRay(a, { x: mx, y: my }, size.w)
          hit =
            distToSegment(pos, a, farM) < HIT_RADIUS ||
            distToSegment(pos, b, { x: farM.x + b.x - mx, y: farM.y + b.y - my }) < HIT_RADIUS ||
            distToSegment(pos, c, { x: farM.x + c.x - mx, y: farM.y + c.y - my }) < HIT_RADIUS ||
            distToSegment(pos, a, b) < HIT_RADIUS ||
            distToSegment(pos, a, c) < HIT_RADIUS
          break
        }
        case 'rect': {
          const x1 = Math.min(pp[0].x, pp[1].x)
          const x2 = Math.max(pp[0].x, pp[1].x)
          const y1 = Math.min(pp[0].y, pp[1].y)
          const y2 = Math.max(pp[0].y, pp[1].y)
          hit = pos.x >= x1 && pos.x <= x2 && pos.y >= y1 && pos.y <= y2
          break
        }
        case 'price_range': {
          const x1 = Math.min(pp[0].x, pp[1].x)
          const x2 = Math.max(pp[0].x, pp[1].x)
          const y1 = Math.min(pp[0].y, pp[1].y)
          const y2 = Math.max(pp[0].y, pp[1].y)
          hit = pos.x >= x1 && pos.x <= x2 && pos.y >= y1 && pos.y <= y2
          break
        }
        case 'fib': {
          const [a, b] = shape.points
          const x1 = Math.min(pp[0].x, pp[1].x)
          const x2 = Math.max(pp[0].x, pp[1].x)
          if (pos.x >= x1 && pos.x <= x2) {
            for (const level of FIB_LEVELS) {
              const price = a.price + (b.price - a.price) * level
              const y = priceToY(price)
              if (y !== null && Math.abs(y - pos.y) < 6) {
                hit = true
                break
              }
            }
          }
          break
        }
        case 'text': {
          const w = (shape.label?.length ?? 4) * 6.6 + 8
          hit = pos.x >= pp[0].x - 4 && pos.x <= pp[0].x + w && pos.y >= pp[0].y - 14 && pos.y <= pp[0].y + 4
          break
        }
        case 'long_position':
        case 'short_position': {
          const entryY = priceToY(shape.points[0].price)
          const slY = priceToY(shape.points[1].price)
          const tpY = priceToY(shape.tpPrice ?? shape.points[0].price)
          if (entryY === null || slY === null || tpY === null) break
          const x0 = pp[0].x
          const x2 = Math.max(pp[0].x + 90, pp[1].x)
          const top = Math.min(entryY, slY, tpY)
          const bottom = Math.max(entryY, slY, tpY)
          hit = pos.x >= x0 - HIT_RADIUS && pos.x <= x2 + HIT_RADIUS && pos.y >= top - HIT_RADIUS && pos.y <= bottom + HIT_RADIUS
          break
        }
      }
      if (hit) return shape.id
    }
    return null
  }

  // ── Selected position-planner badge ──

  const selectedShape = drawings.find(
    (d) => d.id === selectedId && (d.kind === 'long_position' || d.kind === 'short_position'),
  )

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
      {!interactive && selectedShape && badgePos && (
        <div
          className="absolute z-30 flex items-center gap-1 rounded-md border border-[#27272A] bg-[#12141A]/95 px-1 py-1 shadow-lg"
          style={{ left: Math.max(4, Math.min(badgePos.x, size.w - 150)), top: Math.max(4, badgePos.y - 40) }}
        >
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
          <button
            type="button"
            title="Delete plan"
            aria-label="Delete plan"
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
  const digits = market === 'crypto' ? 2 : pair.includes('JPY') ? 3 : 5
  return `${pips.toFixed(1)} pips · ${(b.price - a.price >= 0 ? '+' : '')}${(b.price - a.price).toFixed(digits)}`
}

function distToSegment(p: Pixel, a: Pixel, b: Pixel): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatPrice(price: number, market: 'forex' | 'crypto'): string {
  return market === 'crypto' ? price.toFixed(2) : price.toFixed(5)
}
