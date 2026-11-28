import { describe, expect, it, vi } from "vitest"

import { cutSelectionToClipboard } from "./clipboard-actions"

describe("cutSelectionToClipboard", () => {
  it("removes the selection after a successful clipboard write", async () => {
    const copy = vi.fn().mockResolvedValue(true)
    const remove = vi.fn()
    const onWriteFailed = vi.fn()

    const result = await cutSelectionToClipboard({
      text: "hello",
      copy,
      remove,
      onWriteFailed,
    })

    expect(result).toBe(true)
    expect(copy).toHaveBeenCalledWith("hello")
    expect(remove).toHaveBeenCalledTimes(1)
    expect(onWriteFailed).not.toHaveBeenCalled()
  })

  it("does NOT remove the selection when the clipboard write fails (no data loss)", async () => {
    const copy = vi.fn().mockResolvedValue(false)
    const remove = vi.fn()
    const onWriteFailed = vi.fn()

    const result = await cutSelectionToClipboard({
      text: "hello",
      copy,
      remove,
      onWriteFailed,
    })

    expect(result).toBe(false)
    expect(copy).toHaveBeenCalledWith("hello")
    // The core invariant: a failed write must leave the content in place.
    expect(remove).not.toHaveBeenCalled()
    expect(onWriteFailed).toHaveBeenCalledTimes(1)
  })

  it("is a no-op for an empty selection", async () => {
    const copy = vi.fn().mockResolvedValue(true)
    const remove = vi.fn()
    const onWriteFailed = vi.fn()

    const result = await cutSelectionToClipboard({
      text: "",
      copy,
      remove,
      onWriteFailed,
    })

    expect(result).toBe(false)
    expect(copy).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(onWriteFailed).not.toHaveBeenCalled()
  })
})
