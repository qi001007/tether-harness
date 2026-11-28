"use client"

import { useMemo, useRef } from "react"

import { isImeCompositionKey, type ImeKeyEvent } from "@/lib/ime-composition"

export interface ImeGuard {
  /**
   * Spread onto the `<input>` / `<textarea>` so the composition is tracked.
   * Neither handler is needed for correctness on Chromium/WebKit — they are the
   * fallback for engines whose confirming keydown carries no IME signal at all.
   */
  props: {
    onCompositionStart: (event: { currentTarget: Element }) => void
    onCompositionEnd: () => void
  }
  /** True when this keydown belongs to the IME and must not act on the app. */
  isComposing: (event: ImeKeyEvent) => boolean
}

/**
 * The IME guard for a plain text control: the in-event signals from
 * {@link isImeCompositionKey} plus a composition flag tracked across the
 * `compositionstart` / `compositionend` pair.
 *
 * The returned object is stable for the component's lifetime (it only closes
 * over a ref), so it is safe to list in a `useCallback` dependency array and to
 * spread into JSX without re-rendering children.
 */
export function useImeGuard(): ImeGuard {
  // The element that is composing, not a bare boolean: a control can be
  // unmounted mid-composition without ever firing `compositionend` (a terminal
  // tab closing under an open rename box, say). A stuck flag would kill Enter
  // for every later composition, so a detached element counts as finished.
  const composingElRef = useRef<Element | null>(null)
  return useMemo(
    () => ({
      props: {
        onCompositionStart: (event: { currentTarget: Element }) => {
          composingElRef.current = event.currentTarget
        },
        onCompositionEnd: () => {
          composingElRef.current = null
        },
      },
      isComposing: (event: ImeKeyEvent) => {
        const el = composingElRef.current
        if (el && !el.isConnected) composingElRef.current = null
        return composingElRef.current !== null || isImeCompositionKey(event)
      },
    }),
    []
  )
}
