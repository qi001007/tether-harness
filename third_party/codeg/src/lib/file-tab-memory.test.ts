import { describe, expect, it } from "vitest"
import { selectTabsToUnload } from "@/lib/file-tab-memory"

const rank = (ids: string[]) => new Map(ids.map((id, index) => [id, index]))

describe("selectTabsToUnload", () => {
  it("selects nothing while the total fits the budget", () => {
    const result = selectTabsToUnload(
      [
        { id: "a", charCount: 40 },
        { id: "b", charCount: 40 },
      ],
      rank(["a", "b"]),
      100
    )
    expect(result.size).toBe(0)
  })

  it("unloads least-recently-active tabs first, stopping once under budget", () => {
    // Recency: a is most recent, c is oldest.
    const result = selectTabsToUnload(
      [
        { id: "a", charCount: 50 },
        { id: "b", charCount: 50 },
        { id: "c", charCount: 50 },
      ],
      rank(["a", "b", "c"]),
      100
    )
    expect([...result]).toEqual(["c"])
  })

  it("keeps evicting until the remainder fits", () => {
    const result = selectTabsToUnload(
      [
        { id: "a", charCount: 90 },
        { id: "b", charCount: 90 },
        { id: "c", charCount: 90 },
      ],
      rank(["a", "b", "c"]),
      100
    )
    expect(result.has("c")).toBe(true)
    expect(result.has("b")).toBe(true)
    expect(result.has("a")).toBe(false)
  })

  it("reclaims never-activated tabs before ranked ones", () => {
    const result = selectTabsToUnload(
      [
        { id: "ranked-old", charCount: 50 },
        { id: "never-activated", charCount: 50 },
      ],
      rank(["ranked-old"]),
      60
    )
    expect([...result]).toEqual(["never-activated"])
  })

  it("unloads a single oversized tab even when it is the only candidate", () => {
    const result = selectTabsToUnload(
      [{ id: "huge", charCount: 500 }],
      rank(["huge"]),
      100
    )
    expect(result.has("huge")).toBe(true)
  })
})
