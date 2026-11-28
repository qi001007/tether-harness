import { describe, expect, it } from "vitest"

import { rampStep } from "./charts"

describe("rampStep", () => {
  it("keeps zero off the ramp so 'no data' never reads as 'a little data'", () => {
    expect(rampStep(0, 100)).toBeNull()
    expect(rampStep(-5, 100)).toBeNull()
  })

  it("returns null when there is no scale to map onto", () => {
    expect(rampStep(10, 0)).toBeNull()
  })

  it("puts the maximum on the darkest step and any positive value on at least the lightest", () => {
    expect(rampStep(100, 100)).toBe(6)
    expect(rampStep(1, 1_000_000)).toBe(0)
  })

  it("compresses with a square root, so one outlier does not flatten the rest", () => {
    // Linear would put 25% at step 1 of 7; the sqrt scale lifts it to the
    // middle of the ramp, which is what makes a weekly rhythm visible next to
    // a single all-nighter.
    const linearStep = Math.ceil((25 / 100) * 7) - 1
    expect(rampStep(25, 100)).toBeGreaterThan(linearStep)
    expect(rampStep(25, 100)).toBe(3)
  })

  it("never returns an index outside the ramp", () => {
    for (const v of [1, 33, 66, 99, 100]) {
      const step = rampStep(v, 100)
      expect(step).not.toBeNull()
      expect(step!).toBeGreaterThanOrEqual(0)
      expect(step!).toBeLessThanOrEqual(6)
    }
  })
})
