'use client'

// Vertical drawing-tool strip on the chart's left edge + indicator menu trigger.

import {
  Eraser,
  Eye,
  EyeOff,
  Minus,
  MousePointer2,
  PenLine,
  Percent,
  Ruler,
  SeparatorVertical,
  Square,
  Trash2,
  Type,
} from 'lucide-react'
import type { DrawTool } from './DrawingOverlay'

interface DrawToolbarProps {
  activeTool: DrawTool | null
  showDrawings: boolean
  onToggleVisibility: () => void
  onSelectTool: (tool: DrawTool | null) => void
  onClearAll: () => void
  indicatorMenu: React.ReactNode
}

const TOOLS: { tool: DrawTool; label: string; icon: React.ReactNode }[] = [
  { tool: 'hline', label: 'Horizontal line', icon: <Minus className="h-4 w-4" /> },
  { tool: 'vline', label: 'Vertical line', icon: <SeparatorVertical className="h-4 w-4" /> },
  { tool: 'trendline', label: 'Trendline', icon: <PenLine className="h-4 w-4" /> },
  { tool: 'rect', label: 'Zone (rectangle)', icon: <Square className="h-4 w-4" /> },
  { tool: 'fib', label: 'Fib retracement', icon: <Percent className="h-4 w-4" /> },
  { tool: 'text', label: 'Text note', icon: <Type className="h-4 w-4" /> },
  { tool: 'measure', label: 'Measure pips/bars', icon: <Ruler className="h-4 w-4" /> },
  { tool: 'eraser', label: 'Eraser', icon: <Eraser className="h-4 w-4" /> },
]

export function DrawToolbar({
  activeTool,
  showDrawings,
  onToggleVisibility,
  onSelectTool,
  onClearAll,
  indicatorMenu,
}: DrawToolbarProps) {
  return (
    <div className="absolute left-2 top-2 z-20 flex flex-col gap-0.5 rounded-lg border border-[#27272A] bg-[#12141A]/95 p-1 shadow-lg">
      <ToolButton label="Cursor / pan" active={activeTool === null} onClick={() => onSelectTool(null)}>
        <MousePointer2 className="h-4 w-4" />
      </ToolButton>
      {TOOLS.map(({ tool, label, icon }) => (
        <ToolButton key={tool} label={label} active={activeTool === tool} onClick={() => onSelectTool(activeTool === tool ? null : tool)}>
          {icon}
        </ToolButton>
      ))}
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
