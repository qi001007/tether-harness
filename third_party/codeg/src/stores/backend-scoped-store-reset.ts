// Registry of "reset to initial, backend-agnostic state" callbacks for the
// backend-scoped module singletons — the zustand stores that cache a SINGLE
// backend's folders / tabs / conversations. Each such store registers its reset
// here at import time; `RemoteConnectionGate` calls `resetBackendScopedStores()`
// if a realm's backend identity ever changes.
//
// Scope: a BEST-EFFORT tripwire, not a complete live-backend-switch mechanism. It
// resets store STATE; it does NOT cancel in-flight backend fetches (which can
// re-commit stale data unless each store also gains a backend epoch), reconfigure
// the transport, or gate rendering. The identity is immutable per realm today
// (see the gate), so this never actually fires — it exists to keep that invariant
// honest and to give a future in-place switcher one place to hook state teardown.
//
// Why a registry instead of the gate importing each store's reset directly:
//   1. Bundle boundaries — `RemoteConnectionGate` is also mounted by the
//      git-operation windows (commit / stash / push / merge) and the settings
//      window, none of which load the workspace stores. Self-registration keeps
//      those per-window bundles free of the (large) store modules; a realm that
//      never imports a store never registers it, so the reset is a precise no-op
//      there rather than a static dependency.
//   2. The reset touches exactly the stores that actually exist in the current
//      realm, with no import-order or partial-mount assumptions.
//
// NOTE: the ACP-agents store is intentionally NOT registered here. Its reset
// tears down a ref-counted subscription and would corrupt the refcount if any
// consumer were still mounted. It is left out because it already self-manages via
// that refcount (cold-resetting when its last consumer unmounts), and a real
// in-place backend switcher must handle its refcount explicitly anyway — e.g. a
// remote→local switch would NOT pass through the gate's loading-state unmount, so
// registering a forced reset here could fire while consumers are still mounted.

type ResetFn = () => void

const resets = new Set<ResetFn>()

/** Register a store reset to run when the realm's backend identity changes. */
export function registerBackendScopedStoreReset(reset: ResetFn): void {
  resets.add(reset)
}

/**
 * Reset every backend-scoped store registered in THIS realm to its initial
 * state. Called by `RemoteConnectionGate` only when the backend identity changes
 * within a live realm — an invariant-violating transition that does not occur in
 * the current architecture (see the gate's invariant note). A no-op when no
 * stores have registered (e.g. the git-operation windows).
 */
export function resetBackendScopedStores(): void {
  for (const reset of resets) reset()
}

/** Test-only: drop all registered resets so each test starts from a clean set. */
export function __clearRegisteredBackendScopedStoreResets(): void {
  resets.clear()
}
