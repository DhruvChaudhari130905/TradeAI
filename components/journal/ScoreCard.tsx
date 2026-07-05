'use client'

import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { type PersonalityReview, DIMENSION_LABELS, PERSONALITY_META, type PersonalityKey } from '@/lib/types/review'

interface ScoreCardProps {
  personalityKey: PersonalityKey
  review: PersonalityReview
  compact?: boolean
}

const DIMENSION_KEYS = Object.keys(DIMENSION_LABELS) as (keyof typeof DIMENSION_LABELS)[]

export function ScoreCard({ personalityKey, review, compact = false }: ScoreCardProps) {
  const meta = PERSONALITY_META[personalityKey]

  const radarData = DIMENSION_KEYS.map((k) => ({
    dimension: DIMENSION_LABELS[k],
    score: review[k],
    fullMark: 10,
  }))

  const gradeColor = review.grade === 'A'
    ? '#00FF9C'
    : review.grade === 'B'
      ? '#4ADE80'
      : review.grade === 'C'
        ? '#F59E0B'
        : review.grade === 'D'
          ? '#F97316'
          : '#FF4D4D'

  if (compact) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-[#0A0B0E] p-3 space-y-3">
        {/* Personality header */}
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm"
            style={{ backgroundColor: `${meta.color}15`, border: `1px solid ${meta.color}40` }}
          >
            {meta.icon}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-xs font-semibold text-white">{meta.label}</h3>
            <p className="truncate text-[10px] italic text-zinc-500">{review.verdict}</p>
          </div>
          <Badge
            className="border-0 shrink-0 px-2 py-0.5 font-mono text-sm font-bold"
            style={{ backgroundColor: `${gradeColor}20`, color: gradeColor }}
          >
            {review.grade}
          </Badge>
        </div>

        {/* Radar chart */}
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="65%">
              <PolarGrid stroke="#1C1E26" strokeDasharray="3 3" />
              <PolarAngleAxis
                dataKey="dimension"
                tick={{ fill: '#71717A', fontSize: 8 }}
              />
              <Radar
                dataKey="score"
                stroke={meta.color}
                fill={meta.color}
                fillOpacity={0.2}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Score bars */}
        <div className="space-y-1.5">
          {DIMENSION_KEYS.map((k) => {
            const val = review[k]
            return (
              <div key={k} className="flex items-center gap-1.5">
                <span className="w-20 shrink-0 truncate text-[10px] text-zinc-500">{DIMENSION_LABELS[k]}</span>
                <div className="flex-1">
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#1C1E26]">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${val * 10}%`,
                        backgroundColor: val >= 7 ? '#00FF9C' : val >= 5 ? '#F59E0B' : '#FF4D4D',
                      }}
                    />
                  </div>
                </div>
                <span className="w-4 font-mono text-[10px]" style={{ color: val >= 7 ? '#00FF9C' : val >= 5 ? '#F59E0B' : '#FF4D4D' }}>
                  {val}
                </span>
              </div>
            )
          })}
        </div>

        <div className="border-t border-zinc-800 pt-2" />

        {/* Strengths */}
        <div>
          <h4 className="mb-1 text-[10px] font-semibold text-[#00FF9C]">Strengths</h4>
          <ul className="space-y-0.5">
            {review.strengths.map((s, i) => (
              <li key={i} className="flex items-start gap-1 text-[10px] text-zinc-300">
                <span className="mt-px shrink-0 text-[#00FF9C]">+</span>
                <span className="line-clamp-2">{s}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Improvements */}
        <div>
          <h4 className="mb-1 text-[10px] font-semibold text-[#F59E0B]">Improvements</h4>
          <ul className="space-y-0.5">
            {review.improvements.map((s, i) => (
              <li key={i} className="flex items-start gap-1 text-[10px] text-zinc-300">
                <span className="mt-px shrink-0 text-[#F59E0B]">~</span>
                <span className="line-clamp-2">{s}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Key Mistake */}
        {review.key_mistake && (
          <div className="rounded border border-[#FF4D4D]/20 bg-[#FF4D4D]/5 px-2 py-1.5">
            <h4 className="mb-0.5 text-[10px] font-semibold text-[#FF4D4D]">Key Mistake</h4>
            <p className="line-clamp-2 text-[10px] text-zinc-300">{review.key_mistake}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Personality header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full text-lg"
          style={{ backgroundColor: `${meta.color}15`, border: `1px solid ${meta.color}40` }}
        >
          {meta.icon}
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white">{meta.label}</h3>
          <p className="text-xs text-zinc-500 italic">{review.verdict}</p>
        </div>
        <Badge
          className="border-0 px-3 py-1 font-mono text-lg font-bold"
          style={{ backgroundColor: `${gradeColor}20`, color: gradeColor }}
        >
          {review.grade}
        </Badge>
      </div>

      {/* Radar chart */}
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid stroke="#1C1E26" strokeDasharray="3 3" />
            <PolarAngleAxis
              dataKey="dimension"
              tick={{ fill: '#71717A', fontSize: 10 }}
            />
            <Radar
              dataKey="score"
              stroke={meta.color}
              fill={meta.color}
              fillOpacity={0.2}
              strokeWidth={2}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Score bars */}
      <div className="space-y-2">
        {DIMENSION_KEYS.map((k) => {
          const val = review[k]
          return (
            <div key={k} className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-xs text-zinc-500">{DIMENSION_LABELS[k]}</span>
              <div className="flex-1">
                <div className="h-2 overflow-hidden rounded-full bg-[#1C1E26]">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${val * 10}%`,
                      backgroundColor: val >= 7 ? '#00FF9C' : val >= 5 ? '#F59E0B' : '#FF4D4D',
                    }}
                  />
                </div>
              </div>
              <span className="w-6 font-mono text-xs" style={{ color: val >= 7 ? '#00FF9C' : val >= 5 ? '#F59E0B' : '#FF4D4D' }}>
                {val}
              </span>
            </div>
          )
        })}
      </div>

      <div className="border-t border-zinc-800 pt-3" />

      {/* Strengths */}
      <div>
        <h4 className="mb-1.5 text-xs font-semibold text-[#00FF9C]">Strengths</h4>
        <ul className="space-y-1">
          {review.strengths.map((s, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-300">
              <span className="mt-0.5 text-[#00FF9C]">+</span>
              {s}
            </li>
          ))}
        </ul>
      </div>

      {/* Improvements */}
      <div>
        <h4 className="mb-1.5 text-xs font-semibold text-[#F59E0B]">Improvements</h4>
        <ul className="space-y-1">
          {review.improvements.map((s, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-300">
              <span className="mt-0.5 text-[#F59E0B]">~</span>
              {s}
            </li>
          ))}
        </ul>
      </div>

      {/* Key Mistake */}
      {review.key_mistake && (
        <div className="rounded-md border border-[#FF4D4D]/20 bg-[#FF4D4D]/5 px-3 py-2">
          <h4 className="mb-0.5 text-xs font-semibold text-[#FF4D4D]">Key Mistake</h4>
          <p className="text-xs text-zinc-300">{review.key_mistake}</p>
        </div>
      )}
    </div>
  )
}
