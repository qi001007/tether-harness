"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  sendDshPrompt,
  type DshPromptResult,
} from "@/lib/dsh-bridge"

/**
 * Refresh cadence for a conversation whose turns arrive through the DSH direct
 * bridge. There is no ACP stream to push them: the only way a bridged prompt
 * and its reply show up is another detail fetch, which re-parses the session
 * log.
 *
 * `IDLE` is the steady state while the tab is open — DSH may be driving the
 * session from another surface too, so the view has to keep up.
 * `AFTER_SEND` is the short window right after a send, when the prompt is
 * usually appended within a second or two; `SEND_WINDOW` bounds how long that
 * faster cadence lasts before falling back to the idle one.
 */
export const DSH_BRIDGE_IDLE_POLL_MS = 3_000
export const DSH_BRIDGE_SEND_POLL_MS = 1_500
export const DSH_BRIDGE_SEND_WINDOW_MS = 30_000

export interface UseDshBridgeOptions {
  /** The DSH session to prompt, or null when this view has no bridge. */
  sessionId: string | null
  /** Whether the cadence should run at all (tab active, composer on screen). */
  active: boolean
  /** Re-read the conversation detail (the caller's `refetchDetail`). */
  onRefresh: () => void
}

export interface UseDshBridgeReturn {
  /** Deliver text into the DSH session. Resolves with the host's verdict. */
  send: (text: string) => Promise<DshPromptResult>
  /** True between the postMessage and the host's reply. */
  sending: boolean
  /** Last failure, cleared by the next send. */
  error: string | null
  dismissError: () => void
}

export function useDshBridge({
  sessionId,
  active,
  onRefresh,
}: UseDshBridgeOptions): UseDshBridgeReturn {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Absolute time the post-send fast window ends; a ref because the polling
  // loop reads it from a timer and must not re-arm on every render.
  const fastUntilRef = useRef(0)
  const aliveRef = useRef(true)
  // Read through a ref: the caller's callback is expected to be stable, but a
  // changing identity must not tear down and restart the timer chain.
  const refreshRef = useRef(onRefresh)
  useEffect(() => {
    refreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const dismissError = useCallback(() => setError(null), [])

  const send = useCallback(
    async (text: string): Promise<DshPromptResult> => {
      if (!sessionId) {
        const result: DshPromptResult = {
          ok: false,
          status: 0,
          error: "This conversation has no DSH session id",
        }
        setError(result.error)
        return result
      }
      setSending(true)
      setError(null)
      try {
        const result = await sendDshPrompt(sessionId, text)
        if (result.ok) {
          // The prompt is accepted, not yet on disk — start the faster cadence
          // and refresh once immediately so a fast append is not held back by
          // the full interval.
          fastUntilRef.current = Date.now() + DSH_BRIDGE_SEND_WINDOW_MS
          refreshRef.current()
        } else {
          setError(result.error ?? "The Tether host refused the prompt")
        }
        return result
      } finally {
        if (aliveRef.current) setSending(false)
      }
    },
    [sessionId]
  )

  useEffect(() => {
    if (!active || !sessionId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const schedule = (delay: number) => {
      timer = setTimeout(tick, delay)
    }
    const tick = () => {
      if (cancelled) return
      // A hidden tab has nothing to show; skipping the fetch keeps a restored
      // workspace from polling every DSH tab in the background.
      const hidden =
        typeof document !== "undefined" && document.visibilityState === "hidden"
      if (!hidden) refreshRef.current()
      const fast = Date.now() < fastUntilRef.current
      schedule(fast ? DSH_BRIDGE_SEND_POLL_MS : DSH_BRIDGE_IDLE_POLL_MS)
    }

    schedule(DSH_BRIDGE_IDLE_POLL_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [active, sessionId])

  return { send, sending, error, dismissError }
}