export interface ConflictRegion {
  /** Line number (1-based) of <<<<<<< marker */
  startLine: number
  /** Line number (1-based) of ======= marker */
  separatorLine: number
  /** Line number (1-based) of >>>>>>> marker */
  endLine: number
  /** Content from the ours (local/HEAD) side */
  oursContent: string
  /** Content from the theirs (remote/incoming) side */
  theirsContent: string
}

/**
 * Parse git conflict markers from file content.
 * Returns an array of conflict regions sorted by line number.
 */
export function parseConflictMarkers(content: string): ConflictRegion[] {
  const lines = content.split("\n")
  const regions: ConflictRegion[] = []

  let i = 0
  while (i < lines.length) {
    if (lines[i].startsWith("<<<<<<<")) {
      const startLine = i + 1 // 1-based
      let separatorLine = -1
      let endLine = -1
      const oursLines: string[] = []
      const theirsLines: string[] = []
      let inOurs = true

      let j = i + 1
      while (j < lines.length) {
        if (lines[j].startsWith("=======") && separatorLine === -1) {
          separatorLine = j + 1
          inOurs = false
        } else if (lines[j].startsWith(">>>>>>>")) {
          endLine = j + 1
          break
        } else if (inOurs) {
          oursLines.push(lines[j])
        } else {
          theirsLines.push(lines[j])
        }
        j++
      }

      if (separatorLine !== -1 && endLine !== -1) {
        regions.push({
          startLine,
          separatorLine,
          endLine,
          oursContent: oursLines.join("\n"),
          theirsContent: theirsLines.join("\n"),
        })
        i = j + 1
        continue
      }
    }
    i++
  }

  return regions
}

/**
 * Resolve a single conflict region by replacing the conflict block
 * with the chosen content.
 */
export function resolveConflict(
  content: string,
  region: ConflictRegion,
  choice: "ours" | "theirs" | "both"
): string {
  const lines = content.split("\n")
  const startIdx = region.startLine - 1
  const endIdx = region.endLine - 1

  let replacement: string
  switch (choice) {
    case "ours":
      replacement = region.oursContent
      break
    case "theirs":
      replacement = region.theirsContent
      break
    case "both":
      replacement = region.oursContent + "\n" + region.theirsContent
      break
  }

  const replacementLines = replacement === "" ? [] : replacement.split("\n")
  lines.splice(startIdx, endIdx - startIdx + 1, ...replacementLines)
  return lines.join("\n")
}

/**
 * Check if content still has unresolved conflict markers.
 */
export function hasConflictMarkers(content: string): boolean {
  return content.includes("<<<<<<<") && content.includes(">>>>>>>")
}
