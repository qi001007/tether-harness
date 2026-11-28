import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CollapsedOverlayChip } from "./collapsed-overlay-chip"

describe("CollapsedOverlayChip", () => {
  it("names the button by its summary and marks it collapsed", () => {
    render(
      <CollapsedOverlayChip
        icon={<span data-testid="chip-icon" />}
        summary="Plan 2/5"
        onClick={() => {}}
      />
    )

    // The icon is always present (it's the resting circular state).
    expect(screen.getByTestId("chip-icon")).toBeInTheDocument()
    // The accessible name is the visible summary (heard == seen), and the
    // button reports the collapsed disclosure state.
    const button = screen.getByRole("button", { name: "Plan 2/5" })
    expect(button).toHaveAttribute("aria-expanded", "false")
    // The summary text stays in the DOM (revealed on hover/focus via CSS).
    expect(screen.getByText("Plan 2/5")).toBeInTheDocument()
  })

  it("calls onClick when the chip is clicked", () => {
    const onClick = vi.fn()
    render(
      <CollapsedOverlayChip
        icon={<span data-testid="chip-icon" />}
        summary="Sub-agents 3"
        onClick={onClick}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Sub-agents 3" }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
