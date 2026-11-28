import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"

import { useElementWidth } from "./use-element-width"

/**
 * jsdom reports 0 for every layout measurement, so these tests stub
 * `clientWidth` on the prototype — the point under test is *when* the hook
 * measures, not what the browser would report.
 */
function withStubbedWidth(width: number, run: () => void) {
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth"
  )
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  })
  try {
    run()
  } finally {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", original)
    } else {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
    }
  }
}

/** Mirrors the real chart shape: an early return that skips the measured node
 *  entirely until there is data to draw. */
function ConditionalChart({ hasData }: { hasData: boolean }) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  if (!hasData) return <div>empty</div>
  return (
    <div ref={ref}>
      <span data-testid="width">{width}</span>
    </div>
  )
}

function Toggle() {
  const [hasData, setHasData] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setHasData(true)}>
        show
      </button>
      <ConditionalChart hasData={hasData} />
    </>
  )
}

describe("useElementWidth", () => {
  it("measures a node that mounts on the first render", () => {
    withStubbedWidth(640, () => {
      render(<ConditionalChart hasData />)
      expect(screen.getByTestId("width").textContent).toBe("640")
    })
  })

  it("measures a node that only appears after a later render", () => {
    // The regression this guards: with an object ref + mount-only effect, the
    // measured node is absent when the effect runs, so the chart stays 0-wide
    // — permanently blank — once data finally arrives.
    withStubbedWidth(480, () => {
      render(<Toggle />)
      fireEvent.click(screen.getByText("show"))
      expect(screen.getByTestId("width").textContent).toBe("480")
    })
  })
})
