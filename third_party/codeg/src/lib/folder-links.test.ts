import { describe, expect, it } from "vitest"
import {
  basenameOf,
  isPlanUsable,
  linkNameKey,
  partitionPlans,
  validateLinkName,
} from "./folder-links"
import type { FolderLinkPlan } from "@/lib/types"

function plan(overrides: Partial<FolderLinkPlan> = {}): FolderLinkPlan {
  return {
    targetPath: "/Users/me/work/api",
    baseName: "api",
    name: "api",
    renamed: false,
    collidesWithExistingEntry: false,
    rejection: null,
    existingLinkName: null,
    ...overrides,
  }
}

describe("validateLinkName", () => {
  it("accepts an ordinary name", () => {
    expect(validateLinkName("api")).toBeNull()
  })

  it("accepts the backend's disambiguation suffix", () => {
    // `-` must stay legal: it is what the backend appends for `api-2`.
    expect(validateLinkName("api-2")).toBeNull()
  })

  it("rejects blank and dot names", () => {
    expect(validateLinkName("")).toBe("empty")
    expect(validateLinkName("   ")).toBe("empty")
    expect(validateLinkName(".")).toBe("empty")
    expect(validateLinkName("..")).toBe("empty")
  })

  it("rejects path separators and Windows-illegal characters", () => {
    expect(validateLinkName("a/b")).toBe("illegalChars")
    expect(validateLinkName("a\\b")).toBe("illegalChars")
    for (const ch of [":", "*", "?", '"', "<", ">", "|"]) {
      expect(validateLinkName(`a${ch}b`)).toBe("illegalChars")
    }
  })

  it("rejects control characters", () => {
    expect(validateLinkName(`a${String.fromCharCode(0)}b`)).toBe("illegalChars")
    expect(validateLinkName(`a${String.fromCharCode(31)}b`)).toBe(
      "illegalChars"
    )
  })

  it("rejects Windows device names regardless of extension", () => {
    expect(validateLinkName("con")).toBe("reserved")
    expect(validateLinkName("CON")).toBe("reserved")
    expect(validateLinkName("nul.txt")).toBe("reserved")
    expect(validateLinkName("com9")).toBe("reserved")
    // Merely starting with one is fine.
    expect(validateLinkName("console")).toBeNull()
  })

  it("rejects an over-long name", () => {
    expect(validateLinkName("a".repeat(97))).toBe("tooLong")
    expect(validateLinkName("a".repeat(96))).toBeNull()
  })

  it("detects duplicates case-insensitively", () => {
    // macOS and Windows filesystems are case-insensitive by default, so `API`
    // and `api` would be the same directory entry.
    expect(validateLinkName("API", ["api"])).toBe("duplicate")
    expect(validateLinkName("api", new Set(["api"]))).toBe("duplicate")
    expect(validateLinkName("web", ["api"])).toBeNull()
  })

  it("ignores surrounding whitespace when comparing", () => {
    expect(validateLinkName("  api  ", ["api"])).toBe("duplicate")
  })
})

describe("linkNameKey", () => {
  it("normalizes case and whitespace", () => {
    expect(linkNameKey("  API ")).toBe("api")
  })
})

describe("isPlanUsable", () => {
  it("is true only for a rejection-free plan with a name", () => {
    expect(isPlanUsable(plan())).toBe(true)
    expect(isPlanUsable(plan({ rejection: "inside_root" }))).toBe(false)
    // No free name could be found — nothing to create.
    expect(isPlanUsable(plan({ name: "" }))).toBe(false)
  })
})

describe("partitionPlans", () => {
  it("splits usable from skipped while preserving order", () => {
    const a = plan({ targetPath: "/a", name: "a" })
    const bad = plan({ targetPath: "/b", rejection: "already_linked" })
    const c = plan({ targetPath: "/c", name: "c" })
    const { usable, skipped } = partitionPlans([a, bad, c])
    expect(usable.map((p) => p.targetPath)).toEqual(["/a", "/c"])
    expect(skipped.map((p) => p.targetPath)).toEqual(["/b"])
  })

  it("handles an empty batch", () => {
    expect(partitionPlans([])).toEqual({ usable: [], skipped: [] })
  })
})

describe("basenameOf", () => {
  it("takes the final segment of posix and windows paths", () => {
    expect(basenameOf("/Users/me/work/api")).toBe("api")
    expect(basenameOf("C:\\Users\\me\\api")).toBe("api")
  })

  it("ignores trailing separators", () => {
    expect(basenameOf("/Users/me/work/api/")).toBe("api")
  })

  it("degrades gracefully on a root path", () => {
    expect(basenameOf("/")).toBe("/")
  })
})
