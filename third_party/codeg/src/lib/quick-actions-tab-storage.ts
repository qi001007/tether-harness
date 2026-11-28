"use client"

const QUICK_ACTIONS_TAB_KEY = "workspace:quick-actions-tab"

/** Which skill group the welcome-page quick actions show. */
export type QuickActionsTab = "office" | "coding" | "research"

/**
 * Last-picked quick-actions tab, restored when a new conversation opens.
 * Defaults to "coding" (this is a coding workbench first); an absent or
 * polluted value falls back to that default.
 */
export function loadQuickActionsTab(): QuickActionsTab {
  if (typeof window === "undefined") return "coding"
  try {
    const raw = localStorage.getItem(QUICK_ACTIONS_TAB_KEY)
    if (raw === "office" || raw === "coding" || raw === "research") return raw
  } catch {
    /* ignore */
  }
  return "coding"
}

export function saveQuickActionsTab(value: QuickActionsTab): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(QUICK_ACTIONS_TAB_KEY, value)
  } catch {
    /* ignore */
  }
}
