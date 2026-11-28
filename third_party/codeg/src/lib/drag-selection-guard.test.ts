import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  acquireDragSelectionGuard,
  releaseDragSelectionGuard,
  resetDragSelectionGuardForTests,
} from "./drag-selection-guard"

const guarded = () => document.body.classList.contains("select-none")

describe("drag selection guard", () => {
  beforeEach(() => {
    resetDragSelectionGuardForTests()
  })

  afterEach(() => {
    resetDragSelectionGuardForTests()
    vi.restoreAllMocks()
  })

  it("suppresses selection for the span of a drag", () => {
    expect(guarded()).toBe(false)
    acquireDragSelectionGuard()
    expect(guarded()).toBe(true)
    releaseDragSelectionGuard()
    expect(guarded()).toBe(false)
  })

  it("clears the selection smear that landed before the guard took hold", () => {
    const removeAllRanges = vi.fn()
    vi.spyOn(window, "getSelection").mockReturnValue({
      removeAllRanges,
    } as unknown as Selection)

    acquireDragSelectionGuard()
    expect(removeAllRanges).not.toHaveBeenCalled()
    releaseDragSelectionGuard()
    expect(removeAllRanges).toHaveBeenCalledTimes(1)
  })

  it("refcounts, so overlapping drags don't lift each other's guard early", () => {
    acquireDragSelectionGuard()
    acquireDragSelectionGuard()
    releaseDragSelectionGuard()
    expect(guarded()).toBe(true)
    releaseDragSelectionGuard()
    expect(guarded()).toBe(false)
  })

  it("ignores a release with nothing held (never strands an unselectable page)", () => {
    releaseDragSelectionGuard()
    expect(guarded()).toBe(false)
    // The stray release must not push the count negative — the next real drag
    // still guards.
    acquireDragSelectionGuard()
    expect(guarded()).toBe(true)
    releaseDragSelectionGuard()
    expect(guarded()).toBe(false)
  })
})
