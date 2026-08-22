'use client'

// Global replay hotkeys. Ignored while typing in inputs/textareas/selects or
// contenteditable elements.

import { useEffect, useRef } from 'react'

export interface ReplayHotkeyHandlers {
  onPlayPause: () => void
  onStep: () => void
  onBuy?: () => void
  onSell?: () => void
  onClosePosition?: () => void
  onCancel?: () => void
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

export function useReplayHotkeys(handlers: ReplayHotkeyHandlers) {
  const ref = useRefLatest(handlers)

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
          ref.current.onBuy?.()
          break
        case 's':
        case 'S':
          ref.current.onSell?.()
          break
        case 'c':
        case 'C':
          ref.current.onClosePosition?.()
          break
        case 'Escape':
          ref.current.onCancel?.()
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [ref])
}

/** Ref that always holds the latest handlers without re-subscribing the listener */
function useRefLatest<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}
