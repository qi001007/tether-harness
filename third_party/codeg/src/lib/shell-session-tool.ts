/**
 * Codex unified-exec session tools (`wait` / `write_stdin`).
 *
 * Neither carries a command of its own: both address a background shell that an
 * earlier `exec_command` started, by the id that command's output announced
 * (`wait` calls it `cell_id`, `write_stdin` calls it `session_id`). Rendered
 * from the raw arguments they were bare `wait` / `bash` cards over a
 * `{"cell_id":"7106","yield_time_ms":30000}` parameter dump.
 *
 * The history parser (`src-tauri/src/parsers/codex.rs`) resolves the id back to
 * that command and adds it as `session_command`, so these cards can be titled
 * by the command they are waiting on. The field is absent when the id was never
 * announced in the transcript (e.g. the session was started by a code-mode
 * script whose arguments could not be recovered) — the card then falls back to
 * naming the session id.
 */

/** Canonical (post-`normalizeToolName`) names of the two session tools. */
export const WAIT_TOOL_NAME = "wait"
export const WRITE_STDIN_TOOL_NAME = "write_stdin"

export function isShellSessionToolName(toolName: string): boolean {
  const name = toolName.toLowerCase()
  return name === WAIT_TOOL_NAME || name === WRITE_STDIN_TOOL_NAME
}

export interface ShellSessionCall {
  /** `cell_id` / `session_id`, normalized to a string (codex sends both). */
  sessionId: string | null
  /** Command that started the session, resolved by the history parser. */
  command: string | null
  /** Keystrokes sent (`write_stdin` only). Empty string means "just poll". */
  chars: string
  /** `wait` may ask to kill the session instead of waiting on it. */
  terminate: boolean
}

function readId(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

export function parseShellSessionInput(
  input: string | null | undefined
): ShellSessionCall | null {
  if (!input) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null
  }

  const record = parsed as Record<string, unknown>
  const command = record.session_command
  const chars = record.chars
  return {
    sessionId: readId(record.cell_id) ?? readId(record.session_id),
    command:
      typeof command === "string" && command.trim().length > 0 ? command : null,
    chars: typeof chars === "string" ? chars : "",
    terminate: record.terminate === true,
  }
}

/**
 * The line a code-mode script prints to publish the session it just started:
 *
 * ```js
 * const r = await tools.exec_command({ cmd: "npx playwright install", … })
 * text(r.output)
 * if (r.session_id) text(`SESSION_ID=${r.session_id}`)
 * ```
 *
 * Anchored to the whole line, uppercase, digits only — the single spelling real
 * transcripts use (every one of the 95 announcements across 749 rollouts), and
 * tight enough that a command merely mentioning the words cannot mint an id.
 */
const ANNOUNCED_SESSION_ID = /^[ \t]*SESSION_ID[ \t]*=[ \t]*(\d+)[ \t\r]*$/m

/**
 * The background session id a command's own output announced.
 *
 * codex's own announcements never reach the card: the prose envelope is dropped
 * with everything above the `Output:` line, and the code-mode JSON one is
 * unwrapped to its `output` field. The script's echo above is the only one that
 * survives into the body — and it is exactly the case the history parser cannot
 * resolve, because it reads those envelopes rather than the echo. So the `wait`
 * calls polling such a session stay titled by the bare id ("Wait cell 17983");
 * showing the same id on the command card is what lets the two be matched up.
 */
export function extractAnnouncedSessionId(
  output: string | null | undefined
): string | null {
  if (!output) return null
  return ANNOUNCED_SESSION_ID.exec(output)?.[1] ?? null
}

const NAMED_CONTROL_CHARS: Record<string, string> = {
  "\n": "⏎",
  "\r": "⏎",
  "\t": "⇥",
  "\u007f": "^?",
}

/**
 * Render keystrokes sent to a session as something readable in a card title —
 * the payload is usually a control character (`Ctrl-C` to interrupt, a bare
 * newline to confirm a prompt), which would otherwise be invisible.
 */
export function describeStdinChars(chars: string, maxLen = 40): string {
  let out = ""
  for (const ch of chars) {
    const named = NAMED_CONTROL_CHARS[ch]
    if (named) {
      out += named
      continue
    }
    const code = ch.codePointAt(0) ?? 0
    // Remaining C0 controls render as caret notation (`Ctrl-C` → `^C`).
    out += code < 0x20 ? `^${String.fromCharCode(code + 64)}` : ch
  }
  out = out.trim()
  return out.length > maxLen ? `${out.slice(0, maxLen - 1)}…` : out
}
