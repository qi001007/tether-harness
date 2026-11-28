/**
 * Line-level diff engine for three-way merge.
 *
 * Computes diffs between base↔ours and base↔theirs, then aligns
 * them into MergeHunks classified as left-only, right-only, or conflict.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffHunk {
  /** Start index in the "old" (base) array, 0-based */
  baseStart: number
  /** Number of lines removed from base (0 = pure insertion) */
  baseCount: number
  /** Replacement lines from the "new" side */
  newLines: string[]
}

export type HunkStatus = "pending" | "applied" | "ignored"

export interface MergeHunk {
  id: string
  /** Start index in base lines, 0-based */
  baseStart: number
  /** Number of base lines covered */
  baseCount: number
  /** Diff hunk from ours (left) side, null if unchanged */
  leftHunk: DiffHunk | null
  /** Diff hunk from theirs (right) side, null if unchanged */
  rightHunk: DiffHunk | null
  type: "left-only" | "right-only" | "conflict"
}

// ---------------------------------------------------------------------------
// LCS-based line diff
// ---------------------------------------------------------------------------

/**
 * Compute the Longest Common Subsequence table for two string arrays.
 * Returns a 2D array where dp[i][j] = LCS length for a[0..i-1], b[0..j-1].
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  return dp
}

/**
 * Backtrack the LCS table to produce edit operations.
 * Returns an array of { type, aIdx, bIdx } entries.
 */
interface EditOp {
  type: "equal" | "delete" | "insert"
  aIdx: number // index in a (-1 for insert)
  bIdx: number // index in b (-1 for delete)
}

function backtrackLCS(a: string[], b: string[], dp: number[][]): EditOp[] {
  const ops: EditOp[] = []
  let i = a.length
  let j = b.length

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: "equal", aIdx: i - 1, bIdx: j - 1 })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "insert", aIdx: -1, bIdx: j - 1 })
      j--
    } else {
      ops.push({ type: "delete", aIdx: i - 1, bIdx: -1 })
      i--
    }
  }

  return ops.reverse()
}

/**
 * Compute line-level diff hunks between old (a) and new (b) arrays.
 */
export function computeLineDiff(a: string[], b: string[]): DiffHunk[] {
  const dp = lcsTable(a, b)
  const ops = backtrackLCS(a, b, dp)

  const hunks: DiffHunk[] = []
  let idx = 0

  while (idx < ops.length) {
    const op = ops[idx]

    if (op.type === "equal") {
      idx++
      continue
    }

    // Start of a change region
    let baseStart = op.type === "delete" ? op.aIdx : -1
    let baseCount = 0
    const newLines: string[] = []

    while (idx < ops.length && ops[idx].type !== "equal") {
      const cur = ops[idx]
      if (cur.type === "delete") {
        if (baseStart === -1) baseStart = cur.aIdx
        baseCount++
      } else {
        // insert
        if (baseStart === -1) {
          // Pure insertion — position it at the next base line
          // Find the previous equal op's aIdx + 1, or 0
          baseStart = findInsertionPoint(ops, idx)
        }
        newLines.push(b[cur.bIdx])
      }
      idx++
    }

    hunks.push({ baseStart, baseCount, newLines })
  }

  return hunks
}

/**
 * For a pure insertion (no deletes in this hunk), determine
 * where in the base array to anchor it.
 */
function findInsertionPoint(ops: EditOp[], currentIdx: number): number {
  // Walk backwards to find the last "equal" or "delete" op
  for (let k = currentIdx - 1; k >= 0; k--) {
    if (ops[k].type === "equal" || ops[k].type === "delete") {
      return ops[k].aIdx + 1
    }
  }
  // If nothing found, insert at start
  return 0
}

// ---------------------------------------------------------------------------
// Three-way merge hunk computation
// ---------------------------------------------------------------------------

interface RangedHunk {
  baseStart: number
  baseEnd: number // exclusive
  hunk: DiffHunk
  side: "left" | "right"
}

/**
 * Given diff hunks from base→ours and base→theirs, produce
 * a list of MergeHunks sorted by base position.
 */
export function computeMergeHunks(
  base: string,
  ours: string,
  theirs: string
): MergeHunk[] {
  const baseLines = base.split("\n")
  const oursLines = ours.split("\n")
  const theirsLines = theirs.split("\n")

  const leftDiffs = computeLineDiff(baseLines, oursLines)
  const rightDiffs = computeLineDiff(baseLines, theirsLines)

  // Convert to ranged hunks for overlap detection
  const ranged: RangedHunk[] = []

  for (const h of leftDiffs) {
    ranged.push({
      baseStart: h.baseStart,
      baseEnd: h.baseStart + Math.max(h.baseCount, 1), // at least 1 for insertions
      hunk: h,
      side: "left",
    })
  }
  for (const h of rightDiffs) {
    ranged.push({
      baseStart: h.baseStart,
      baseEnd: h.baseStart + Math.max(h.baseCount, 1),
      hunk: h,
      side: "right",
    })
  }

  // Sort by baseStart, then by side (left first)
  ranged.sort(
    (a, b) => a.baseStart - b.baseStart || (a.side === "left" ? -1 : 1)
  )

  // Merge overlapping hunks from different sides into conflicts
  const mergeHunks: MergeHunk[] = []
  const used = new Set<number>()

  for (let i = 0; i < ranged.length; i++) {
    if (used.has(i)) continue

    const r = ranged[i]

    // Check for overlapping hunk from the other side
    let paired: RangedHunk | null = null
    let pairedIdx = -1

    for (let j = i + 1; j < ranged.length; j++) {
      if (used.has(j)) continue
      const s = ranged[j]
      if (s.side === r.side) continue
      // Check overlap: ranges [r.baseStart, r.baseEnd) and [s.baseStart, s.baseEnd)
      if (s.baseStart < r.baseEnd && r.baseStart < s.baseEnd) {
        paired = s
        pairedIdx = j
        break
      }
      // If s starts beyond r, no more overlaps possible
      if (s.baseStart >= r.baseEnd) break
    }

    if (paired && pairedIdx >= 0) {
      used.add(pairedIdx)

      // Check if both sides made identical changes — treat as non-conflict
      const leftH = r.side === "left" ? r.hunk : paired.hunk
      const rightH = r.side === "right" ? r.hunk : paired.hunk

      const identical =
        leftH.baseStart === rightH.baseStart &&
        leftH.baseCount === rightH.baseCount &&
        leftH.newLines.length === rightH.newLines.length &&
        leftH.newLines.every((line, k) => line === rightH.newLines[k])

      if (identical) {
        // Both sides made the same change — treat as left-only (auto-applicable)
        const bStart = Math.min(r.baseStart, paired.baseStart)
        const bEnd = Math.max(r.baseEnd, paired.baseEnd)
        mergeHunks.push({
          id: `hunk-${mergeHunks.length}`,
          baseStart: bStart,
          baseCount: bEnd - bStart,
          leftHunk: leftH,
          rightHunk: null,
          type: "left-only",
        })
      } else {
        // Conflict
        const bStart = Math.min(r.baseStart, paired.baseStart)
        const bEnd = Math.max(r.baseEnd, paired.baseEnd)
        mergeHunks.push({
          id: `hunk-${mergeHunks.length}`,
          baseStart: bStart,
          baseCount: bEnd - bStart,
          leftHunk: r.side === "left" ? r.hunk : paired.hunk,
          rightHunk: r.side === "right" ? r.hunk : paired.hunk,
          type: "conflict",
        })
      }
    } else {
      // Single-side change
      mergeHunks.push({
        id: `hunk-${mergeHunks.length}`,
        baseStart: r.baseStart,
        baseCount: r.hunk.baseCount,
        leftHunk: r.side === "left" ? r.hunk : null,
        rightHunk: r.side === "right" ? r.hunk : null,
        type: r.side === "left" ? "left-only" : "right-only",
      })
    }
  }

  // Sort by baseStart
  mergeHunks.sort((a, b) => a.baseStart - b.baseStart)

  return mergeHunks
}

// ---------------------------------------------------------------------------
// Result builder
// ---------------------------------------------------------------------------

export interface AppliedHunkInfo {
  id: string
  side: "left" | "right"
}

/**
 * Build the result content by starting from base and applying
 * hunks that have been accepted.
 *
 * @param base     Original base content
 * @param hunks    All merge hunks
 * @param applied  Map of hunk id → which side was applied
 */
export function buildResult(
  base: string,
  hunks: MergeHunk[],
  applied: Map<string, "left" | "right">
): string {
  const baseLines = base.split("\n")
  const result: string[] = []
  let baseIdx = 0

  // Process hunks in order of baseStart
  const sorted = [...hunks].sort((a, b) => a.baseStart - b.baseStart)

  for (const hunk of sorted) {
    // Copy unchanged base lines before this hunk
    while (baseIdx < hunk.baseStart) {
      result.push(baseLines[baseIdx])
      baseIdx++
    }

    const appliedSide = applied.get(hunk.id)

    if (appliedSide) {
      // Apply the chosen side's content
      const diffHunk = appliedSide === "left" ? hunk.leftHunk : hunk.rightHunk
      if (diffHunk) {
        result.push(...diffHunk.newLines)
      }
      // Skip over the base lines that were replaced
      baseIdx = hunk.baseStart + hunk.baseCount
    } else {
      // Not applied — keep base content
      for (let i = 0; i < hunk.baseCount; i++) {
        if (baseIdx < baseLines.length) {
          result.push(baseLines[baseIdx])
          baseIdx++
        }
      }
    }
  }

  // Copy remaining base lines
  while (baseIdx < baseLines.length) {
    result.push(baseLines[baseIdx])
    baseIdx++
  }

  return result.join("\n")
}
