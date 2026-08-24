'use client'

// Vertical drawing-tool strip on the chart's left edge + indicator menu
// trigger. Tools are grouped into flyouts so the rail shows ~5 choices at a
// time instead of 20+ undifferentiated icons.

import { useState } from 'react'
import {
  ArrowUpRight,
  Eraser,
  Equal,
  Eye,
  EyeOff,
  GitFork,
  Minus,
  MousePointer2,
  MoveHorizontal,
  MoveUpRight,
  MoveVertical,
  PenLine,
  Percent,
  Ruler,
  Scaling,
  SeparatorVertical,
  Square,
  Trash2,
  TrendingDown,
  TrendingUp,
  Type,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { DrawTool } from './DrawingOverlay'

interface DrawToolbarProps {
  activeTool: DrawTool | null
  showDrawings: boolean
  onToggleVisibility: () => void
  onSelectTool: (tool: DrawTool | null) => void
  onClearAll: () => void
  indicatorMenu: React.ReactNode
}

type ToolDef = { tool: DrawTool; label: string; hint?: string; icon: React.ReactNode }

const POSITION_TOOLS: ToolDef[] = [
  { tool: 'long_position', label: 'Long plan', hint: 'Drag entry → SL; executes as an order', icon: <TrendingUp className="h-4 w-4" /> },
  { tool: 'short_position', label: 'Short plan', hint: 'Drag entry → SL; executes as an order', icon: <TrendingDown className="h-4 w-4" /> },
]

const LINE_TOOLS: ToolDef[] = [
  { tool: 'trendline', label: 'Trendline', icon: <PenLine className="h-4 w-4" /> },
  { tool: 'ray', label: 'Ray', icon: <MoveUpRight className="h-4 w-4" /> },
  { tool: 'arrow', label: 'Arrow', icon: <ArrowUpRight className="h-4 w-4" /> },
  { tool: 'hline', label: 'Horizontal line', icon: <Minus className="h-4 w-4" /> },
  { tool: 'vline', label: 'Vertical line', icon: <SeparatorVertical className="h-4 w-4" /> },
  { tool: 'hray', label: 'Horizontal ray', icon: <MoveHorizontal className="h-4 w-4" /> },
  { tool: 'vray', label: 'Vertical ray', icon: <MoveVertical className="h-4 w-4" /> },
  { tool: 'channel', label: 'Channel', hint: '3 clicks', icon: <Equal className="h-4 w-4" /> },
  { tool: 'pitchfork', label: 'Pitchfork', hint: '3 clicks', icon: <GitFork className="h-4 w-4" /> },
]

const ZONE_TOOLS: ToolDef[] = [
  { tool: 'rect', label: 'Zone', hint: 'Rectangle', icon: <Square className="h-4 w-4" /> },
  { tool: 'price_range', label: 'Price range', icon: <Scaling className="h-4 w-4" /> },
  { tool: 'fib', label: 'Fib retracement', icon: <Percent className="h-4 w-4" /> },
]

const ANNOTATION_TOOLS: ToolDef[] = [
  { tool: 'measure', label: 'Measure', hint: 'Pips / bars / R:R', icon: <Ruler className="h-4 w-4" /> },
  { tool: 'text', label: 'Text note', icon: <Type className="h-4 w-4" /> },
  { tool: 'eraser', label: 'Eraser', hint: 'Tap a drawing to delete it', icon: <Eraser className="h-4 w-4" /> },
]

const GROUPS: { key: string; label: string; railIcon: React.ReactNode; tools: ToolDef[] }[] = [
  { key: 'positions', label: 'Position plans', railIcon: <TrendingUp className="h-4 w-4" />, tools: POSITION_TOOLS },
  { key: 'lines', label: 'Lines', railIcon: <PenLine className="h-4 w-4" />, tools: LINE_TOOLS },
  { key: 'zones', label: 'Zones & ranges', railIcon: <Square className="h-4 w-4" />, tools: ZONE_TOOLS },
  { key: 'notes', label: 'Annotations', railIcon: <Type className="h-4 w-4" />, tools: ANNOTATION_TOOLS },
]

export function DrawToolbar({
  activeTool,
  showDrawings,
  onToggleVisibility,
  onSelectTool,
  onClearAll,
  indicatorMenu,
}: DrawToolbarProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null)

  function pick(tool: DrawTool) {
    onSelectTool(activeTool === tool ? null : tool)
    setOpenGroup(null)
  }

  return (
    <div className="absolute left-2 top-2 z-20 flex flex-col gap-0.5 rounded-lg border border-[#27272A] bg-[#12141A]/95 p-1 shadow-lg">
      <ToolButton label="Cursor / pan" active={activeTool === null} onClick={() => onSelectTool(null)}>
        <MousePointer2 className="h-4 w-4" />
      </ToolButton>

      {GROUPS.map((group) => {
        const groupActive = group.tools.some((t) => t.tool === activeTool)
        return (
          <Popover
            key={group.key}
            open={openGroup === group.key}
            onOpenChange={(o) => setOpenGroup(o ? group.key : null)}
          >
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={`${group.label} tools`}
                  aria-expanded={openGroup === group.key}
                  className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
                    groupActive || openGroup === group.key
                      ? 'bg-[#00FF9C]/15 text-[#00FF9C]'
                      : 'text-zinc-400 hover:bg-[#1C1E26] hover:text-zinc-100'
                  }`}
                />
              }
            >
              {group.railIcon}
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-auto p-1.5">
              <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {group.label}
              </p>
              <div className="flex flex-col">
                {group.tools.map(({ tool, label, hint, icon }) => (
                  <button
                    key={tool}
                    type="button"
                    aria-pressed={activeTool === tool}
                    onClick={() => pick(tool)}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                      activeTool === tool
                        ? 'bg-[#00FF9C]/15 text-[#00FF9C]'
                        : 'text-zinc-300 hover:bg-[#1C1E26] hover:text-zinc-100'
                    }`}
                  >
                    {icon}
                    <span>
                      {label}
                      {hint && <span className="block text-[10px] text-zinc-500">{hint}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )
      })}

      <div className="my-0.5 h-px bg-[#27272A]" />
      <ToolButton label={showDrawings ? 'Hide drawings' : 'Show drawings'} active={false} onClick={onToggleVisibility}>
        {showDrawings ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-zinc-500" />}
      </ToolButton>
      <ToolButton label="Clear all drawings" active={false} onClick={onClearAll} danger>
        <Trash2 className="h-4 w-4" />
      </ToolButton>
      <div className="my-0.5 h-px bg-[#27272A]" />
      {indicatorMenu}
    </div>
  )
}

function ToolButton({
  label,
  active,
  danger,
  onClick,
  children,
}: {
  label: string
  active: boolean
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
        active
          ? 'bg-[#00FF9C]/15 text-[#00FF9C]'
          : danger
            ? 'text-zinc-400 hover:bg-[#FF4D4D]/10 hover:text-[#FF4D4D]'
            : 'text-zinc-400 hover:bg-[#1C1E26] hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  )
}
