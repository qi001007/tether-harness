import { describe, expect, it } from "vitest"

import {
  hasConflictMarkers,
  parseConflictMarkers,
  resolveConflict,
} from "./conflict-parser"

const SINGLE_CONFLICT = [
  "line before",
  "<<<<<<< HEAD",
  "ours line 1",
  "ours line 2",
  "=======",
  "theirs line 1",
  ">>>>>>> branch",
  "line after",
].join("\n")

describe("parseConflictMarkers", () => {
  it("returns empty for clean content", () => {
    expect(parseConflictMarkers("hello\nworld\n")).toEqual([])
  })

  it("captures a single conflict region with 1-based line numbers", () => {
    const regions = parseConflictMarkers(SINGLE_CONFLICT)
    expect(regions).toHaveLength(1)
    const r = regions[0]
    expect(r.startLine).toBe(2)
    expect(r.separatorLine).toBe(5)
    expect(r.endLine).toBe(7)
    expect(r.oursContent).toBe("ours line 1\nours line 2")
    expect(r.theirsContent).toBe("theirs line 1")
  })

  it("captures multiple conflict regions in order", () => {
    const content = [
      "<<<<<<< HEAD",
      "a1",
      "=======",
      "b1",
      ">>>>>>> branch",
      "middle",
      "<<<<<<< HEAD",
      "a2",
      "=======",
      "b2",
      ">>>>>>> branch",
    ].join("\n")
    const regions = parseConflictMarkers(content)
    expect(regions.map((r) => r.oursContent)).toEqual(["a1", "a2"])
    expect(regions.map((r) => r.theirsContent)).toEqual(["b1", "b2"])
  })

  it("ignores conflict block missing closing marker", () => {
    const content = "<<<<<<< HEAD\nfoo\n=======\nbar\n"
    expect(parseConflictMarkers(content)).toEqual([])
  })
})

describe("resolveConflict", () => {
  it("replaces region with ours content", () => {
    const region = parseConflictMarkers(SINGLE_CONFLICT)[0]
    const resolved = resolveConflict(SINGLE_CONFLICT, region, "ours")
    expect(resolved).toBe(
      ["line before", "ours line 1", "ours line 2", "line after"].join("\n")
    )
  })

  it("replaces region with theirs content", () => {
    const region = parseConflictMarkers(SINGLE_CONFLICT)[0]
    const resolved = resolveConflict(SINGLE_CONFLICT, region, "theirs")
    expect(resolved).toBe(
      ["line before", "theirs line 1", "line after"].join("\n")
    )
  })

  it("merges both sides with newline separator", () => {
    const region = parseConflictMarkers(SINGLE_CONFLICT)[0]
    const resolved = resolveConflict(SINGLE_CONFLICT, region, "both")
    expect(resolved).toBe(
      [
        "line before",
        "ours line 1",
        "ours line 2",
        "theirs line 1",
        "line after",
      ].join("\n")
    )
  })
})

describe("hasConflictMarkers", () => {
  it("requires both opening and closing markers", () => {
    expect(hasConflictMarkers(SINGLE_CONFLICT)).toBe(true)
    expect(hasConflictMarkers("<<<<<<< HEAD\nfoo")).toBe(false)
    expect(hasConflictMarkers(">>>>>>> branch")).toBe(false)
    expect(hasConflictMarkers("plain text")).toBe(false)
  })
})
