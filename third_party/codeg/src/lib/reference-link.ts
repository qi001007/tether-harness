/**
 * Canonical, framework-agnostic codec for inline reference links — the
 * `[label](destination)` form produced by `referenceToMarkdown` (file / session
 * / commit / agent mentions) and folded by the backend's
 * `user_blocks_from_prompt`.
 *
 * This module is the single source of truth for three operations that used to be
 * re-implemented per consumer (and had drifted apart):
 *  - building a `file://` uri from a path ({@link buildFileUri}),
 *  - reversing the serializer's label escaping ({@link unescapeReferenceLabel}),
 *  - parsing a raw string into prose/link tokens ({@link tokenizeReferenceLinks})
 *    and folding those links to their labels ({@link foldReferenceLinks}).
 *
 * The tokenizer is a single forward scan that visits each character O(1) times —
 * a regex for `[label](dest)` with its escaped-label / `<…>`-dest branches
 * backtracks super-linearly on pathological input (e.g. thousands of unmatched
 * `[`), which would jank every sidebar/tab render and the transcript pipeline.
 */

/**
 * Drop a Windows extended-length ("verbatim") prefix from an already
 * slash-normalized path.
 *
 * Rust's `fs::canonicalize` always hands back this form on Windows, so a path
 * that reached us from the backend can be `//?/C:/…` (drive) or `//?/UNC/srv/
 * share/…` (network share). Both must lose the prefix BEFORE the `//` check
 * below, which would otherwise read the `?` as a uri authority and emit
 * `file://%3F/C%3A/…` — a uri that decodes back to the unopenable path
 * `?/C:/…` (issue #392). The backend strips the prefix at its own boundary
 * too; doing it here as well keeps a fixed client working against an
 * unfixed server.
 *
 * `//?/Volume{…}` and other device paths have no plain equivalent, so they are
 * left alone (and still serialize as they did before).
 */
function stripVerbatimPrefix(normalized: string): string {
  // Windows accepts `//?/unc/` in any casing.
  const unc = /^\/\/\?\/UNC\//i.exec(normalized)
  if (unc) return `//${normalized.slice(unc[0].length)}`
  if (normalized.startsWith("//?/")) {
    const rest = normalized.slice(4)
    if (/^[a-zA-Z]:/.test(rest)) return rest
  }
  return normalized
}

/**
 * Build a `file://` uri from an absolute path (POSIX or Windows), percent-
 * encoding each path segment so spaces / `#` / `?` / `%` can't corrupt the uri.
 * A POSIX path (leading `/`) yields `file://<encoded>`; anything else (a Windows
 * `C:\…` path) yields `file:///<encoded>` so the drive segment is encoded.
 *
 * A UNC path (`//server/share/…`) yields the canonical authority form
 * `file://server/share/…` (host = server). Emitting `file:////…` instead
 * would parse back with an EMPTY authority and a `//`-prefixed pathname —
 * indistinguishable from a protocol-relative web url once re-serialized
 * into chat markdown, so the reference would open as a web link.
 *
 * A Windows verbatim path (`\\?\C:\…`) is reduced to its plain form first —
 * see {@link stripVerbatimPrefix}.
 */
export function buildFileUri(absolutePath: string): string {
  const normalized = stripVerbatimPrefix(absolutePath.replace(/\\/g, "/"))
  if (normalized.startsWith("//")) {
    const encoded = normalized
      .slice(2)
      .split("/")
      .map(encodeURIComponent)
      .join("/")
    return `file://${encoded}`
  }
  const encoded = normalized.split("/").map(encodeURIComponent).join("/")
  return normalized.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`
}

/**
 * A 1-based, inclusive line span selected in the editor. `end === start` is a
 * single line; `end > start` is a range. Callers normalize so `end >= start`.
 */
export interface FileLineRange {
  start: number
  end: number
}

/**
 * The `#L…` uri fragment for a line span: `L10` for one line, `L10-25` for a
 * range. Mirrors the GitHub/VS Code convention so the destination stays human-
 * readable and the agent can recover the lines from the link.
 */
function lineRangeFragment(range: FileLineRange): string {
  return range.end > range.start
    ? `L${range.start}-${range.end}`
    : `L${range.start}`
}

/**
 * {@link buildFileUri} with an optional `#L<start>[-<end>]` line-range fragment
 * appended. The fragment is concatenated AFTER per-segment encoding (and is
 * never itself encoded) so the `#` stays a literal fragment delimiter rather
 * than a percent-encoded path character. Encoding the range in the uri — not
 * just the label — is what lets two different selections of the same file
 * coexist as distinct badges (the composer dedupes file references by uri).
 */
export function buildFileUriWithRange(
  absolutePath: string,
  range?: FileLineRange | null
): string {
  const base = buildFileUri(absolutePath)
  return range ? `${base}#${lineRangeFragment(range)}` : base
}

/**
 * The badge label for a file selection: `foo.ts` with no range, `foo.ts:10` for
 * a single line, `foo.ts:10-25` for a span — matching how mainstream editors
 * present a "selection" chip.
 */
export function formatFileRangeLabel(
  fileName: string,
  range?: FileLineRange | null
): string {
  if (!range) return fileName
  return range.end > range.start
    ? `${fileName}:${range.start}-${range.end}`
    : `${fileName}:${range.start}`
}

/**
 * Reverse `escapeMarkdownText` (reference-text.ts): drop the backslash from each
 * escaped inline-significant punctuation char so the recovered label reads
 * literally. The character class mirrors the serializer's exactly.
 */
export function unescapeReferenceLabel(label: string): string {
  return label.replace(/\\([\\`*_~[\]()<>])/g, "$1")
}

/**
 * Reverse `escapeLinkDestination` (reference-text.ts): unwrap a CommonMark
 * angle-bracket destination (`<uri>`) AND drop the backslashes it escapes with,
 * yielding the bare uri. A destination that isn't angle-wrapped carries no
 * escapes (the serializer only wraps when it must) and is returned trimmed.
 *
 * The escape set mirrors the serializer's exactly: inside `<…>` it escapes `\`,
 * `<` and `>`. Unwrapping without decoding them would hand back a uri whose
 * backslashes are doubled — a wrong path on the badge/chip (`file:///C:\\dir`
 * instead of `file:///C:\dir`), and one more doubling on every
 * serialize → parse → serialize round-trip.
 */
export function unwrapReferenceDestination(destination: string): string {
  const trimmed = destination.trim()
  if (!trimmed.startsWith("<") || !trimmed.endsWith(">")) return trimmed
  return trimmed
    .slice(1, -1)
    .trim()
    .replace(/\\([\\<>])/g, "$1")
}

/**
 * Whether the backslash at `k` escapes the next character. CommonMark never lets
 * a backslash escape a space or line break, so a `\` + whitespace must END (not
 * extend) a label/destination scan — only `\` + a non-whitespace char (the
 * punctuation we care about: `]`, `>`, `<`, `)`) is a real escape. This keeps a
 * malformed `[a](foo\ bar)` or `[a](<…\<newline>…>)` correctly left verbatim.
 */
function escapesNext(s: string, k: number): boolean {
  return s[k] === "\\" && k + 1 < s.length && !/\s/.test(s[k + 1])
}

/**
 * If a well-formed `(destination)` begins at `start`, return the index just past
 * its closing `)`; otherwise -1. Mirrors `escapeLinkDestination`'s two forms: an
 * `<…>`-wrapped destination (interior `\`, `<`, `>` backslash-escaped) or a bare
 * run containing no `(`, `)`, whitespace, `<` or `>`.
 */
function destinationEnd(s: string, start: number): number {
  const n = s.length
  if (start >= n || s[start] !== "(") return -1
  let k = start + 1
  if (s[k] === "<") {
    k += 1
    while (k < n) {
      const c = s[k]
      if (escapesNext(s, k)) {
        k += 2
        continue
      }
      if (c === ">") return s[k + 1] === ")" ? k + 2 : -1
      // CommonMark forbids an unescaped `<` or a line break inside `<…>`, so
      // bail on them. This also bounds the scan: a malformed `…](<…` without a
      // closing `>` stops at the next `<` instead of running to EOF, which is
      // what keeps `"[a](<".repeat(n)` linear rather than quadratic.
      if (c === "<" || c === "\n" || c === "\r") return -1
      k += 1
    }
    return -1
  }
  while (k < n) {
    const c = s[k]
    if (escapesNext(s, k)) {
      k += 2
      continue
    }
    if (c === ")") return k + 1
    if (c === "(" || c === "<" || c === ">" || /\s/.test(c)) return -1
    k += 1
  }
  return -1
}

/** A reference-link tokenizer token: a run of prose or a parsed link. */
export type ReferenceLinkToken =
  | { type: "text"; value: string }
  | {
      type: "link"
      /** The full `[label](destination)` substring, verbatim. */
      raw: string
      /** The bracket text, still escaped (consumers unescape as needed). */
      label: string
      /**
       * The destination exactly as written between the parens — a bare uri, or a
       * `<…>`-wrapped uri including its angle brackets. Consumers strip the
       * `<…>` / test the scheme themselves.
       */
      destination: string
    }

/**
 * Split `text` into an ordered list of prose and `[label](destination)` link
 * tokens. Every character of the input appears in exactly one token, so
 * `tokens.map(raw-or-value).join("")` reconstructs the original string.
 *
 * Single O(n) left-to-right scan over a stack of unmatched `[` positions. A `]`
 * is matched against the most recent open `[`, so a balanced nested label closes
 * at the right bracket (`[a [b]](u)` → label `a [b]`). When that pair is followed
 * by a well-formed `(dest)` and the label is non-empty it becomes a link;
 * otherwise the `[` was not a link opener and the scan keeps going — so a
 * stray/unbalanced `[` in prose never hides a later valid link
 * (`text [oops [x](file://…)` still yields the `[x](…)` link). Escaped brackets
 * (`\[`, `\]`) are skipped and never open or close. A non-empty label is required
 * — the serializer emits `[label || id](uri)` and `id` is never empty, and the
 * historical extractor ignored empty-label links too.
 *
 * ReDoS-safe: each character is visited O(1) times, and each `]` triggers at
 * most one `destinationEnd` probe which bails at the next delimiter
 * (`(`/`)`/`<`/`>`/whitespace), so adversarial bracket/paren runs stay linear.
 */
export function tokenizeReferenceLinks(text: string): ReferenceLinkToken[] {
  const tokens: ReferenceLinkToken[] = []
  const n = text.length
  // Start of the pending prose run; flushed as one text token before each link
  // (and at the end), so prose is never emitted character-by-character.
  let textStart = 0
  // Indices of `[` seen but not yet matched by a `]` (most recent on top).
  const openers: number[] = []
  let i = 0

  const flushTextBefore = (end: number) => {
    if (end > textStart) {
      tokens.push({ type: "text", value: text.slice(textStart, end) })
    }
  }

  while (i < n) {
    if (escapesNext(text, i)) {
      // `\[` / `\]` (and any `\x`) is literal — skip both chars so an escaped
      // bracket never opens or closes a label.
      i += 2
      continue
    }
    const c = text[i]
    if (c === "[") {
      openers.push(i)
      i += 1
      continue
    }
    if (c === "]" && openers.length > 0) {
      const open = openers.pop() as number
      const end = destinationEnd(text, i + 1)
      // A link needs a well-formed `(dest)` right after `]` and a non-empty label
      // between the brackets.
      if (end !== -1 && i > open + 1) {
        flushTextBefore(open)
        // `i` is the closing `]`, so `i + 1` is `(` and `i + 2` is the first
        // destination char; `end - 1` is the closing `)`.
        tokens.push({
          type: "link",
          raw: text.slice(open, end),
          label: text.slice(open + 1, i),
          destination: text.slice(i + 2, end - 1),
        })
        // Everything up to `open` is committed (flushed as text or consumed by
        // this link), so any still-open outer `[` can no longer span a link.
        openers.length = 0
        i = end
        textStart = end
        continue
      }
      // Not a link: the brackets stay in the pending prose run; keep scanning so
      // a later well-formed link is still found.
      i += 1
      continue
    }
    i += 1
  }
  flushTextBefore(n)
  return tokens
}

/**
 * Replace every `[label](destination)` link in `text` with its unescaped
 * `label`, so inline references display as their text instead of raw Markdown.
 * Plain prose (including invocation tokens like `@Codex` or `/review`, which are
 * not links) is left as-is, as are malformed `[…]`/`(…)` fragments. A raw
 * `[text](url)` never belongs in a one-line title, so ordinary links fold too.
 * Returns `""` for a nullish input so callers can keep their
 * `foldReferenceLinks(title) || untitledFallback` shape.
 */
export function foldReferenceLinks(text: string | null | undefined): string {
  if (!text) return ""
  let out = ""
  for (const token of tokenizeReferenceLinks(text)) {
    out +=
      token.type === "link" ? unescapeReferenceLabel(token.label) : token.value
  }
  return out
}
