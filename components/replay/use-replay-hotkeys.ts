'use client'

// Global replay hotkeys. Ignored while typing in inputs/textareas/selects or
// contenteditable elements. Trade keys (B/S/C) are gated behind an explicit
// arm toggle so a stray keypress can never move capital uninvited.

import { useEffect, useRef } from 'react'

export interface ReplayHotkeyHandlers {
  onPlayPause: () => void
  onStep: () => void
  onBuy?: () => void
  onSell?: () => void
  onCloseAll?: () => void
  onCancel?: () => void
  onToggleHotkeyHelp?: () => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

export function useReplayHotkeys(handlers: ReplayHotkeyHandlers, tradeKeysArmed: boolean) {
  const ref = useRefLatest(handlers)
  const armedRef = useRefLatest(tradeKeysArmed)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          ref.current.onPlayPause()
          break
        case 'ArrowRight':
          e.preventDefault()
          ref.current.onStep()
          break
        case 'b':
        case 'B':
          if (armedRef.current) ref.current.onBuy?.()
          break
        case 's':
        case 'S':
          if (armedRef.current) ref.current.onSell?.()
          break
        case 'c':
        case 'C':
          if (armedRef.current) ref.current.onCloseAll?.()
          break
        case 'Escape':
          ref.current.onCancel?.()
          break
        case '?':
          ref.current.onToggleHotkeyHelp?.()
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [ref, armedRef])
}

/** Ref that always holds the latest value without re-subscribing listeners */
function useRefLatest<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}
