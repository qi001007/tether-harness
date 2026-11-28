"use client"

/**
 * Document-wide text-selection guard for pointer drags (tab sorting, cross-group
 * tab moves).
 *
 * The press that starts a drag also starts a browser text selection, and as the
 * pointer sweeps across headers, message bodies and other panes it smears
 * highlight over everything it crosses — noise the user has to click away after
 * every drop. `select-none` on `<body>` stops the spread (descendants'
 * `user-select: auto` resolves through it), and clearing the selection on
 * release removes anything that slipped in before the first drag frame.
 *
 * Refcounted: a stray `release` (a drag whose start never fired, a component
 * unmounting mid-drag) can't strand the page in a permanently unselectable
 * state, and overlapping acquisitions can't clear each other's guard early.
 */
let holders = 0

export function acquireDragSelectionGuard(): void {
  if (typeof document === "undefined") return
  holders += 1
  if (holders === 1) document.body.classList.add("select-none")
}

export function releaseDragSelectionGuard(): void {
  if (typeof document === "undefined") return
  if (holders === 0) return
  holders -= 1
  if (holders > 0) return
  document.body.classList.remove("select-none")
  window.getSelection()?.removeAllRanges()
}

/** Test seam: drop every outstanding hold and the body class with it. */
export function resetDragSelectionGuardForTests(): void {
  holders = 0
  if (typeof document !== "undefined") {
    document.body.classList.remove("select-none")
  }
}
