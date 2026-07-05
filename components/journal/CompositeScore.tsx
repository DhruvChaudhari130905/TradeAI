'use client'

import { PERSONALITY_META, type PersonalityKey } from '@/lib/types/review'

interface CompositeScoreProps {
  score: number | null
  personalityScores: { key: PersonalityKey; overall: number | null }[]
}

export function CompositeScore({ score, personalityScores }: CompositeScoreProps) {
  const pct = score != null ? score / 10 : 0
  const radius = 36
  const circumference = 2 * Math.PI * radius
  const offset = circumference - pct * circumference

  const scoreColor = score == null
    ? '#71717A'
    : score >= 7
      ? '#00FF9C'
      : score >= 5
        ? '#F59E0B'
        : '#FF4D4D'

  return (
    <div className="flex items-center gap-6">
      {/* Circular gauge */}
      <div className="relative h-20 w-20 shrink-0">
        <svg className="h-20 w-20 -rotate-90" viewBox="0 0 96 96">
          <circle
            cx="48" cy="48" r={radius}
            fill="none"
            stroke="#1C1E26"
            strokeWidth="5"
          />
          <circle
            cx="48" cy="48" r={radius}
            fill="none"
            stroke={scoreColor}
            strokeWidth="5"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-xl font-bold" style={{ color: scoreColor }}>
            {score != null ? score.toFixed(1) : '—'}
          </span>
          <span className="text-[9px] text-zinc-500">/10</span>
        </div>
      </div>

      <div className="flex-1">
        <p className="mb-2 text-sm font-medium text-zinc-400">Composite Score</p>
        {/* Personality avatars row */}
        <div className="flex gap-4">
          {personalityScores.map(({ key, overall }) => {
            const meta = PERSONALITY_META[key]
            return (
              <div key={key} className="flex flex-col items-center gap-1" title={meta.label}>
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full text-base"
                  style={{ backgroundColor: `${meta.color}15`, border: `1px solid ${meta.color}40` }}
                >
                  {meta.icon}
                </div>
                <span className="max-w-[60px] truncate text-[10px] text-zinc-500">{meta.label.split(' ')[0]}</span>
                <span className="font-mono text-[10px]" style={{ color: overall != null && overall >= 7 ? '#00FF9C' : overall != null && overall >= 5 ? '#F59E0B' : '#FF4D4D' }}>
                  {overall != null ? overall.toFixed(1) : '—'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
