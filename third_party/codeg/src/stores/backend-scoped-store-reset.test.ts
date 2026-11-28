import { afterEach, describe, expect, it, vi } from "vitest"

import {
  __clearRegisteredBackendScopedStoreResets,
  registerBackendScopedStoreReset,
  resetBackendScopedStores,
} from "./backend-scoped-store-reset"

// NOTE: importing the real stores (app-workspace / tab / conversation-runtime)
// would register their resets into this same module-level Set as a side effect.
// This test imports ONLY the registry, so the Set starts empty and holds exactly
// what each test registers.
afterEach(() => __clearRegisteredBackendScopedStoreResets())

describe("backend-scoped store reset registry", () => {
  it("invokes every registered reset once", () => {
    const a = vi.fn()
    const b = vi.fn()
    registerBackendScopedStoreReset(a)
    registerBackendScopedStoreReset(b)

    resetBackendScopedStores()

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it("dedupes the same reset (Set semantics)", () => {
    const a = vi.fn()
    registerBackendScopedStoreReset(a)
    registerBackendScopedStoreReset(a)

    resetBackendScopedStores()

    expect(a).toHaveBeenCalledTimes(1)
  })

  it("is a no-op when nothing is registered (e.g. a git-operation window)", () => {
    expect(() => resetBackendScopedStores()).not.toThrow()
  })
})
