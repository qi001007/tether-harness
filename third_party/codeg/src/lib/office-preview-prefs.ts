// Whether to auto-open a live preview when an agent produces an office file
// (.docx/.xlsx/.pptx) in the workspace. Persisted in localStorage; defaults to
// ON now that the file-lock contention that made it disruptive is fixed (the
// preview uses a long-lived `officecli watch` server instead of re-reading the
// file on every change).

import { useEffect, useState } from "react"

const AUTO_PREVIEW_KEY = "workspace:office-auto-preview"
const AUTO_PREVIEW_EVENT = "codeg:office-auto-preview-changed"

export function loadOfficeAutoPreview(): boolean {
  if (typeof window === "undefined") return true
  try {
    // Default ON: only an explicit "false" disables it.
    return localStorage.getItem(AUTO_PREVIEW_KEY) !== "false"
  } catch {
    return true
  }
}

export function saveOfficeAutoPreview(value: boolean): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(AUTO_PREVIEW_KEY, String(value))
  } catch {
    /* ignore */
  }
  // Notify same-window listeners (settings + workspace may share a window);
  // cross-window/tab updates arrive via the native `storage` event.
  window.dispatchEvent(new CustomEvent(AUTO_PREVIEW_EVENT, { detail: value }))
}

/**
 * Reactive read of the auto-preview preference. Updates live when the toggle
 * changes — in this window (custom event) or another window/tab (storage
 * event) — so flipping it in the Settings window takes effect in the
 * workspace immediately, without a reload.
 */
export function useOfficeAutoPreview(): boolean {
  const [enabled, setEnabled] = useState<boolean>(loadOfficeAutoPreview)
  useEffect(() => {
    const sync = () => setEnabled(loadOfficeAutoPreview())
    window.addEventListener(AUTO_PREVIEW_EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(AUTO_PREVIEW_EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])
  return enabled
}
