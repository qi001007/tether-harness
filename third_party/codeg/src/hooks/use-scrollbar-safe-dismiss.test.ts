import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useScrollbarSafeDismiss } from "@/hooks/use-scrollbar-safe-dismiss"

// A content box spanning x∈[100,300], y∈[50,450] — the popover's rect, with its
// native scrollbar gutter living at the right edge (x≈292–300).
const RECT = { left: 100, right: 300, top: 50, bottom: 450 } as DOMRect

function mountWithRect(rect: DOMRect | null) {
  const { result } = renderHook(() => useScrollbarSafeDismiss())
  result.current.contentRef.current = (rect
    ? { getBoundingClientRect: () => rect }
    : null) as unknown as HTMLDivElement
  return result
}

function firePointerDownOutside(
  handler: (event: CustomEvent<{ originalEvent: PointerEvent }>) => void,
  clientX: number,
  clientY: number
) {
  const preventDefault = vi.fn()
  handler({
    detail: { originalEvent: { clientX, clientY } as PointerEvent },
    preventDefault,
  } as unknown as CustomEvent<{ originalEvent: PointerEvent }>)
  return preventDefault
}

// Real jsdom content element (the focus guard needs `ownerDocument` + `contains`).
const attached: HTMLElement[] = []
afterEach(() => {
  attached.splice(0).forEach((el) => el.remove())
})
function mountWithContentEl() {
  const result = renderHook(() => useScrollbarSafeDismiss()).result
  const content = document.createElement("div")
  document.body.appendChild(content)
  attached.push(content)
  result.current.contentRef.current = content
  return { result, content }
}

function fireFocusOutside(
  handler: (event: CustomEvent<{ originalEvent: FocusEvent }>) => void,
  target: EventTarget | null
) {
  const preventDefault = vi.fn()
  handler({
    detail: { originalEvent: { target } as unknown as FocusEvent },
    preventDefault,
  } as unknown as CustomEvent<{ originalEvent: FocusEvent }>)
  return preventDefault
}

describe("useScrollbarSafeDismiss", () => {
  it("prevents dismissal when the pointer-down lands on the scrollbar gutter (inside the box)", () => {
    const result = mountWithRect(RECT)
    // Right-edge gutter where the native scrollbar sits.
    const preventDefault = firePointerDownOutside(
      result.current.onPointerDownOutside,
      296,
      220
    )
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it("allows dismissal for a genuine click outside the box", () => {
    const result = mountWithRect(RECT)
    const preventDefault = firePointerDownOutside(
      result.current.onPointerDownOutside,
      500,
      220
    )
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it("treats the box edges as inside (inclusive bounds)", () => {
    const result = mountWithRect(RECT)
    for (const [x, y] of [
      [100, 50],
      [300, 450],
      [300, 50],
    ] as const) {
      const preventDefault = firePointerDownOutside(
        result.current.onPointerDownOutside,
        x,
        y
      )
      expect(preventDefault).toHaveBeenCalledTimes(1)
    }
  })

  it("allows dismissal one pixel past the right/bottom edges", () => {
    const result = mountWithRect(RECT)
    expect(
      firePointerDownOutside(result.current.onPointerDownOutside, 301, 220)
    ).not.toHaveBeenCalled()
    expect(
      firePointerDownOutside(result.current.onPointerDownOutside, 200, 451)
    ).not.toHaveBeenCalled()
  })

  it("no-ops (never throws) before the content ref is attached", () => {
    const result = mountWithRect(null)
    const preventDefault = firePointerDownOutside(
      result.current.onPointerDownOutside,
      200,
      220
    )
    expect(preventDefault).not.toHaveBeenCalled()
  })

  // Defensive focus-outside shapes: focus landing on the document root, or
  // bouncing back inside the content, is always spurious — keep the layer open.
  // (The dominant real-WebKit case — a bounce to a genuinely outside element — is
  // covered by the pointer-origin tests further below.)
  it("prevents dismissal when focus drops to <body> (a blurred scrollbar grab)", () => {
    const { result } = mountWithContentEl()
    const preventDefault = fireFocusOutside(
      result.current.onFocusOutside,
      document.body
    )
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it("prevents dismissal when focus drops to the document element or null", () => {
    const { result } = mountWithContentEl()
    for (const target of [document.documentElement, null]) {
      const preventDefault = fireFocusOutside(
        result.current.onFocusOutside,
        target
      )
      expect(preventDefault).toHaveBeenCalledTimes(1)
    }
  })

  it("prevents dismissal when focus moves back inside the content", () => {
    const { result, content } = mountWithContentEl()
    const child = document.createElement("input")
    content.appendChild(child)
    const preventDefault = fireFocusOutside(
      result.current.onFocusOutside,
      child
    )
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it("allows dismissal when focus genuinely moves to an outside element", () => {
    const { result } = mountWithContentEl()
    const outside = document.createElement("input")
    document.body.appendChild(outside)
    attached.push(outside)
    const preventDefault = fireFocusOutside(
      result.current.onFocusOutside,
      outside
    )
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it("focus guard no-ops (never throws) before the content ref is attached", () => {
    const result = mountWithRect(null)
    const preventDefault = fireFocusOutside(
      result.current.onFocusOutside,
      document.body
    )
    expect(preventDefault).not.toHaveBeenCalled()
  })

  // The real WebKit bug: grabbing an inside scrollbar blurs the focused element
  // and WebKit bounces focus to an outside contenteditable (the message
  // composer). The focus target is genuinely outside, so it can only be told
  // apart from a real click-away by the pointer-down that started it — which
  // landed inside the content and is still held.
  it("prevents dismissal when an inside pointer-down bounces focus to an outside element", () => {
    const { result, content } = mountWithContentEl()
    const handle = document.createElement("div") // e.g. the scrollbar handle
    content.appendChild(handle)
    handle.dispatchEvent(new Event("pointerdown", { bubbles: true }))

    const outside = document.createElement("div") // e.g. the composer editor
    document.body.appendChild(outside)
    attached.push(outside)
    const preventDefault = fireFocusOutside(
      result.current.onFocusOutside,
      outside
    )
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it("allows dismissal when the initiating pointer-down was outside (a genuine click-away)", () => {
    const { result } = mountWithContentEl()
    const outside = document.createElement("input")
    document.body.appendChild(outside)
    attached.push(outside)
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }))

    const preventDefault = fireFocusOutside(
      result.current.onFocusOutside,
      outside
    )
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it("keeps the layer open briefly after an inside pointer-up, then allows dismissal", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000)
    const { result, content } = mountWithContentEl()
    const handle = document.createElement("div")
    content.appendChild(handle)
    handle.dispatchEvent(new Event("pointerdown", { bubbles: true })) // inside @ 1000
    document.dispatchEvent(new Event("pointerup")) // pointer released

    const outside = document.createElement("div")
    document.body.appendChild(outside)
    attached.push(outside)

    // Bounce lands 100ms after release — still within the grace window.
    now.mockReturnValue(1100)
    expect(
      fireFocusOutside(result.current.onFocusOutside, outside)
    ).toHaveBeenCalledTimes(1)

    // Well past the grace window — a real focus move now dismisses as usual.
    now.mockReturnValue(1600)
    expect(
      fireFocusOutside(result.current.onFocusOutside, outside)
    ).not.toHaveBeenCalled()

    now.mockRestore()
  })
})
