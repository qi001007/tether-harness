import type { MouseEvent } from "react"
import { describe, expect, it, vi } from "vitest"

import { handleMiddleClickClose } from "./utils"

function mouseEventWithButton(button: number) {
  const preventDefault = vi.fn()
  const event = { button, preventDefault } as unknown as MouseEvent
  return { event, preventDefault }
}

describe("handleMiddleClickClose", () => {
  it("closes and prevents default on middle-click (button 1)", () => {
    const onClose = vi.fn()
    const { event, preventDefault } = mouseEventWithButton(1)

    handleMiddleClickClose(event, onClose)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it("ignores left-click (button 0)", () => {
    const onClose = vi.fn()
    const { event, preventDefault } = mouseEventWithButton(0)

    handleMiddleClickClose(event, onClose)

    expect(onClose).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it("ignores right-click (button 2) so the context menu still opens", () => {
    const onClose = vi.fn()
    const { event, preventDefault } = mouseEventWithButton(2)

    handleMiddleClickClose(event, onClose)

    expect(onClose).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
