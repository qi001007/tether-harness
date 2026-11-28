"use client"

import { useEffect, useMemo, useState } from "react"

import {
  expertsListAllInstallStatuses,
  officecliSkillListAllInstallStatuses,
  scienceListAllInstallStatuses,
} from "@/lib/api"
import { useAcpAgents } from "@/hooks/use-acp-agents"
import { piUsesCustomAgentDir } from "@/lib/pi-config"
import type { AgentType, ExpertInstallStatus } from "@/lib/types"

// Module-level cache shared across QuickActions mounts. The snapshots are
// agent-agnostic (one entry per (skill, agent) pair), so switching the selected
// agent only re-filters in memory — no refetch. Refreshed on window focus to
// pick up enable/disable performed in the settings window.
let cached: ExpertInstallStatus[] | null = null
let inflight: Promise<ExpertInstallStatus[] | null> | null = null
// Bumped on every invalidation (focus). A load whose generation is stale by the
// time it resolves must not overwrite a fresher snapshot — guards the
// focus-refetch race where an orphaned earlier request resolves last.
let generation = 0
const subscribers = new Set<(snapshot: ExpertInstallStatus[]) => void>()

/**
 * Load the experts + office-tools + science install-status snapshots and merge
 * them.
 *
 * Fails *open*: if any request rejects, we keep (and return) the previous
 * cached snapshot rather than substituting an empty list. That matters because
 * a locked card blocks injection — turning a transient backend error into an
 * empty snapshot would make every skill look "not enabled" and wrongly block
 * skills the user actually enabled. With no prior snapshot the result stays
 * `null`, so `ready` remains false and callers treat everything as usable
 * (the pre-gating behavior) instead of locking it all.
 */
async function loadSnapshot(): Promise<ExpertInstallStatus[] | null> {
  if (inflight) return inflight
  const myGeneration = generation
  const request: Promise<ExpertInstallStatus[] | null> = Promise.all([
    expertsListAllInstallStatuses(),
    officecliSkillListAllInstallStatuses(),
    scienceListAllInstallStatuses(),
  ])
    .then(([experts, office, science]) => {
      // Only clear the shared handle if it still points at *this* request: a
      // focus refresh may have superseded it, and nulling unconditionally would
      // orphan the newer in-flight request and let a concurrent mount kick off a
      // duplicate scan.
      if (inflight === request) inflight = null
      // A newer invalidation superseded this request while it was in flight —
      // discard its result so it can't clobber the fresher snapshot.
      if (myGeneration !== generation) return cached
      const merged = [...experts, ...office, ...science]
      cached = merged
      for (const notify of subscribers) notify(merged)
      return merged
    })
    .catch((err) => {
      if (inflight === request) inflight = null
      console.warn("[useEnabledSkillIds] failed to load statuses:", err)
      return cached
    })
  inflight = request
  return inflight
}

// Window-focus refetch is shared across all hook instances via a single
// module-level listener + refcount. Skill links are edited in the settings
// window, so we refresh when this window regains focus — but a per-instance
// listener meant every mounted consumer (e.g. each conversation composer) fired
// its own refresh on the same focus event, and because the handler clears
// `inflight` before calling `loadSnapshot`, those N calls defeated the in-flight
// dedup and ran N concurrent (expert + office) status scans. One coalesced
// refresh per focus keeps the cost flat regardless of how many composers mount.
let focusRefcount = 0
let focusListener: (() => void) | null = null

function refreshSnapshotOnFocus(): void {
  // Force a fresh load even if one is in flight: it may have started before the
  // settings change we just returned from. The generation bump makes any stale
  // request discard its result instead of clobbering the fresh one. On failure
  // the cache is kept, so a transient error never resets a good snapshot.
  generation += 1
  inflight = null
  loadSnapshot()
}

function acquireFocusRefresh(): void {
  if (typeof window === "undefined") return
  focusRefcount += 1
  if (focusListener) return
  focusListener = refreshSnapshotOnFocus
  window.addEventListener("focus", focusListener)
}

function releaseFocusRefresh(): void {
  if (typeof window === "undefined") return
  focusRefcount = Math.max(0, focusRefcount - 1)
  if (focusRefcount > 0 || !focusListener) return
  window.removeEventListener("focus", focusListener)
  focusListener = null
}

/**
 * Returns the set of skill ids (built-in experts + office tools + science)
 * currently
 * enabled — i.e. symlinked into the given agent's skill directory — for the
 * passed agent. Mirrors the settings page's "enabled" definition: a
 * `(skillId, agentType)` pair counts as enabled only when its install status is
 * `linked_to_codeg`.
 *
 * `ready` is false until the first snapshot resolves successfully, so callers
 * can avoid marking everything as "not enabled" during the initial async load
 * (or after an error, where we deliberately stay not-ready and fail open).
 *
 * `supported` is false for an agent codeg's skill store can't manage — today
 * only a pi pointed at a custom `PI_CODING_AGENT_DIR`, whose skills live in a
 * per-agent dir codeg's default-dir store never touches. For such an agent
 * `enabledIds` is forced empty (so no consumer can surface a default-dir link
 * as enabled) and skill UIs should hide their shortcuts rather than show a
 * dead-end "enable in Settings" path the Settings matrices also hide. pi is
 * held unsupported until the agent registry has loaded, so a custom-dir pi
 * never briefly exposes default-dir shortcuts during the optimistic window.
 */
export function useEnabledSkillIds(agentType: AgentType | null): {
  enabledIds: Set<string>
  ready: boolean
  supported: boolean
} {
  const { agents, fresh: agentsFresh } = useAcpAgents()
  const [snapshot, setSnapshot] = useState<ExpertInstallStatus[] | null>(
    () => cached
  )

  // Initial load + subscribe for updates (covers the focus refetch below and
  // any concurrent QuickActions instance resolving the shared fetch first).
  // Only adopt a non-null result: a null means "load failed / not loaded yet",
  // and overwriting a good local snapshot with null would needlessly drop us
  // back to not-ready.
  useEffect(() => {
    let cancelled = false
    if (!cached) {
      loadSnapshot().then((next) => {
        if (!cancelled && next) setSnapshot(next)
      })
    }
    const onUpdate = (next: ExpertInstallStatus[]) => {
      if (!cancelled) setSnapshot(next)
    }
    subscribers.add(onUpdate)
    return () => {
      cancelled = true
      subscribers.delete(onUpdate)
    }
  }, [])

  // Re-fetch when the window regains focus — the settings window links/unlinks
  // skills while this conversation window stays mounted. The listener is shared
  // at module scope (refcounted), so N mounted consumers trigger a single
  // coalesced refresh per focus event rather than one scan each. The refresh
  // notifies every subscriber (no direct setState here, so the lint rule against
  // state-in-effect stays satisfied).
  useEffect(() => {
    acquireFocusRefresh()
    return () => releaseFocusRefresh()
  }, [])

  // A pi pointed at a custom PI_CODING_AGENT_DIR isn't managed by codeg's
  // default-dir skill store. The custom dir lives in the agent registry's
  // env_json, so pi is held unmanaged until that registry is first `fresh`
  // (pessimistic — a custom-dir pi must never expose default-dir shortcuts
  // during the initial optimistic load), then managed only when it resolves to
  // a default-dir pi. Non-pi agents are unaffected.
  //
  // `fresh` is monotonic, so a mid-session dir change leaves `agents` briefly
  // stale during the reload it triggers. We let that converge within one reload
  // rather than gate on every in-flight reload: the env save that stores the
  // dir override emits `app://acp-agents-updated`, which this hook's
  // `useAcpAgents` reloads on, so the stale view self-heals in one round-trip.
  // Gating all reloads would instead flicker default-dir pi's shortcuts on every
  // window focus (useAcpAgents reloads on focus and the consumers hide whole
  // shortcut surfaces) — a worse, recurring regression than a sub-frame window
  // whose worst case is one ignored skill badge.
  const piSkillsUnmanaged = useMemo(() => {
    if (agentType !== "pi") return false
    if (!agentsFresh) return true
    const agent = agents.find((a) => a.agent_type === agentType)
    return !agent || piUsesCustomAgentDir(agent)
  }, [agentType, agentsFresh, agents])

  const enabledIds = useMemo(() => {
    const set = new Set<string>()
    if (!snapshot || !agentType || piSkillsUnmanaged) return set
    for (const status of snapshot) {
      if (
        status.agentType === agentType &&
        status.state === "linked_to_codeg"
      ) {
        set.add(status.expertId)
      }
    }
    return set
  }, [snapshot, agentType, piSkillsUnmanaged])

  return {
    enabledIds,
    // An unmanaged pi is authoritatively "no managed skills", so report ready
    // immediately instead of leaving consumers in the optimistic loading state.
    ready: piSkillsUnmanaged || snapshot !== null,
    supported: !piSkillsUnmanaged,
  }
}
