/**
 * Parse the stdout of a search tool (ripgrep / grep / Glob / codex's `search`
 * and `listFiles` command actions) into a structure the renderer can show as
 * grouped, clickable results instead of a wall of text.
 *
 * Two recognised shapes:
 *   - "matches":  `<path>:<line>:<content>` — grep/rg with line numbers
 *   - "files":    one bare path per line    — `rg --files`, Glob, `ls`
 *
 * Recognition is deliberately conservative: unless (nearly) every line fits one
 * shape the parser returns null and the caller falls back to plain text. Search
 * output is agent- and flag-dependent (`rg -c` counts, `--heading` groups, ANSI
 * colours, "Found N files" preambles), and a half-parsed result reads far worse
 * than the raw text.
 */

export interface SearchMatchLine {
  /** 1-based line number in `path`; null in "files" mode. */
  line: number | null
  text: string
}

export interface SearchFileGroup {
  path: string
  /** Empty in "files" mode. */
  lines: SearchMatchLine[]
}

export interface ParsedSearchOutput {
  mode: "matches" | "files"
  groups: SearchFileGroup[]
  /** Total matched lines across all files (0 in "files" mode). */
  matchCount: number
  fileCount: number
  /** Rows dropped by `maxRows`; 0 when everything is shown. */
  hiddenCount: number
  /** Lines that fit neither shape (rg warnings, "Found N files" preambles, …). */
  notes: string[]
}

/** `<path>:<line>:<content>`, path lazy so a Windows drive letter still parses. */
const MATCH_LINE_RE = /^(.*?):(\d+):([\s\S]*)$/
/** ripgrep's context separator between non-adjacent hunks. */
const CONTEXT_SEPARATOR_RE = /^--+$/
/** Trailing extension, used to accept extension-only names from `ls`. */
const FILE_EXTENSION_RE = /\.[A-Za-z0-9_+-]+$/

/** Minimum share of considered lines that must fit a shape to accept it. */
const MIN_PARSE_RATIO = 0.8
const DEFAULT_MAX_ROWS = 200

/**
 * A path in `<path>:<line>:<content>` must look like a filesystem path, not a
 * number — otherwise timestamps (`12:34:56 done`) and `line:col` diagnostics
 * parse as matches. Spaces are allowed: the `:<digits>:` anchor is specific
 * enough, and paths with spaces are real.
 */
function looksLikeMatchPath(value: string): boolean {
  if (!value) return false
  if (!/[./\\]/.test(value)) return false
  return !/^[\d.]+$/.test(value)
}

/**
 * A bare path line. Stricter than `looksLikeMatchPath` — with no `:<line>:`
 * anchor, whitespace is the only thing separating a path from prose like
 * "(Results are truncated, consider using a more specific path.)". The two
 * exclusions cover the shapes that otherwise sneak past the extension rule:
 * version-like tokens (`rg -o '\d+\.\d+\.\d+'` → `1.2.3`) and JSON records
 * (`rg --json`), neither of which is a file to link to.
 */
function looksLikeBarePath(value: string): boolean {
  if (!value || /\s/.test(value)) return false
  if (/^[\d.]+$/.test(value)) return false
  if (/^[{[]/.test(value)) return false
  return /[/\\]/.test(value) || FILE_EXTENSION_RE.test(value)
}

export function parseSearchOutput(
  text: string,
  opts?: { maxRows?: number }
): ParsedSearchOutput | null {
  const maxRows = opts?.maxRows ?? DEFAULT_MAX_ROWS
  if (!text.trim()) return null

  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const matchGroups = new Map<string, SearchMatchLine[]>()
  const filePaths: string[] = []
  const notes: string[] = []
  let considered = 0
  let matchLineCount = 0

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    if (CONTEXT_SEPARATOR_RE.test(line.trim())) continue
    considered++

    const match = line.match(MATCH_LINE_RE)
    if (match && looksLikeMatchPath(match[1])) {
      const path = match[1]
      const existing = matchGroups.get(path)
      const entry = { line: Number(match[2]), text: match[3] }
      if (existing) existing.push(entry)
      else matchGroups.set(path, [entry])
      matchLineCount++
      continue
    }

    if (looksLikeBarePath(line.trim())) {
      filePaths.push(line.trim())
      continue
    }

    notes.push(line.trim())
  }

  if (considered === 0) return null
  const threshold = Math.ceil(considered * MIN_PARSE_RATIO)

  if (matchLineCount > 0 && matchLineCount >= threshold) {
    const groups = [...matchGroups].map(([path, lines]) => ({ path, lines }))
    return capRows(
      {
        mode: "matches",
        groups,
        matchCount: matchLineCount,
        fileCount: groups.length,
        hiddenCount: 0,
        notes,
      },
      maxRows
    )
  }

  if (filePaths.length > 0 && filePaths.length >= threshold) {
    return capRows(
      {
        mode: "files",
        groups: filePaths.map((path) => ({ path, lines: [] })),
        matchCount: 0,
        fileCount: filePaths.length,
        hiddenCount: 0,
        notes,
      },
      maxRows
    )
  }

  return null
}

/**
 * Trim the result set to `maxRows` renderable rows — matched lines in "matches"
 * mode, files in "files" mode — recording the remainder in `hiddenCount`. The
 * counts stay authoritative (they describe the full output, not the shown part).
 */
function capRows(
  parsed: ParsedSearchOutput,
  maxRows: number
): ParsedSearchOutput {
  if (maxRows <= 0) return parsed

  if (parsed.mode === "files") {
    if (parsed.groups.length <= maxRows) return parsed
    return {
      ...parsed,
      groups: parsed.groups.slice(0, maxRows),
      hiddenCount: parsed.groups.length - maxRows,
    }
  }

  if (parsed.matchCount <= maxRows) return parsed
  const groups: SearchFileGroup[] = []
  let shown = 0
  for (const group of parsed.groups) {
    if (shown >= maxRows) break
    const lines = group.lines.slice(0, maxRows - shown)
    shown += lines.length
    groups.push({ path: group.path, lines })
  }
  return { ...parsed, groups, hiddenCount: parsed.matchCount - shown }
}
