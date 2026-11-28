import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Capture the registry's reset. The hook under test is the only part of the gate
// exercised here, so the other gate deps (next/navigation, next-intl, transport)
// load but are never invoked.
const mockResetBackendScopedStores = vi.fn()
vi.mock("@/stores/backend-scoped-store-reset", () => ({
  resetBackendScopedStores: () => mockResetBackendScopedStores(),
  registerBackendScopedStoreReset: vi.fn(),
  __clearRegisteredBackendScopedStoreResets: vi.fn(),
}))

import { useResetBackendScopedStoresOnIdentityChange } from "./remote-connection-context"

afterEach(() => mockResetBackendScopedStores.mockClear())

describe("useResetBackendScopedStoresOnIdentityChange", () => {
  it("does NOT reset on initial mount", () => {
    renderHook(({ k }) => useResetBackendScopedStoresOnIdentityChange(k), {
      initialProps: { k: "5::win-a" },
    })
    expect(mockResetBackendScopedStores).not.toHaveBeenCalled()
  })

  it("does NOT reset when the identity is unchanged across rerenders", () => {
    const { rerender } = renderHook(
      ({ k }) => useResetBackendScopedStoresOnIdentityChange(k),
      { initialProps: { k: "5::win-a" } }
    )
    rerender({ k: "5::win-a" })
    rerender({ k: "5::win-a" })
    expect(mockResetBackendScopedStores).not.toHaveBeenCalled()
  })

  it("resets exactly once when the backend identity changes, then stays quiet", () => {
    const { rerender } = renderHook(
      ({ k }) => useResetBackendScopedStoresOnIdentityChange(k),
      { initialProps: { k: "5::win-a" } }
    )

    rerender({ k: "7::win-b" })
    expect(mockResetBackendScopedStores).toHaveBeenCalledTimes(1)

    // Stable again at the new identity → no further resets.
    rerender({ k: "7::win-b" })
    expect(mockResetBackendScopedStores).toHaveBeenCalledTimes(1)
  })

  it("resets again on each subsequent distinct change (incl. local→remote)", () => {
    const { rerender } = renderHook(
      ({ k }) => useResetBackendScopedStoresOnIdentityChange(k),
      { initialProps: { k: "local::win-a" } }
    )
    rerender({ k: "5::win-a" }) // local → backend 5: reset 1
    rerender({ k: "9::win-a" }) // backend 5 → 9: reset 2
    expect(mockResetBackendScopedStores).toHaveBeenCalledTimes(2)
  })

  it("resets on a remote→local transition too (the hook is symmetric)", () => {
    const { rerender } = renderHook(
      ({ k }) => useResetBackendScopedStoresOnIdentityChange(k),
      { initialProps: { k: "5::win-a" } }
    )
    rerender({ k: "local::win-a" }) // backend 5 → local: reset
    expect(mockResetBackendScopedStores).toHaveBeenCalledTimes(1)
  })
})
