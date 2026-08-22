'use client'

// Canvas drawing overlay over the candlestick chart. Converts between chart
// coordinates (time/price) and pixels via the lightweight-charts APIs so
// drawings stay anchored while panning/zooming.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import type { Candle, DrawingKind, DrawingPoint, DrawingShape } from '@/lib/types/replay'
import { toChartTime } from '@/lib/replay/time'
import { pipSize } from '@/lib/replay/execution'
import { newId } from '@/lib/replay/simulation'

export type DrawTool = DrawingKind | 'eraser'

export const DRAW_TOOLS: DrawTool[] = ['hline', 'vline', 'trendline', 'rect', 'fib', 'text', 'measure', 'eraser']

const LINE_COLOR = '#38BDF8'
const FIB_COLOR = '#D4A24E'
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
const HIT_RADIUS = 8

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
}

interface Pixel {
  x: number
  y: number
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
}: DrawingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [rangeTick, setRangeTick] = useState(0)
  // First anchor of a two-click tool; null when idle
  const pendingRef = useRef<DrawingPoint | null>(null)
  const [preview, setPreview] = useState<Pixel | null>(null)
  // Measure drag state
  const measureStartRef = useRef<DrawingPoint | null>(null)
  const [measureTo, setMeasureTo] = useState<DrawingPoint | null>(null)

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
      }
    },
    [toPixels, size, priceToY, market],
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

    for (const shape of drawings) drawShape(ctx, shape)

    // Pending first anchor marker + rubber band to cursor
    const pending = pendingRef.current
    if (pending && preview) {
      const p = toPixels(pending)
      if (p) {
        ctx.strokeStyle = LINE_COLOR
        ctx.setLineDash([4, 4])
        ctx.lineWidth = 1
        if (activeTool === 'rect') {
          ctx.strokeRect(Math.min(p.x, preview.x), Math.min(p.y, preview.y), Math.abs(preview.x - p.x), Math.abs(preview.y - p.y))
        } else {
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
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
  }, [drawings, preview, measureTo, size, rangeTick, candles, activeTool, drawShape, toPixels, pair, market])

  // ── Pointer handling ──

  function localPos(e: React.PointerEvent): Pixel {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!activeTool) return
    const pos = localPos(e)
    const point = snap(pos.x, pos.y)
    if (!point) return

    if (activeTool === 'eraser') {
      const id = hitTest(pos)
      if (id) onErase(id)
      return
    }

    if (activeTool === 'hline' || activeTool === 'vline') {
      onAdd({ id: newId(), kind: activeTool, points: [point] })
      return
    }

    if (activeTool === 'text') {
      const label = window.prompt('Text label:')
      if (label && label.trim()) onAdd({ id: newId(), kind: 'text', points: [point], label: label.trim() })
      return
    }

    if (activeTool === 'measure') {
      measureStartRef.current = point
      canvasRef.current?.setPointerCapture(e.pointerId)
      return
    }

    // Two-click tools: trendline / rect / fib
    const pending = pendingRef.current
    if (!pending) {
      pendingRef.current = point
      setPreview(pos)
    } else {
      pendingRef.current = null
      setPreview(null)
      onAdd({ id: newId(), kind: activeTool, points: [pending, point] })
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!activeTool) return
    const pos = localPos(e)
    if (measureStartRef.current) {
      setMeasureTo(snap(pos.x, pos.y))
      return
    }
    if (pendingRef.current) setPreview(pos)
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
          hit = Math.abs(pp[0].y - pos.y) < HIT_RADIUS
          break
        case 'vline':
          hit = Math.abs(pp[0].x - pos.x) < HIT_RADIUS
          break
        case 'trendline':
        case 'measure':
          hit = distToSegment(pos, pp[0], pp[1]) < HIT_RADIUS
          break
        case 'rect': {
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
      }
      if (hit) return shape.id
    }
    return null
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-10"
      style={{ width: size.w, height: size.h, pointerEvents: interactive ? 'auto' : 'none', cursor: 'crosshair' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  )
}

// ── Helpers ──

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  ctx.font = '11px ui-monospace, monospace'
  const w = ctx.measureText(text).width
  ctx.fillStyle = 'rgba(18, 20, 26, 0.9)'
  ctx.fillRect(x - 3, y - 11, w + 6, 15)
  ctx.fillStyle = '#E4E4E7'
  ctx.fillText(text, x, y)
}

function measureLabel(a: DrawingPoint, b: DrawingPoint, candles: Candle[], pair: string, market: 'forex' | 'crypto'): string {
  const ps = pipSize(pair, market)
  const pips = Math.abs(a.price - b.price) / ps
  const ia = candles.findIndex((c) => c.time === a.time)
  const ib = candles.findIndex((c) => c.time === b.time)
  const bars = ia >= 0 && ib >= 0 ? Math.abs(ib - ia) : 0
  const digits = market === 'crypto' ? 2 : pair.includes('JPY') ? 3 : 5
  return `${pips.toFixed(1)} pips · ${bars} bars · ${(b.price - a.price >= 0 ? '+' : '')}${(b.price - a.price).toFixed(digits)}`
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
