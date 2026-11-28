import type { FolderLinkPlan, FolderLinkRejection } from "@/lib/types"

/**
 * Client-side mirror of the backend's link-name rules, used to validate an
 * inline rename before it is sent. The backend sanitizes again on write — this
 * exists so the dialog can grey out Save and explain why, not to be the
 * authority.
 */

const MAX_LINK_NAME_LEN = 96

const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
])

/**
 * Path separators, the characters Windows rejects in a file name, and control
 * characters. `-` is deliberately allowed — it is what the backend appends
 * when disambiguating (`api-2`).
 */

const ILLEGAL_NAME_CHARS = /[/\\:*?"<>|\u0000-\u001F]/

export type LinkNameIssue =
  | "empty"
  | "illegalChars"
  | "tooLong"
  | "reserved"
  | "duplicate"

/**
 * Case-insensitive key for collision checks. macOS and Windows filesystems are
 * case-insensitive by default, so `API` and `api` are the same entry there.
 */
export function linkNameKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * First problem with `name`, or `null` when it is usable.
 * `taken` holds {@link linkNameKey}s already in use in the same folder.
 */
export function validateLinkName(
  name: string,
  taken: Iterable<string> = []
): LinkNameIssue | null {
  const trimmed = name.trim()
  if (!trimmed || trimmed === "." || trimmed === "..") return "empty"
  if (ILLEGAL_NAME_CHARS.test(trimmed)) return "illegalChars"
  if (trimmed.length > MAX_LINK_NAME_LEN) return "tooLong"
  // Windows rejects these device names with or without an extension.
  const stem = trimmed.split(".")[0]?.toLowerCase() ?? ""
  if (WINDOWS_RESERVED.has(stem)) return "reserved"
  const takenSet = taken instanceof Set ? taken : new Set(taken)
  if (takenSet.has(linkNameKey(trimmed))) return "duplicate"
  return null
}

/** Whether a plan can actually be created. */
export function isPlanUsable(plan: FolderLinkPlan): boolean {
  return plan.rejection === null && plan.name.length > 0
}

/**
 * Rejections the user can act on by picking a different directory, versus ones
 * that are merely informational (the directory is already reachable).
 */
export function isRejectionActionable(rejection: FolderLinkRejection): boolean {
  return rejection === "not_found" || rejection === "not_a_directory"
}

/**
 * Split a preview response into the entries that will be created and the ones
 * that were skipped, preserving the order the user picked them in.
 */
export function partitionPlans(plans: FolderLinkPlan[]): {
  usable: FolderLinkPlan[]
  skipped: FolderLinkPlan[]
} {
  const usable: FolderLinkPlan[] = []
  const skipped: FolderLinkPlan[] = []
  for (const plan of plans) {
    if (isPlanUsable(plan)) usable.push(plan)
    else skipped.push(plan)
  }
  return { usable, skipped }
}

/** Final path segment of an absolute path, for compact display. */
export function basenameOf(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "")
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || trimmed || path
}
