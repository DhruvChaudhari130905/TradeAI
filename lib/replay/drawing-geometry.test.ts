import { describe, expect, it } from 'vitest'
import {
  anchorHandleHit,
  axisLock,
  distToSegment,
  extendRay,
  getResizeCursor,
  getResizeHandles,
  HANDLE_RADIUS,
  handleResizeDrag,
  hitTestShapes,
  supportsResizeKnobs,
  type GeometryCtx,
  type Pixel,
} from './drawing-geometry'
import type { Candle, DrawingPoint, DrawingShape } from '@/lib/types/replay'

// Linear fake chart: x = candle index × 10, y = 1000 − price
const candles: Candle[] = ['t0', 't1', 't2', 't3', 't4', 't5'].map((time) => ({
  time, open: 1, high: 1, low: 1, close: 1,
}))
const toPixels = (p: DrawingPoint): Pixel | null => {
  const idx = candles.findIndex((c) => c.time === p.time)
  return idx === -1 ? null : { x: idx * 10, y: 1000 - p.price }
}
const priceToY = (price: number) => 1000 - price
const ctx: GeometryCtx = { toPixels, priceToY, hitRadius: HANDLE_RADIUS, size: { w: 1000, h: 1000 } }

const pt = (time: string, price: number): DrawingPoint => ({ time, price })
const shape = (kind: DrawingShape['kind'], points: DrawingPoint[], extra: Partial<DrawingShape> = {}): DrawingShape =>
  ({ id: 's1', kind, points, ...extra })

describe('axisLock', () => {
  it('locks horizontal kinds in X, vertical in Y, nothing else', () => {
    expect(axisLock('hline')).toBe('lockX')
    expect(axisLock('vline')).toBe('lockY')
    expect(axisLock('trendline')).toBeNull()
  })
})

describe('supportsResizeKnobs', () => {
  it('covers box kinds and position planners, not text/measure', () => {
    expect(supportsResizeKnobs('rect')).toBe(true)
    expect(supportsResizeKnobs('long_position')).toBe(true)
    expect(supportsResizeKnobs('text')).toBe(false)
    expect(supportsResizeKnobs('measure')).toBe(false)
  })
})

describe('getResizeHandles', () => {
  it('returns 4 corners for a rect', () => {
    const s = shape('rect', [pt('t0', 900), pt('t2', 800)])
    const h = getResizeHandles(s, s.points.map(toPixels) as Pixel[], ctx.size, null)
    expect(h).toHaveLength(4)
    expect(h[0]).toMatchObject({ x: 0, y: 100, index: 0 }) // top-left
    expect(h[2]).toMatchObject({ x: 20, y: 200, index: 2 }) // bottom-right
  })
  it('position box corners span entry/SL/TP extremes and the 90px width floor', () => {
    const s = shape('long_position', [pt('t0', 900), pt('t1', 950)], { tpPrice: 960 })
    const h = getResizeHandles(s, s.points.map(toPixels) as Pixel[], ctx.size, priceToY(960))
    // y range: 1000−960=40 (top) .. 1000−900=100 (bottom); x: 0..max(90,10)=90
    expect(h[0]).toMatchObject({ x: 0, y: 40 })
    expect(h[1]).toMatchObject({ x: 90, y: 40 })
    expect(h[2]).toMatchObject({ x: 90, y: 100 })
    expect(h[3]).toMatchObject({ x: 0, y: 100 })
  })
})

describe('handleResizeDrag', () => {
  it('rect top-left corner moves both edges', () => {
    const s = shape('rect', [pt('t0', 900), pt('t2', 800)])
    const out = handleResizeDrag(
      s, 0, { x: 30, y: 120 }, { x: 0, y: 100 },
      candles, (t) => toPixels(pt(t, 1))?.x ?? null, priceToY, null,
      (x) => Math.round(x / 10), (y) => 1000 - y,
    )
    expect(out.points[0]).toEqual(pt('t3', 880))
    expect(out.points[1]).toEqual(pt('t2', 800))
  })
  it('position top handle moves whichever slot holds the top price (here TP)', () => {
    const s = shape('long_position', [pt('t0', 900), pt('t1', 950)], { tpPrice: 960 })
    const out = handleResizeDrag(
      s, 0, { x: 20, y: 30 }, { x: 10, y: 40 },
      candles, (t) => toPixels(pt(t, 1))?.x ?? null, priceToY, null,
      (x) => Math.round(x / 10), (y) => 1000 - y,
    )
    expect(out.tpPrice).toBe(970) // dragged up 10
    expect(out.points[0].price).toBe(900) // entry untouched
    expect(out.points[0].time).toBe('t1') // left edge moved one bar right
  })
})

describe('hitTestShapes', () => {
  it('hits a rect inside its bounds and misses outside', () => {
    const s = shape('rect', [pt('t0', 900), pt('t2', 800)])
    expect(hitTestShapes([s], { x: 10, y: 150 }, ctx)).toBe('s1')
    expect(hitTestShapes([s], { x: 500, y: 150 }, ctx)).toBeNull()
  })
  it('hits the most recent (topmost) shape', () => {
    const a = shape('rect', [pt('t0', 900), pt('t2', 800)])
    const b = { ...shape('rect', [pt('t0', 900), pt('t2', 800)]), id: 's2' }
    expect(hitTestShapes([a, b], { x: 10, y: 150 }, ctx)).toBe('s2')
  })
  it('skips measure shapes when asked', () => {
    const s = shape('measure', [pt('t0', 900), pt('t2', 800)])
    expect(hitTestShapes([s], { x: 10, y: 150 }, ctx, { skipMeasure: true })).toBeNull()
  })
  it('position box hit includes TP extremes', () => {
    const s = shape('long_position', [pt('t0', 900), pt('t1', 950)], { tpPrice: 960 })
    expect(hitTestShapes([s], { x: 50, y: 50 }, ctx)).toBe('s1')
    expect(hitTestShapes([s], { x: 50, y: 500 }, ctx)).toBeNull()
  })
})

describe('anchorHandleHit', () => {
  it('prefers anchors over resize knobs and honours TP handle', () => {
    const s = shape('long_position', [pt('t0', 900), pt('t1', 950)], { tpPrice: 960 })
    // exactly on points[0] → anchor
    expect(anchorHandleHit({ x: 0, y: 100 }, s, ctx)).toMatchObject({ mode: 'anchor', index: 0 })
    // on the TP handle (t1 time, 960 price), clear of the SL anchor → tp
    expect(anchorHandleHit({ x: 11, y: 39 }, s, ctx)).toMatchObject({ mode: 'tp', index: -1 })
    // bottom-right knob → resize index 2
    expect(anchorHandleHit({ x: 90, y: 100 }, s, ctx)).toMatchObject({ mode: 'resize', index: 2 })
  })
  it('never hits measure shapes', () => {
    const s = shape('measure', [pt('t0', 900), pt('t2', 800)])
    expect(anchorHandleHit({ x: 0, y: 100 }, s, ctx)).toBeNull()
  })
})

describe('geometry utils', () => {
  it('distToSegment measures perpendicular distance and clamps at ends', () => {
    expect(distToSegment({ x: 5, y: 5 }, { x: 0, y: 10 }, { x: 10, y: 10 })).toBe(5)
    expect(distToSegment({ x: -5, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 10 })).toBe(5) // clamped to endpoint
  })
  it('extendRay scales a direction beyond the chart width', () => {
    const far = extendRay({ x: 0, y: 0 }, { x: 10, y: 0 }, 1000)
    expect(far.x).toBeGreaterThan(1000)
  })
  it('resize cursors follow the corner map for boxes and positions', () => {
    expect(getResizeCursor(0, 'rect')).toBe('nwse-resize')
    expect(getResizeCursor(1, 'long_position')).toBe('nesw-resize')
    expect(getResizeCursor(0, 'fib')).toBe('ns-resize')
  })
})
