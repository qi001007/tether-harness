import { act, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Spy on the module-level prefetch so we assert scheduling behavior without
// driving the real dynamic imports.
const mocks = vi.hoisted(() => ({
  prefetchHeavyPlugins: vi.fn(),
}))

vi.mock("./streamdown-plugins", () => ({
  prefetchHeavyPlugins: mocks.prefetchHeavyPlugins,
}))

import { HeavyPluginsWarmup } from "./heavy-plugins-warmup"

afterEach(() => {
  mocks.prefetchHeavyPlugins.mockClear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("HeavyPluginsWarmup", () => {
  it("prefetches only the code engine when the browser goes idle", () => {
    let idleCb: (() => void) | null = null
    const requestIdle = vi.fn((cb: () => void) => {
      idleCb = cb
      return 42
    })
    const cancelIdle = vi.fn()
    vi.stubGlobal("requestIdleCallback", requestIdle)
    vi.stubGlobal("cancelIdleCallback", cancelIdle)

    const { unmount } = render(<HeavyPluginsWarmup />)
    // Scheduled, but nothing loaded until the idle window fires.
    expect(requestIdle).toHaveBeenCalledTimes(1)
    expect(mocks.prefetchHeavyPlugins).not.toHaveBeenCalled()

    act(() => idleCb?.())
    expect(mocks.prefetchHeavyPlugins).toHaveBeenCalledWith(["code"])

    // Unmounting cancels a still-scheduled idle callback.
    unmount()
    expect(cancelIdle).toHaveBeenCalledWith(42)
  })

  it("cancels the idle callback on unmount BEFORE it fires (no prefetch)", () => {
    const requestIdle = vi.fn(() => 7)
    const cancelIdle = vi.fn()
    vi.stubGlobal("requestIdleCallback", requestIdle)
    vi.stubGlobal("cancelIdleCallback", cancelIdle)

    const { unmount } = render(<HeavyPluginsWarmup />)
    // Unmount without ever invoking the idle callback: cancellation must both
    // cancel the handle AND leave the engine un-prefetched.
    unmount()
    expect(cancelIdle).toHaveBeenCalledWith(7)
    expect(mocks.prefetchHeavyPlugins).not.toHaveBeenCalled()
  })

  it("falls back to a timeout when requestIdleCallback is unavailable (WKWebView)", () => {
    vi.stubGlobal("requestIdleCallback", undefined)
    vi.useFakeTimers()

    render(<HeavyPluginsWarmup />)
    expect(mocks.prefetchHeavyPlugins).not.toHaveBeenCalled()

    act(() => {
      vi.runAllTimers()
    })
    expect(mocks.prefetchHeavyPlugins).toHaveBeenCalledWith(["code"])
  })

  it("cancels the fallback timeout on unmount (no prefetch)", () => {
    vi.stubGlobal("requestIdleCallback", undefined)
    vi.useFakeTimers()

    const { unmount } = render(<HeavyPluginsWarmup />)
    unmount()
    act(() => {
      vi.runAllTimers()
    })
    expect(mocks.prefetchHeavyPlugins).not.toHaveBeenCalled()
  })

  it("warms the code engine on first pointerdown and then stops listening", () => {
    // Idle stubbed to a recorder that never fires, so only the first-input path
    // can warm the engine in this test.
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn(() => 99)
    )
    vi.stubGlobal("cancelIdleCallback", vi.fn())

    render(<HeavyPluginsWarmup />)
    expect(mocks.prefetchHeavyPlugins).not.toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(new Event("pointerdown"))
    })
    expect(mocks.prefetchHeavyPlugins).toHaveBeenCalledTimes(1)
    expect(mocks.prefetchHeavyPlugins).toHaveBeenCalledWith(["code"])

    // One-shot: the listeners are removed after the first interaction, so
    // further input (of either kind) does not re-prefetch.
    act(() => {
      window.dispatchEvent(new Event("pointerdown"))
      window.dispatchEvent(new Event("keydown"))
    })
    expect(mocks.prefetchHeavyPlugins).toHaveBeenCalledTimes(1)
  })

  it("also warms on first keydown", () => {
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn(() => 1)
    )
    vi.stubGlobal("cancelIdleCallback", vi.fn())

    render(<HeavyPluginsWarmup />)
    act(() => {
      window.dispatchEvent(new Event("keydown"))
    })
    expect(mocks.prefetchHeavyPlugins).toHaveBeenCalledWith(["code"])
  })

  it("removes the input listeners on unmount so a later interaction is inert", () => {
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn(() => 1)
    )
    vi.stubGlobal("cancelIdleCallback", vi.fn())

    const { unmount } = render(<HeavyPluginsWarmup />)
    unmount()
    act(() => {
      window.dispatchEvent(new Event("pointerdown"))
    })
    expect(mocks.prefetchHeavyPlugins).not.toHaveBeenCalled()
  })
})
