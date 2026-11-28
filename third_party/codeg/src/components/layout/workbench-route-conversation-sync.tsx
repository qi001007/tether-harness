"use client"

import { useEffect, useRef } from "react"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import { hasLoadedTabsSnapshot } from "@/stores/tab-store"

export function WorkbenchRouteConversationSync() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const rawTabs = useTabStore((s) => s.rawTabs)
  const tabsHydrated = useTabStore((s) => s.tabsHydrated)
  const { consumeRemoteActivation } = useTabActions()
  const { routeId, openAgentsHome, openConversations } = useWorkbenchRoute()
  const prevRef = useRef(activeTabId)
  const initialSnapshotCheckedRef = useRef(false)
  // Hydrating the first active tab is not a user choosing to leave an
  // explicitly requested initial route such as Tether's Agent home.
  const hadInitialActiveTabRef = useRef(activeTabId !== null)

  useEffect(() => {
    const activeTabChanged = prevRef.current !== activeTabId
    const previousTabId = prevRef.current
    prevRef.current = activeTabId
    const remoteActivation = activeTabChanged
      ? consumeRemoteActivation()
      : false

    if (
      !initialSnapshotCheckedRef.current &&
      tabsHydrated &&
      hasLoadedTabsSnapshot()
    ) {
      initialSnapshotCheckedRef.current = true
      if (routeId === "conversations" && rawTabs.length === 0) {
        if (!activeTabChanged) consumeRemoteActivation()
        openAgentsHome()
        return
      }
    }

    if (!activeTabChanged) return
    if (
      !hadInitialActiveTabRef.current &&
      previousTabId === null &&
      activeTabId !== null
    ) {
      hadInitialActiveTabRef.current = true
      return
    }
    // A remote tab snapshot that mirrors another client's focus also changes
    // activeTabId. That's not a local conversation activation, so don't hijack
    // this window into another route. Local activations leave the flag false
    // and switch as before.
    if (remoteActivation) return
    openConversations()
  }, [
    activeTabId,
    consumeRemoteActivation,
    openAgentsHome,
    openConversations,
    rawTabs,
    routeId,
    tabsHydrated,
  ])
  return null
}
