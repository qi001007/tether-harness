"use client"

import { useCallback, useState } from "react"

/**
 * Controlled expansion state for the prefix-grouped branch trees.
 *
 * Holds a `Set` of expanded keys (group keys from `buildBranchTree`, plus the
 * reserved `sectionKey(...)` entries the top-bar dropdown uses for its
 * Local/Remote sections). On each open it resets to `defaultKeys`, then — once
 * the branch list has loaded and `seedKeys` is non-empty — merges in the
 * ancestor keys of the current/selected branch exactly once, so the tree opens
 * with the current branch revealed but the user's later toggles preserved.
 *
 * Reset/seed happen via React's sanctioned "adjust state while rendering"
 * pattern (guarded setState during render), not an effect — so there is no
 * post-render cascade.
 */
export function useBranchTreeExpansion(
  open: boolean,
  seedKeys: string[],
  defaultKeys: readonly string[] = EMPTY
): {
  expanded: Set<string>
  isExpanded: (key: string) => boolean
  toggle: (key: string) => void
} {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaultKeys)
  )
  const [prevOpen, setPrevOpen] = useState(open)
  const [seeded, setSeeded] = useState(false)

  // Fresh start on each open: back to defaults, ready to seed once.
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setSeeded(false)
      setExpanded(new Set(defaultKeys))
    }
  }

  // Seed once, after the async branch load has produced ancestor keys.
  if (open && !seeded && seedKeys.length > 0) {
    setSeeded(true)
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const key of seedKeys) next.add(key)
      return next
    })
  }

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const isExpanded = useCallback((key: string) => expanded.has(key), [expanded])

  return { expanded, isExpanded, toggle }
}

const EMPTY: readonly string[] = []
