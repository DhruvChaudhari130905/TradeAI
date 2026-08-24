'use client'

// Candlestick chart over lightweight-charts v5: trade markers, indicator
// overlays/sub-panes, drawing overlay canvas.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import type {
  Candle,
  ClosedReplayTrade,
  DrawingShape,
  OverlayIndicatorType,
  PendingOrder,
  ReplayIndicatorConfig,
  ReplayPosition,
} from '@/lib/types/replay'
import { toChartTime } from '@/lib/replay/time'
import { computeIndicators, type IndicatorSeries } from '@/lib/replay/indicators'
import { DrawingOverlay, type DrawTool } from './DrawingOverlay'
import { SlTpOverlay, type SlTpPatch } from './SlTpOverlay'

const GREEN = '#00FF9C'
const RED = '#FF4D4D'

const INDICATOR_COLORS: Record<OverlayIndicatorType, string> = {
  EMA: '#F59E0B',
  SMA: '#60A5FA',
  BBANDS: '#71717A',
  RSI: '#A78BFA',
  MACD: '#38BDF8',
  ATR: '#FBBF24',
  STOCH: '#34D399',
  ADX: '#F472B6',
  VWAP: '#E879F9',
}

export interface TradeMarkerData {
  positions: ReplayPosition[]
  closedTrades: ClosedReplayTrade[]
}

interface ChartPanelProps {
  candles: Candle[]
  markers: TradeMarkerData
  pair: string
  market: 'forex' | 'crypto'
  drawings: DrawingShape[]
  drawingsHidden: boolean
  activeTool: DrawTool | null
  indicatorConfigs: ReplayIndicatorConfig[]
  positions: ReplayPosition[]
  orders: PendingOrder[]
  draftSl: number | null
  draftTp: number | null
  currentPrice: number | null
  equity: number
  onAddDrawing: (shape: DrawingShape) => void
  onEraseDrawing: (id: string) => void
  onEditDrawing: (id: string, patch: Partial<Pick<DrawingShape, 'points' | 'tpPrice' | 'label'>>) => void
  onExecutePositionDrawing: (shape: DrawingShape) => void
  onSlTpCommit: (patch: SlTpPatch) => void
}

// One rendered indicator line/band; sub picks a member of multi-series output
interface IndicatorHandle {
  series: ISeriesApi<'Line'> | ISeriesApi<'Histogram'>
  baseKey: string   // canonical map key: "ema_9", "rsi_14", "macd", "bbands"
  sub?: keyof IndicatorSeries
  histogram?: boolean
}

function toCandleData(candles: Candle[]): CandlestickData<UTCTimestamp>[] {
  return candles.map((c) => ({
    time: toChartTime(c.time) as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }))
}

function buildMarkers(data: TradeMarkerData): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = []

  for (const p of data.positions) {
    markers.push({
      time: toChartTime(p.entryTime) as Time,
      position: p.direction === 'long' ? 'belowBar' : 'aboveBar',
      color: p.direction === 'long' ? GREEN : RED,
      shape: p.direction === 'long' ? 'arrowUp' : 'arrowDown',
      text: `${p.direction === 'long' ? 'L' : 'S'} ${p.lotSize}`,
    })
  }
  for (const t of data.closedTrades) {
    markers.push({
      time: toChartTime(t.exitTime) as Time,
      position: t.direction === 'long' ? 'aboveBar' : 'belowBar',
      color: t.pnlUsd >= 0 ? GREEN : RED,
      shape: 'circle',
      text: `${t.pnlUsd >= 0 ? '+' : ''}${t.pnlUsd.toFixed(0)}`,
    })
  }

  // lightweight-charts requires markers sorted by time
  markers.sort((a, b) => (a.time as number) - (b.time as number))
  return markers
}

function lineData(values: number[] | undefined, candles: Candle[]): LineData<UTCTimestamp>[] {
  if (!values) return []
  const out: LineData<UTCTimestamp>[] = []
  for (let i = 0; i < values.length && i < candles.length; i++) {
    const v = values[i]
    if (!Number.isNaN(v)) {
      out.push({ time: toChartTime(candles[i].time) as UTCTimestamp, value: v })
    }
  }
  return out
}

export function ChartPanel({
  candles,
  markers,
  pair,
  market,
  drawings,
  drawingsHidden,
  activeTool,
  indicatorConfigs,
  positions,
  orders,
  draftSl,
  draftTp,
  currentPrice,
  equity,
  onAddDrawing,
  onEraseDrawing,
  onEditDrawing,
  onExecutePositionDrawing,
  onSlTpCommit,
}: ChartPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const indicatorHandlesRef = useRef<IndicatorHandle[]>([])
  const prevLenRef = useRef(0)
  const prevLastTimeRef = useRef<number | null>(null)
  const [chartReady, setChartReady] = useState(false)

  const candleData = useMemo(() => toCandleData(candles), [candles])
  const markerData = useMemo(() => buildMarkers(markers), [markers])

  const visibleConfigs = useMemo(() => indicatorConfigs.filter((c) => c.visible), [indicatorConfigs])
  const configKey = visibleConfigs.map((c) => `${c.type}:${JSON.stringify(c.params)}`).join('|')
  const indicatorResults = useMemo(
    () =>
      computeIndicators(
        candles,
        visibleConfigs.map((c) => ({ type: c.type, params: c.params })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candles, configKey],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#0A0B0E' },
        textColor: '#A1A1AA',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#181A20' },
        horzLines: { color: '#181A20' },
      },
      rightPriceScale: { borderColor: '#27272A' },
      timeScale: {
        borderColor: '#27272A',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: '#52525B', labelBackgroundColor: '#27272A' },
        horzLine: { color: '#52525B', labelBackgroundColor: '#27272A' },
      },
      autoSize: true,
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: GREEN,
      downColor: RED,
      borderUpColor: GREEN,
      borderDownColor: RED,
      wickUpColor: GREEN,
      wickDownColor: RED,
    })

    chartRef.current = chart
    seriesRef.current = series
    markersRef.current = createSeriesMarkers(series, [])
    setChartReady(true)

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      markersRef.current = null
      indicatorHandlesRef.current = []
      prevLenRef.current = 0
      prevLastTimeRef.current = null
      setChartReady(false)
    }
  }, [])

  // Data updates: single-bar append uses update(), anything else setData()
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return

    const last = candleData[candleData.length - 1]
    const grewByOne =
      candleData.length === prevLenRef.current + 1 &&
      prevLastTimeRef.current !== null &&
      last &&
      candleData[candleData.length - 2]?.time === prevLastTimeRef.current

    if (grewByOne && last) {
      series.update(last)
    } else if (candleData.length > 0) {
      series.setData(candleData)
    }

    prevLenRef.current = candleData.length
    prevLastTimeRef.current = last?.time ?? null
  }, [candleData])

  useEffect(() => {
    markersRef.current?.setMarkers(markerData)
  }, [markerData])

  // ── Indicators ──
  // Structure effect: rebuild series whenever the visible configs change.
  useEffect(() => {
    const chart = chartRef.current
    const priceSeries = seriesRef.current
    if (!chart || !priceSeries || !chartReady) return

    for (const h of indicatorHandlesRef.current) {
      try {
        chart.removeSeries(h.series)
      } catch {
        // already removed during teardown
      }
    }
    indicatorHandlesRef.current = []

    let paneIndex = 1
    const handles: IndicatorHandle[] = []

    for (const cfg of visibleConfigs) {
      const color = INDICATOR_COLORS[cfg.type]
      if (cfg.type === 'EMA' || cfg.type === 'SMA') {
        const period = cfg.params.period ?? (cfg.type === 'EMA' ? 9 : 20)
        const s = chart.addSeries(LineSeries, { color, lineWidth: 1 })
        handles.push({ series: s, baseKey: `${cfg.type.toLowerCase()}_${period}` })
      } else if (cfg.type === 'BBANDS') {
        for (const sub of ['upper', 'middle', 'lower'] as const) {
          const s = chart.addSeries(LineSeries, {
            color: sub === 'middle' ? '#A1A1AA' : color,
            lineWidth: 1,
            lineStyle: sub === 'middle' ? LineStyle.Dashed : LineStyle.Solid,
          })
          handles.push({ series: s, baseKey: 'bbands', sub })
        }
      } else if (cfg.type === 'RSI') {
        const period = cfg.params.period ?? 14
        const s = chart.addSeries(LineSeries, { color, lineWidth: 1 }, paneIndex)
        s.createPriceLine({ price: 70, color: '#52525B', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false })
        s.createPriceLine({ price: 30, color: '#52525B', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false })
        handles.push({ series: s, baseKey: `rsi_${period}` })
        paneIndex++
      } else if (cfg.type === 'MACD') {
        const hist = chart.addSeries(HistogramSeries, {}, paneIndex)
        const macdLine = chart.addSeries(LineSeries, { color, lineWidth: 1 }, paneIndex)
        const signalLine = chart.addSeries(LineSeries, { color: '#FB923C', lineWidth: 1 }, paneIndex)
        handles.push({ series: hist, baseKey: 'macd', sub: 'histogram', histogram: true })
        handles.push({ series: macdLine, baseKey: 'macd', sub: 'macd' })
        handles.push({ series: signalLine, baseKey: 'macd', sub: 'signal' })
        paneIndex++
      } else if (cfg.type === 'VWAP') {
        const s = chart.addSeries(LineSeries, { color, lineWidth: 1 })
        handles.push({ series: s, baseKey: 'vwap' })
      } else if (cfg.type === 'ATR') {
        const period = cfg.params.period ?? 14
        const s = chart.addSeries(LineSeries, { color, lineWidth: 1 }, paneIndex)
        handles.push({ series: s, baseKey: `atr_${period}` })
        paneIndex++
      } else if (cfg.type === 'ADX') {
        const period = cfg.params.period ?? 14
        const s = chart.addSeries(LineSeries, { color, lineWidth: 1 }, paneIndex)
        s.createPriceLine({ price: 25, color: '#52525B', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false })
        handles.push({ series: s, baseKey: `adx_${period}` })
        paneIndex++
      } else if (cfg.type === 'STOCH') {
        const kLine = chart.addSeries(LineSeries, { color, lineWidth: 1 }, paneIndex)
        const dLine = chart.addSeries(LineSeries, { color: '#FB923C', lineWidth: 1 }, paneIndex)
        for (const level of [80, 20]) {
          kLine.createPriceLine({ price: level, color: '#52525B', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false })
        }
        handles.push({ series: kLine, baseKey: 'stoch', sub: 'k' })
        handles.push({ series: dLine, baseKey: 'stoch', sub: 'd' })
        paneIndex++
      }
    }

    indicatorHandlesRef.current = handles

    // Keep sub-panes compact vs the main price pane
    chart.panes().forEach((pane, i) => pane.setStretchFactor(i === 0 ? 3 : 1))

    return () => {
      for (const h of indicatorHandlesRef.current) {
        try {
          chart.removeSeries(h.series)
        } catch {
          // chart tearing down
        }
      }
      indicatorHandlesRef.current = []
    }
  }, [visibleConfigs, chartReady])

  // Data effect: push computed values into existing indicator series each bar
  useEffect(() => {
    if (indicatorHandlesRef.current.length === 0) return
    for (const h of indicatorHandlesRef.current) {
      const result = indicatorResults.get(h.baseKey)
      let data: LineData<UTCTimestamp>[]
      if (h.histogram) {
        const values = (result as IndicatorSeries | undefined)?.[h.sub!]
        data = lineData(values, candles).map((d) => ({
          ...d,
          color: d.value >= 0 ? 'rgba(0, 255, 156, 0.5)' : 'rgba(255, 77, 77, 0.5)',
        })) as LineData<UTCTimestamp>[]
      } else {
        const values = h.sub
          ? (result as IndicatorSeries | undefined)?.[h.sub]
          : (result as number[] | undefined)
        data = lineData(values, candles)
      }
      try {
        h.series.setData(data)
      } catch {
        // series removed mid-update during reconfigure
      }
    }
  }, [indicatorResults, candles, visibleConfigs])

  return (
    <div className="relative h-full min-h-0 w-full">
      <div ref={containerRef} className="absolute inset-0" />
      {chartReady && (
        <>
          <DrawingOverlay
            chartRef={chartRef}
            seriesRef={seriesRef}
            candles={candles}
            drawings={drawingsHidden ? [] : drawings}
            activeTool={activeTool}
            pair={pair}
            market={market}
            onAdd={onAddDrawing}
            onErase={onEraseDrawing}
            onEdit={onEditDrawing}
            onExecute={onExecutePositionDrawing}
          />
          <SlTpOverlay
            chartRef={chartRef}
            seriesRef={seriesRef}
            positions={positions}
            orders={orders}
            draftSl={draftSl}
            draftTp={draftTp}
            currentPrice={currentPrice}
            equity={equity}
            pair={pair}
            market={market}
            onCommit={onSlTpCommit}
          />
        </>
      )}
    </div>
  )
}
