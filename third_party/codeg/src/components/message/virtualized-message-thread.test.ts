import { describe, expect, it } from "vitest"

import { shouldShiftForPrepend } from "./virtualized-message-thread"

describe("shouldShiftForPrepend", () => {
  it("shifts when the epoch advances within the same scope", () => {
    expect(
      shouldShiftForPrepend({ scope: 7, epoch: 0 }, { scope: 7, epoch: 1 })
    ).toBe(true)
    expect(
      shouldShiftForPrepend({ scope: 7, epoch: 3 }, { scope: 7, epoch: 4 })
    ).toBe(true)
  })

  it("never shifts on an unchanged epoch (streaming appends, window resets)", () => {
    expect(
      shouldShiftForPrepend({ scope: 7, epoch: 2 }, { scope: 7, epoch: 2 })
    ).toBe(false)
  })

  it("never shifts across a scope switch (another conversation's list)", () => {
    expect(
      shouldShiftForPrepend({ scope: 7, epoch: 0 }, { scope: 8, epoch: 5 })
    ).toBe(false)
    expect(
      shouldShiftForPrepend(
        { scope: undefined, epoch: 0 },
        { scope: 8, epoch: 1 }
      )
    ).toBe(false)
  })
})
