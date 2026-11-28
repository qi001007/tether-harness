import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { useImeGuard } from "./use-ime-guard"

function Probe({ onEnter }: { onEnter: () => void }) {
  const ime = useImeGuard()
  return (
    <input
      aria-label="probe"
      {...ime.props}
      onKeyDown={(event) => {
        if (ime.isComposing(event)) return
        if (event.key === "Enter") onEnter()
      }}
    />
  )
}

describe("useImeGuard", () => {
  it("lets a plain Enter through", () => {
    const onEnter = vi.fn()
    render(<Probe onEnter={onEnter} />)
    fireEvent.keyDown(screen.getByLabelText("probe"), { key: "Enter" })
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it("blocks the Enter that confirms a CJK candidate on WebKit", () => {
    // WebKit ends the composition before dispatching the confirming keydown,
    // so the tracked flag is already cleared and `isComposing` is false — only
    // the 229 sentinel is left.
    const onEnter = vi.fn()
    render(<Probe onEnter={onEnter} />)
    const input = screen.getByLabelText("probe")

    fireEvent.compositionStart(input)
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 })
    expect(onEnter).not.toHaveBeenCalled()

    // The deliberate Enter that follows still submits.
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it("blocks Enter while a composition is open with no in-event signal", () => {
    // The tracked-flag fallback: composition started, not yet ended, and the
    // engine reports a bare Enter.
    const onEnter = vi.fn()
    render(<Probe onEnter={onEnter} />)
    const input = screen.getByLabelText("probe")

    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onEnter).not.toHaveBeenCalled()

    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it("recovers when the composing control is removed without compositionend", () => {
    // A control can vanish mid-composition (a terminal tab closing under an
    // open rename box). No `compositionend` fires, so the flag must not stay
    // set and kill Enter for whatever replaces it.
    const onEnter = vi.fn()
    function Swappable() {
      const ime = useImeGuard()
      const [round, setRound] = useState(0)
      return (
        <>
          <button onClick={() => setRound((r) => r + 1)}>swap</button>
          <input
            key={round}
            aria-label="probe"
            {...ime.props}
            onKeyDown={(event) => {
              if (ime.isComposing(event)) return
              if (event.key === "Enter") onEnter()
            }}
          />
        </>
      )
    }
    render(<Swappable />)

    fireEvent.compositionStart(screen.getByLabelText("probe"))
    // Remount the input (new key) — the old node is detached, still "composing".
    fireEvent.click(screen.getByText("swap"))
    fireEvent.keyDown(screen.getByLabelText("probe"), { key: "Enter" })
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it("keeps a stable identity across renders", () => {
    const seen: unknown[] = []
    function Identity() {
      const ime = useImeGuard()
      seen.push(ime)
      return null
    }
    const { rerender } = render(<Identity />)
    rerender(<Identity />)
    expect(seen.length).toBeGreaterThan(1)
    expect(new Set(seen).size).toBe(1)
  })
})
