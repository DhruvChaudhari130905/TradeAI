'use client'

// Replay transport: play/pause, step, speed, timeframe tabs + notice ticker.

import { Play, Pause, StepForward, Rewind } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Timeframe } from '@/lib/types/replay'
import type { ReplayNotice } from './use-replay-session'

interface ReplayControlsProps {
  playing: boolean
  speed: number
  activeTf: Timeframe
  timeframes: Timeframe[]
  currentBarTime: string | null
  notices: ReplayNotice[]
  hasMoreBars: boolean
  reversing: boolean
  canRewind: boolean
  onPlayPause: () => void
  onStep: () => void
  onToggleReverse: () => void
  onSpeedChange: (speed: number) => void
  onTfChange: (tf: Timeframe) => void
}

const SPEEDS = [0.5, 1, 2, 4, 8]

export function ReplayControls({
  playing,
  speed,
  activeTf,
  timeframes,
  currentBarTime,
  notices,
  hasMoreBars,
  reversing,
  canRewind,
  onPlayPause,
  onStep,
  onToggleReverse,
  onSpeedChange,
  onTfChange,
}: ReplayControlsProps) {
  const latest = notices[notices.length - 1]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Transport */}
        <Button
          size="icon"
          onClick={onToggleReverse}
          disabled={!canRewind}
          aria-pressed={reversing}
          className={`h-10 w-10 ${reversing ? 'bg-amber-400 text-primary-foreground hover:bg-amber-400/90' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}
          title={reversing ? 'Stop reverse' : 'Reverse play — rewind chart'}
        >
          <Rewind className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          onClick={onPlayPause}
          disabled={!hasMoreBars || reversing}
          aria-pressed={playing}
          className={`h-10 w-10 ${playing ? 'bg-loss text-primary-foreground hover:bg-loss/90' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button
          size="icon"
          variant="outline"
          onClick={onStep}
          disabled={!hasMoreBars || playing}
          className="h-10 w-10 border-border"
          title="Next bar (→)"
        >
          <StepForward className="h-4 w-4" />
        </Button>

        {/* Speed */}
        <div className="flex items-center gap-1 rounded-md border border-border px-2 py-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeedChange(s)}
              aria-pressed={speed === s}
              className={`rounded px-2 py-1.5 font-mono text-xs transition-colors ${
                speed === s ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Timeframe tabs */}
        <div className="flex items-center gap-1 rounded-md border border-border p-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onTfChange(tf)}
              aria-pressed={activeTf === tf}
              className={`rounded px-3 py-1.5 font-mono text-xs transition-colors ${
                activeTf === tf ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Current candle clock */}
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {currentBarTime ? new Date(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(currentBarTime)
              ? `${currentBarTime.replace(' ', 'T')}Z`
              : currentBarTime,
          ).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          }) : ''}
        </span>
      </div>

      {/* Notice ticker */}
      <div role="status" aria-live="polite" className="h-5 overflow-hidden">
        {latest && (
          <p key={latest.id} className="truncate font-mono text-xs text-amber-400">
            {latest.text}
          </p>
        )}
      </div>
    </div>
  )
}
