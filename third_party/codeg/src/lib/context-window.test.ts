import { describe, expect, it } from "vitest"

import {
  formatContextWindowPercent,
  resolveContextWindowPercent,
} from "./context-window"

describe("resolveContextWindowPercent", () => {
  it("prefers the backend percent over a used/max recompute (matches the status bar)", () => {
    // 50000 / 200000 = 25, but the backend figure wins.
    expect(resolveContextWindowPercent(99, 50000, 200000)).toBe(99)
  })

  it("recomputes from used/max when the percent is absent", () => {
    expect(resolveContextWindowPercent(null, 50000, 200000)).toBe(25)
    expect(resolveContextWindowPercent(undefined, 50000, 200000)).toBe(25)
  })

  it("clamps the result into 0–100", () => {
    expect(resolveContextWindowPercent(250, null, null)).toBe(100)
    expect(resolveContextWindowPercent(-5, null, null)).toBe(0)
  })

  it("returns null when nothing is known or max is non-positive", () => {
    expect(resolveContextWindowPercent(null, null, null)).toBeNull()
    expect(resolveContextWindowPercent(null, 50000, 0)).toBeNull()
    expect(resolveContextWindowPercent(null, 50000, null)).toBeNull()
  })

  it("treats a backend percent of 0 as a real value (not missing)", () => {
    expect(resolveContextWindowPercent(0, 50000, 200000)).toBe(0)
  })
})

describe("formatContextWindowPercent", () => {
  it("keeps one decimal place", () => {
    expect(formatContextWindowPercent(25)).toBe("25.0%")
    expect(formatContextWindowPercent(87.34)).toBe("87.3%")
  })

  it("renders an em-dash placeholder for null", () => {
    expect(formatContextWindowPercent(null)).toBe("--")
  })
})
