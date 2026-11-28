"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type { AgentType } from "@/lib/types"

/**
 * The view occupying the main content region. `"conversations"` is the default
 * workspace (folder/conversation tabs); every other id is a full-page "route"
 * rendered in place of it (see WORKBENCH_ROUTES in workbench-content.tsx).
 *
 * To add a future left-sidebar route: extend this union, register a page
 * component in WORKBENCH_ROUTES, and add a SidebarNavButton that calls
 * `setRoute("<id>")`. Nothing else needs to change.
 */
export type WorkbenchRouteId =
  | "conversations"
  | "agents"
  | "automations"
  | "tasks"
  | "forge"
  | "tokenUsage"
  | "canvas"

interface WorkbenchRouteContextValue {
  routeId: WorkbenchRouteId
  /** Convenience for the common branch — `routeId === "conversations"`. */
  isConversations: boolean
  setRoute: (id: WorkbenchRouteId) => void
  /** Open the shared Agent home with optional host/group context. */
  openAgentsHome: (options?: {
    agentType?: AgentType
    projectId?: number
    targetGroup?: string
  }) => void
  requestedAgentType: AgentType | null
  requestedProjectId: number | null
  requestedTargetGroup: string | null
  /** Sugar for returning to the conversation workspace. */
  openConversations: () => void
}

const WorkbenchRouteContext = createContext<WorkbenchRouteContextValue | null>(
  null
)

/**
 * Drives which view fills the main content region. This mirrors the codebase's
 * lifted-state idiom (search-dialog-context): the trigger lives in the sidebar
 * (which unmounts when collapsed) while the content swap is owned by
 * WorkspaceContent — both read this single source of truth.
 *
 * Agents and conversations mirror their route in a small Tether query marker
 * so an authorized native guest refresh can restore the visible workspace.
 */
export function useWorkbenchRoute() {
  const ctx = useOptionalWorkbenchRoute()
  if (!ctx) {
    throw new Error(
      "useWorkbenchRoute must be used within WorkbenchRouteProvider"
    )
  }
  return ctx
}

/**
 * The route, or `null` outside the workspace layout.
 *
 * Null is a supported answer, not a failure: transcript surfaces also render
 * in windows that have no workbench at all (the pet panel, the standalone
 * commit / merge windows), and asking "is the file column reachable from
 * here?" has to be answerable there too — see `use-open-file-target.ts`.
 */
export function useOptionalWorkbenchRoute(): WorkbenchRouteContextValue | null {
  return useContext(WorkbenchRouteContext)
}

export function WorkbenchRouteProvider({ children }: { children: ReactNode }) {
  const [routeId, setRouteId] = useState<WorkbenchRouteId>("conversations")
  const [routeHydrated, setRouteHydrated] = useState(false)
  const [requestedAgentType, setRequestedAgentType] = useState<AgentType | null>(null)
  const [requestedProjectId, setRequestedProjectId] = useState<number | null>(null)
  const [requestedTargetGroup, setRequestedTargetGroup] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("tether_home") === "1") {
      setRouteId("agents")
    }
    setRouteHydrated(true)

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "tether:show-home") {
        setRequestedAgentType(null)
        setRequestedTargetGroup(null)
        setRouteId("agents")
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  useEffect(() => {
    if (!routeHydrated || (routeId !== "agents" && routeId !== "conversations")) return
    const url = new URL(window.location.href)
    if (routeId === "agents") {
      url.searchParams.set("tether_home", "1")
    } else {
      url.searchParams.delete("tether_home")
    }
    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
    }
  }, [routeHydrated, routeId])

  const setRoute = useCallback((id: WorkbenchRouteId) => {
    setRequestedAgentType(null)
    if (id === "conversations") setRequestedProjectId(null)
    setRequestedTargetGroup(null)
    setRouteId(id)
  }, [])
  const openAgentsHome = useCallback((options?: {
    agentType?: AgentType
    projectId?: number
    targetGroup?: string
  }) => {
    setRequestedAgentType(options?.agentType ?? null)
    setRequestedProjectId(options?.projectId ?? null)
    setRequestedTargetGroup(options?.targetGroup ?? null)
    setRouteId("agents")
  }, [])
  const openConversations = useCallback(() => {
    setRequestedAgentType(null)
    setRequestedProjectId(null)
    setRequestedTargetGroup(null)
    setRouteId("conversations")
  }, [])

  const value = useMemo<WorkbenchRouteContextValue>(
    () => ({
      routeId,
      isConversations: routeId === "conversations",
      setRoute,
      openAgentsHome,
      requestedAgentType,
      requestedProjectId,
      requestedTargetGroup,
      openConversations,
    }),
    [routeId, setRoute, openAgentsHome, requestedAgentType, requestedProjectId,
      requestedTargetGroup, openConversations]
  )

  return (
    <WorkbenchRouteContext.Provider value={value}>
      {children}
    </WorkbenchRouteContext.Provider>
  )
}
