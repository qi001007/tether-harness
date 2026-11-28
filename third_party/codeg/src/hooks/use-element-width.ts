"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Track an element's content-box width in CSS pixels.
 *
 * Charts here are drawn in real pixel space (bars, ticks and labels are placed
 * by absolute coordinate), so an SVG scaled with `preserveAspectRatio` would
 * stretch its own text. Measuring instead keeps every glyph at its natural
 * size at any container width.
 *
 * Returns a **callback ref**, not an object ref, and that is the whole point:
 * a chart typically early-returns an empty state before it ever renders the
 * measured node, so the node is absent on first mount. A mount-only effect
 * would find nothing to observe and never run again, leaving the chart
 * 0-wide — permanently blank — once data finally arrived. A callback ref fires
 * on every attach and detach, so measurement follows the node.
 *
 * Width is `0` until the node first attaches; callers skip rendering marks
 * until a real width arrives rather than drawing a degenerate chart.
 */
export function useElementWidth<T extends HTMLElement>(): [
  (node: T | null) => void,
  number,
] {
  const [width, setWidth] = useState(0)
  const observerRef = useRef<ResizeObserver | null>(null)

  const ref = useCallback((node: T | null) => {
    // Always drop the previous observation first: React calls the callback
    // with `null` on detach, and with the new node on a swap, so without this
    // an observer could outlive the element it was watching.
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return

    // Measure once up front: in environments without ResizeObserver (jsdom)
    // this is the only measurement, so the chart still renders in tests.
    setWidth(node.clientWidth)
    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const next = entry.contentRect.width
      // Sub-pixel jitter from a flexbox reflow would otherwise re-render the
      // whole chart on every frame.
      setWidth((prev) => (Math.abs(prev - next) < 1 ? prev : next))
    })
    observer.observe(node)
    observerRef.current = observer
  }, [])

  // Unmounting the host component detaches the node (running the callback with
  // `null`), but disconnect here too so a torn-down tree never leaves an
  // observer behind.
  useEffect(
    () => () => {
      observerRef.current?.disconnect()
      observerRef.current = null
    },
    []
  )

  return [ref, width]
}
