// Pure drawing geometry for the replay chart overlays: hit-testing, resize
// handles, resize math, axis locks. Functions of shapes + pixels only —
// no React, no canvas, no chart instance. Coordinate conversion is injected
// (toPixels / priceToY) so tests run against plain objects.

import type { Candle, DrawingKind, DrawingPoint, DrawingShape } from '@/lib/types/replay'

export interface Pixel {
  x: number
  y: number
}

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

export const HANDLE_RADIUS = 10

export type ResizeHandle = { x: number; y: number; cursor: string; type: 'corner' | 'edge'; index: number }

export interface GeometryCtx {
  toPixels: (p: DrawingPoint) => Pixel | null
  priceToY: (price: number) => number | null
  hitRadius: number
  size: { w: number; h: number }
}

/** Kinds whose whole-body move is locked to one axis */
export function axisLock(kind: DrawingKind): 'lockX' | 'lockY' | null {
  if (kind === 'hline' || kind === 'hray' || kind === 'text') return 'lockX'
  if (kind === 'vline' || kind === 'vray') return 'lockY'
  return null
}

/** Kinds that support 4-corner/edge resize knobs */
export function supportsResizeKnobs(kind: DrawingKind): boolean {
  return ['rect', 'price_range', 'channel', 'pitchfork', 'trendline', 'ray', 'arrow', 'fib', 'long_position', 'short_position'].includes(kind)
}

export function extendRay(p0: Pixel, dir: Pixel, w: number): Pixel {
  const dx = dir.x - p0.x
  const dy = dir.y - p0.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return { ...p0 }
  const scale = (w * 2) / len
  return { x: p0.x + dx * scale, y: p0.y + dy * scale }
}

export function distToSegment(p: Pixel, a: Pixel, b: Pixel): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Get the 4 corner/edge handle positions for a shape in pixel coords.
 *  tpY: pixel Y of the take-profit level (position planner kinds only, else null). */
export function getResizeHandles(shape: DrawingShape, pp: Pixel[], size: { w: number; h: number }, tpY: number | null): ResizeHandle[] {
  const handles: ResizeHandle[] = []

  switch (shape.kind) {
    case 'long_position':
    case 'short_position': {
      // Box spans entry-time..SL-time horizontally and entry/SL/TP prices vertically
      const x1 = Math.min(pp[0].x, pp[1].x)
      const x2 = Math.max(pp[0].x + 90, pp[1].x)
      const tp = tpY ?? pp[0].y
      const y1 = Math.min(pp[0].y, pp[1].y, tp)
      const y2 = Math.max(pp[0].y, pp[1].y, tp)
      handles.push(
        { x: x1, y: y1, cursor: 'nwse-resize', type: 'corner', index: 0 }, // top-left
        { x: x2, y: y1, cursor: 'nesw-resize', type: 'corner', index: 1 }, // top-right
        { x: x2, y: y2, cursor: 'nwse-resize', type: 'corner', index: 2 }, // bottom-right
        { x: x1, y: y2, cursor: 'nesw-resize', type: 'corner', index: 3 }, // bottom-left
      )
      break
    }
    case 'rect':
    case 'price_range': {
      const x1 = Math.min(pp[0].x, pp[1].x)
      const x2 = Math.max(pp[0].x, pp[1].x)
      const y1 = Math.min(pp[0].y, pp[1].y)
      const y2 = Math.max(pp[0].y, pp[1].y)
      handles.push(
        { x: x1, y: y1, cursor: 'nwse-resize', type: 'corner', index: 0 },
        { x: x2, y: y1, cursor: 'nesw-resize', type: 'corner', index: 1 },
        { x: x2, y: y2, cursor: 'nwse-resize', type: 'corner', index: 2 },
        { x: x1, y: y2, cursor: 'nesw-resize', type: 'corner', index: 3 },
      )
      break
    }
    case 'channel': {
      const ox = pp[2].x - pp[0].x
      const oy = pp[2].y - pp[0].y
      const p3 = { x: pp[1].x + ox, y: pp[1].y + oy }
      handles.push(
        { x: pp[0].x, y: pp[0].y, cursor: 'nwse-resize', type: 'corner', index: 0 },
        { x: pp[1].x, y: pp[1].y, cursor: 'nesw-resize', type: 'corner', index: 1 },
        { x: p3.x, y: p3.y, cursor: 'nwse-resize', type: 'corner', index: 2 },
        { x: pp[2].x, y: pp[2].y, cursor: 'nesw-resize', type: 'corner', index: 3 },
      )
      break
    }
    case 'pitchfork': {
      handles.push(
        { x: pp[0].x, y: pp[0].y, cursor: 'move', type: 'corner', index: 0 },
        { x: pp[1].x, y: pp[1].y, cursor: 'move', type: 'corner', index: 1 },
        { x: pp[2].x, y: pp[2].y, cursor: 'move', type: 'corner', index: 2 },
      )
      break
    }
    case 'trendline':
    case 'ray':
    case 'arrow':
    case 'fib': {
      handles.push(
        { x: pp[0].x, y: pp[0].y, cursor: 'move', type: 'edge', index: 0 },
        { x: pp[1].x, y: pp[1].y, cursor: 'move', type: 'edge', index: 1 },
      )
      break
    }
  }
  return handles
}

export function getResizeCursor(index: number, kind: DrawingKind): string {
  if (kind === 'rect' || kind === 'price_range') {
    const cursors = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize']
    return cursors[index] ?? 'move'
  }
  if (kind === 'channel' || kind === 'pitchfork') {
    return 'move'
  }
  if (kind === 'trendline' || kind === 'ray' || kind === 'arrow') {
    return 'move'
  }
  if (kind === 'fib') {
    return 'ns-resize'
  }
  if (kind === 'long_position' || kind === 'short_position') {
    const cursors = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize']
    return cursors[index] ?? 'move'
  }
  return 'move'
}

/** Handle under pos on shape: an anchor point, the position-plan TP, or a resize knob */
export function anchorHandleHit(
  pos: Pixel,
  shape: DrawingShape,
  ctx: GeometryCtx,
): { mode: 'anchor' | 'tp' | 'resize'; index: number } | null {
  if (shape.kind === 'measure') return null
  const R = ctx.hitRadius
  // Check anchor points first
  for (let i = 0; i < shape.points.length; i++) {
    const px = ctx.toPixels(shape.points[i])
    if (px && Math.hypot(px.x - pos.x, px.y - pos.y) <= R) return { mode: 'anchor', index: i }
  }
  // Check position-plan TP handle
  if (shape.kind === 'long_position' || shape.kind === 'short_position') {
    const tpPx = ctx.toPixels({ time: shape.points[1]?.time ?? shape.points[0].time, price: shape.tpPrice ?? shape.points[0].price })
    if (tpPx && Math.hypot(tpPx.x - pos.x, tpPx.y - pos.y) <= R + 2) return { mode: 'tp', index: -1 }
  }
  // Check resize knobs (4 corners/edges for supported shapes)
  if (supportsResizeKnobs(shape.kind)) {
    const pts = shape.points.map(ctx.toPixels)
    if (pts.every((p) => p !== null)) {
      const pp = pts as Pixel[]
      const tpY = shape.kind === 'long_position' || shape.kind === 'short_position'
        ? ctx.priceToY(shape.tpPrice ?? shape.points[0].price)
        : null
      const handles = getResizeHandles(shape, pp, ctx.size, tpY)
      for (const h of handles) {
        if (Math.hypot(h.x - pos.x, h.y - pos.y) <= R + 2) return { mode: 'resize', index: h.index }
      }
    }
  }
  return null
}

/** Distance-based hit test against rendered geometry; returns shape id */
export function hitTestShapes(
  shapes: DrawingShape[],
  pos: Pixel,
  ctx: GeometryCtx,
  opts?: { skipMeasure?: boolean },
): string | null {
  const R = ctx.hitRadius
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i]
    if (opts?.skipMeasure && shape.kind === 'measure') continue
    const pts = shape.points.map(ctx.toPixels)
    if (pts.some((p) => p === null)) continue
    const pp = pts as Pixel[]
    let hit = false
    switch (shape.kind) {
      case 'hline':
      case 'hray':
        hit = pos.x >= pp[0].x - R && Math.abs(pp[0].y - pos.y) < R
        break
      case 'vline':
      case 'vray':
        hit = pos.y <= pp[0].y + R && Math.abs(pp[0].x - pos.x) < R
        break
      case 'trendline':
      case 'measure':
      case 'arrow':
        hit = distToSegment(pos, pp[0], pp[1]) < R
        break
      case 'ray': {
        const far = extendRay(pp[0], pp[1], ctx.size.w)
        hit = distToSegment(pos, pp[0], far) < R
        break
      }
      case 'channel': {
        const dx = pp[1].x - pp[0].x
        const dy = pp[1].y - pp[0].y
        hit =
          distToSegment(pos, pp[0], pp[1]) < R ||
          distToSegment(pos, { x: pp[0].x + dx, y: pp[0].y + dy }, { x: pp[1].x + dx, y: pp[1].y + dy }) < R
        break
      }
      case 'pitchfork': {
        const [a, b, c] = pp
        const mx = (b.x + c.x) / 2
        const my = (b.y + c.y) / 2
        const farM = extendRay(a, { x: mx, y: my }, ctx.size.w)
        hit =
          distToSegment(pos, a, farM) < R ||
          distToSegment(pos, b, { x: farM.x + b.x - mx, y: farM.y + b.y - my }) < R ||
          distToSegment(pos, c, { x: farM.x + c.x - mx, y: farM.y + c.y - my }) < R ||
          distToSegment(pos, a, b) < R ||
          distToSegment(pos, a, c) < R
        break
      }
      case 'rect':
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
            const y = ctx.priceToY(price)
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
        const entryY = ctx.priceToY(shape.points[0].price)
        const slY = ctx.priceToY(shape.points[1].price)
        const tpY = ctx.priceToY(shape.tpPrice ?? shape.points[0].price)
        if (entryY === null || slY === null || tpY === null) break
        const x0 = pp[0].x
        const x2 = Math.max(pp[0].x + 90, pp[1].x)
        const top = Math.min(entryY, slY, tpY)
        const bottom = Math.max(entryY, slY, tpY)
        hit = pos.x >= x0 - R && pos.x <= x2 + R && pos.y >= top - R && pos.y <= bottom + R
        break
      }
    }
    if (hit) return shape.id
  }
  return null
}

/** Resize drag: apply a corner/edge drag to a shape snapshot. Pure — deltas
 *  come from injected candle-index and price converters. */
export function handleResizeDrag(
  shape: DrawingShape,
  handleIndex: number,
  pos: Pixel,
  startPixel: Pixel,
  candles: Candle[],
  timeToX: (time: string) => number | null,
  priceToY: (price: number) => number | null,
  lock: 'lockX' | 'lockY' | null,
  candleIndexAtX: (x: number) => number,
  priceAtY: (y: number) => number | null,
): DrawingShape {
  const pts = shape.points.map((p) => ({ ...p }))

  // Calculate deltas from drag start in terms of candle index and price
  const dIdx = candleIndexAtX(pos.x) - candleIndexAtX(startPixel.x)
  const dPrice = (priceAtY(pos.y) ?? 0) - (priceAtY(startPixel.y) ?? 0)

  switch (shape.kind) {
    case 'long_position':
    case 'short_position': {
      // Handle index: 0=top-left, 1=top-right, 2=bottom-right, 3=bottom-left.
      // Horizontal: move the leftmost/rightmost point's time. Vertical: move
      // whichever of entry/SL/TP sits at the top/bottom edge in the snapshot.
      const isLeft = handleIndex === 0 || handleIndex === 3
      const isTop = handleIndex === 0 || handleIndex === 1
      const leftIdx = pts[0].time <= (pts[1]?.time ?? pts[0].time) ? 0 : 1
      const rightIdx = 1 - leftIdx
      if (lock !== 'lockX') {
        const timeIdx = isLeft ? leftIdx : rightIdx
        const origIdx = candles.findIndex((c) => c.time === pts[timeIdx].time)
        const shiftedIdx = Math.max(0, Math.min(candles.length - 1, origIdx + dIdx))
        pts[timeIdx].time = candles[shiftedIdx].time
      }
      let tpTouched = false
      let tpNew = shape.tpPrice
      if (lock !== 'lockY') {
        const tp = shape.tpPrice ?? pts[0].price
        const slots: Array<{ slot: 'entry' | 'sl' | 'tp'; price: number }> = [
          { slot: 'entry', price: pts[0].price },
          { slot: 'sl', price: pts[1].price },
          { slot: 'tp', price: tp },
        ]
        const target = isTop
          ? slots.reduce((a, b) => (b.price > a.price ? b : a))
          : slots.reduce((a, b) => (b.price < a.price ? b : a))
        if (target.slot === 'tp') {
          tpTouched = true
          tpNew = tp + dPrice
        } else {
          pts[target.slot === 'entry' ? 0 : 1].price += dPrice
        }
      }
      return tpTouched ? { ...shape, points: pts, tpPrice: tpNew } : { ...shape, points: pts }
    }
    case 'rect':
    case 'price_range': {
      // Handle index: 0=top-left, 1=top-right, 2=bottom-right, 3=bottom-left
      const isLeft = handleIndex === 0 || handleIndex === 3
      const isTop = handleIndex === 0 || handleIndex === 1

      if (lock !== 'lockX') {
        // Move the left or right edge in time
        const targetIdx = isLeft ? 0 : 1
        const origIdx = candles.findIndex((c) => c.time === pts[targetIdx].time)
        const shiftedIdx = Math.max(0, Math.min(candles.length - 1, origIdx + dIdx))
        pts[targetIdx].time = candles[shiftedIdx].time
      }
      if (lock !== 'lockY') {
        // Move the top or bottom edge in price
        const targetIdx = isTop ? 0 : 1
        pts[targetIdx].price += dPrice
      }
      break
    }
    case 'channel':
    case 'pitchfork':
    case 'trendline':
    case 'ray':
    case 'arrow':
    case 'fib': {
      // Move the specific anchor point (channel corner / pitchfork / endpoint)
      const origIdx = candles.findIndex((c) => c.time === pts[handleIndex].time)
      const shiftedIdx = Math.max(0, Math.min(candles.length - 1, origIdx + dIdx))
      pts[handleIndex] = {
        time: lock === 'lockX' ? pts[handleIndex].time : candles[shiftedIdx].time,
        price: lock === 'lockY' ? pts[handleIndex].price : pts[handleIndex].price + dPrice,
      }
      break
    }
  }
  return { ...shape, points: pts }
}
