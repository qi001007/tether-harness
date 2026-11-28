import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Briefly flips a "copied" flag, auto-resetting after `resetMs`. The pending
 * reset is tracked in a ref so it is cleared on unmount (and coalesced when copy
 * is triggered repeatedly), avoiding a setState on an unmounted component.
 */
export function useCopiedFlag(resetMs = 1500): [boolean, () => void] {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const markCopied = useCallback(() => {
    setCopied(true)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setCopied(false), resetMs)
  }, [resetMs])

  return [copied, markCopied]
}
