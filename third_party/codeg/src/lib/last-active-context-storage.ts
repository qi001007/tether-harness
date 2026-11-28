"use client"

const LAST_ACTIVE_CONTEXT_KEY = "codeg:last-active-context:v1"

/** Lightweight, device-local hint describing where the user last had focus while
 *  it was still an unsent draft. Persisted so a fresh launch can restore the
 *  *same* folder (or chat mode) instead of a blank workspace — without ever
 *  writing a conversation/folder DB row (the delayed-persistence invariant: rows
 *  are created only on first send).
 *
 *  The agent is intentionally NOT persisted: the recovered draft resolves its
 *  agent exactly like any new conversation (the folder's default, then the usual
 *  availability fallback), which avoids laundering a provisional cold-start guess
 *  into an explicit choice. `folderId` is `0` for chat mode (the folderless
 *  sentinel) and goes unused there since `isChat` is checked first.
 *
 *  Authoritative tab state remains the synced `opened_tabs`; this hint is
 *  advisory and resolves last-writer-wins across windows. */
export interface LastActiveContext {
  folderId: number
  isChat: boolean
}

export function loadLastActiveContext(): LastActiveContext | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_CONTEXT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return null
    const obj = parsed as Record<string, unknown>
    if (typeof obj.folderId !== "number") return null
    if (typeof obj.isChat !== "boolean") return null
    return {
      folderId: obj.folderId,
      isChat: obj.isChat,
    }
  } catch {
    return null
  }
}

export function saveLastActiveContext(ctx: LastActiveContext): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(LAST_ACTIVE_CONTEXT_KEY, JSON.stringify(ctx))
  } catch {
    /* ignore storage quota/permission failures */
  }
}

export function clearLastActiveContext(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(LAST_ACTIVE_CONTEXT_KEY)
  } catch {
    /* ignore */
  }
}
