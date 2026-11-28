import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { listOpenedTabs } = vi.hoisted(() => ({
  listOpenedTabs: vi.fn(),
}))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listOpenedTabs,
}))

import { WorkbenchRouteProvider, useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { resetTabStore, useTabStore } from "@/stores/tab-store"
import { WorkbenchRouteConversationSync } from "./workbench-route-conversation-sync"

function Probe() {
  const { routeId, openConversations } = useWorkbenchRoute()
  return (
    <>
      <span data-testid="route">{routeId}</span>
      <button onClick={openConversations}>open conversations</button>
    </>
  )
}

function renderSync() {
  return render(
    <WorkbenchRouteProvider>
      <WorkbenchRouteConversationSync />
      <Probe />
    </WorkbenchRouteProvider>
  )
}

beforeEach(() => {
  resetTabStore()
  listOpenedTabs.mockReset()
  // The provider mirrors the agents route into the tether_home query marker.
  // jsdom keeps one URL per file, so clear it to give every test a fresh load.
  window.history.replaceState(null, "", "/")
})

afterEach(() => {
  resetTabStore()
})

describe("WorkbenchRouteConversationSync", () => {
  it("opens Agent home after a successful empty tab snapshot", async () => {
    listOpenedTabs.mockResolvedValue({ version: 1, items: [] })
    renderSync()

    act(() => useTabStore.getState().hydrate())

    await waitFor(() => expect(screen.getByTestId("route")).toHaveTextContent("agents"))
  })

  it("keeps the conversations route when a persisted tab is restored", async () => {
    listOpenedTabs.mockResolvedValue({
      version: 1,
      items: [
        {
          folder_id: 7,
          conversation_id: 19,
          agent_type: "claude_code",
          is_pinned: false,
          is_active: true,
        },
      ],
    })
    renderSync()

    act(() => useTabStore.getState().hydrate())

    await waitFor(() =>
      expect(useTabStore.getState().tabsHydrated).toBe(true)
    )
    expect(screen.getByTestId("route")).toHaveTextContent("conversations")

    act(() => useTabStore.getState().closeTab("conv-7-claude_code-19"))

    await waitFor(() =>
      expect(useTabStore.getState().rawTabs).toHaveLength(0)
    )
    expect(screen.getByTestId("route")).toHaveTextContent("conversations")
  })

  it("does not redirect when the tab snapshot fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    listOpenedTabs.mockRejectedValue(new Error("offline"))
    renderSync()

    act(() => useTabStore.getState().hydrate())

    await waitFor(() =>
      expect(useTabStore.getState().tabsHydrated).toBe(true)
    )
    expect(screen.getByTestId("route")).toHaveTextContent("conversations")
    errorSpy.mockRestore()
  })

  it("does not redirect an explicit structured draft back to Agent home", async () => {
    listOpenedTabs.mockResolvedValue({ version: 1, items: [] })
    renderSync()

    act(() => useTabStore.getState().hydrate())
    await waitFor(() => expect(screen.getByTestId("route")).toHaveTextContent("agents"))

    act(() => {
      useTabStore.setState({
        rawTabs: [
          {
            id: "structured-draft",
            kind: "conversation",
            folderId: 7,
            conversationId: null,
            agentType: "claude_code",
            title: "New conversation",
            isPinned: false,
            forceAgentSelection: true,
          },
        ],
        activeTabId: "structured-draft",
      })
      screen.getByText("open conversations").click()
    })

    expect(screen.getByTestId("route")).toHaveTextContent("conversations")
  })
})
