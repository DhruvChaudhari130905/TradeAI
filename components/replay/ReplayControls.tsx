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
          className={`h-10 w-10 ${reversing ? 'bg-amber-400 text-[#0A0B0E] hover:bg-amber-400/90' : 'bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90'}`}
          title={reversing ? 'Stop reverse' : 'Reverse play — rewind chart'}
        >
          <Rewind className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          onClick={onPlayPause}
          disabled={!hasMoreBars || reversing}
          aria-pressed={playing}
          className={`h-10 w-10 ${playing ? 'bg-[#FF4D4D] text-[#0A0B0E] hover:bg-[#FF4D4D]/90' : 'bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90'}`}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button
          size="icon"
          variant="outline"
          onClick={onStep}
          disabled={!hasMoreBars || playing}
          className="h-10 w-10 border-[#27272A]"
          title="Next bar (→)"
        >
          <StepForward className="h-4 w-4" />
        </Button>

        {/* Speed */}
        <div className="flex items-center gap-1 rounded-md border border-[#27272A] px-2 py-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeedChange(s)}
              aria-pressed={speed === s}
              className={`rounded px-2 py-1.5 font-mono text-xs transition-colors ${
                speed === s ? 'bg-[#00FF9C]/15 text-[#00FF9C]' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Timeframe tabs */}
        <div className="flex items-center gap-1 rounded-md border border-[#27272A] p-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onTfChange(tf)}
              aria-pressed={activeTf === tf}
              className={`rounded px-3 py-1.5 font-mono text-xs transition-colors ${
                activeTf === tf ? 'bg-[#00FF9C]/15 text-[#00FF9C]' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Current candle clock */}
        <span className="ml-auto font-mono text-xs text-zinc-400">
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
