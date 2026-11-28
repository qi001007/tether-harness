/**
 * Codex "code mode" script card.
 *
 * Newer codex wraps every tool call in a JS script and persists the whole
 * script as ONE rollout record. The history parser
 * (`src-tauri/src/parsers/codex_code_mode.rs`) recovers the inner
 * `tools.<name>(…)` calls and re-emits them as the tool calls codex wrote
 * before code mode, so the existing cards keep working.
 *
 * When a script cannot be decomposed (variable destructuring, a command built
 * in a loop, template interpolation) the parser emits this synthetic tool
 * instead of guessing — its input carries the raw script for a JS code block.
 */
export const CODEX_SCRIPT_TOOL_NAME = "codex_script"

export interface CodexScriptCard {
  /** Raw JS source codex executed. */
  source: string
  /** Best-effort title (the first command the parser could read). */
  title: string | null
  /** Number of `tools.*` call sites detected in the script. */
  callCount: number
}

export function parseCodexScriptCard(
  input: string | null | undefined
): CodexScriptCard | null {
  if (!input) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null

  const record = parsed as Record<string, unknown>
  const source = record.source
  if (typeof source !== "string") return null

  const title = typeof record.title === "string" ? record.title : null
  const callCount =
    typeof record.call_count === "number" && Number.isFinite(record.call_count)
      ? record.call_count
      : 0

  return { source, title, callCount }
}

/**
 * What the parser could establish about one command recovered from a code-mode
 * script, written on its `ToolUse.meta` under `codeg.codexScript`.
 *
 * A script that fans a literal table of commands out through one
 * `tools.exec_command({cmd, …})` labels each row, and prints that label ahead of
 * the row's output. When codex then truncates the combined output — it drops
 * whole lines, from the middle, with no marker — some of those labels go with
 * it, and the spans they used to separate can no longer be told apart. The
 * parser splits on the labels that survived and says plainly which commands it
 * could not place, rather than handing one command's output to another.
 */
export interface CodexScriptCallMeta {
  /** The table row's human name, shown beside the command. */
  label: string | null
  /** No surviving label bracketed this command, so nothing is attributable. */
  outputMissing: boolean
  /** Commands whose output shares this card because their labels were lost. */
  sharedWith: string[]
  /** Codex dropped lines from the output this card was cut out of. */
  truncated: boolean
}

export function parseCodexScriptMeta(
  meta: unknown
): CodexScriptCallMeta | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null
  const marks = (meta as Record<string, unknown>)["codeg.codexScript"]
  if (!marks || typeof marks !== "object" || Array.isArray(marks)) return null

  const record = marks as Record<string, unknown>
  const sharedWith = Array.isArray(record.sharedWith)
    ? record.sharedWith.filter(
        (name): name is string => typeof name === "string"
      )
    : []

  return {
    label: typeof record.label === "string" ? record.label : null,
    outputMissing: record.outputMissing === true,
    sharedWith,
    truncated: record.truncated === true,
  }
}
