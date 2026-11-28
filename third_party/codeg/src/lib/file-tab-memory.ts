// Memory guardrail for the file workspace: selection logic for unloading
// the content of clean, non-visible file tabs once their combined retained
// text exceeds a budget. Pure — the provider owns the state mutation.
//
// Unloading drops `content` / `savedContent` / `gitBaseContent` but keeps
// the tab's metadata (path, folderId, etag, mtime), and flags it stale so
// the existing stale machinery refetches from disk on activation. Dirty
// tabs are NEVER candidates — unsaved edits are not reclaimable.

// Retained-content budget for hidden clean tabs, in UTF-16 code units
// (String.length — a good-enough proxy for heap cost). Sized so dozens of
// ordinary source files never trigger an unload; only pathological piles
// of large files do. The ACTIVE tab never counts against it.
export const HIDDEN_TAB_CONTENT_BUDGET_CHARS = 48 * 1024 * 1024

export interface UnloadCandidate {
  id: string
  // content + non-shared gitBaseContent, in chars.
  charCount: number
}

// Pick which hidden clean tabs to unload, least-recently-active first,
// until the remaining retained total fits the budget. `recencyRank` maps
// tab id → recency index (0 = most recent); ids absent from the map were
// never activated and are reclaimed first.
export function selectTabsToUnload(
  candidates: UnloadCandidate[],
  recencyRank: Map<string, number>,
  budgetChars: number
): Set<string> {
  const toUnload = new Set<string>()
  let totalChars = 0
  for (const candidate of candidates) {
    totalChars += candidate.charCount
  }
  if (totalChars <= budgetChars) return toUnload

  const ordered = [...candidates].sort((a, b) => {
    const rankA = recencyRank.get(a.id) ?? Number.POSITIVE_INFINITY
    const rankB = recencyRank.get(b.id) ?? Number.POSITIVE_INFINITY
    // Higher rank (older) and never-activated first.
    return rankB - rankA
  })

  for (const candidate of ordered) {
    if (totalChars <= budgetChars) break
    toUnload.add(candidate.id)
    totalChars -= candidate.charCount
  }
  return toUnload
}
