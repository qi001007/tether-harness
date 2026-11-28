import { act, cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  handler: null as ((detail: unknown) => void) | null,
  openAgentsHome: vi.fn(),
  openNewConversationTab: vi.fn(),
  upsertFolder: vi.fn(),
  setBranch: vi.fn(),
  refreshConversations: vi.fn(),
}))

vi.mock("@/contexts/tab-context", () => ({
  useTabActions: () => ({ openNewConversationTab: mocks.openNewConversationTab }),
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ openAgentsHome: mocks.openAgentsHome }),
}))
vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: {
    getState: () => ({
      upsertFolder: mocks.upsertFolder,
      setBranch: mocks.setBranch,
      refreshConversations: mocks.refreshConversations,
    }),
  },
}))
vi.mock("@/lib/platform", () => ({
  subscribe: async (_event: string, handler: (detail: unknown) => void) => {
    mocks.handler = handler
    return vi.fn()
  },
}))
vi.mock("@/lib/api", () => ({
  FOLDER_OPEN_IN_WORKSPACE_EVENT: "folder://open-in-workspace",
}))

import { WorkspaceOpenFolderListener } from "./workspace-open-folder-listener"

afterEach(() => {
  cleanup()
  mocks.handler = null
  mocks.openAgentsHome.mockReset()
  mocks.openNewConversationTab.mockReset()
  mocks.upsertFolder.mockReset()
  mocks.setBranch.mockReset()
  mocks.refreshConversations.mockReset()
})

describe("WorkspaceOpenFolderListener", () => {
  it("selects a newly opened project in Agent Home without opening a conversation tab", async () => {
    render(<WorkspaceOpenFolderListener />)
    await waitFor(() => expect(mocks.handler).toBeTypeOf("function"))

    const folder = {
      id: 42,
      path: "D:/work/new-project",
      git_branch: "main",
    }
    act(() => mocks.handler?.(folder))

    expect(mocks.upsertFolder).toHaveBeenCalledWith(folder)
    expect(mocks.setBranch).toHaveBeenCalledWith(42, "main")
    expect(mocks.openAgentsHome).toHaveBeenCalledWith({ projectId: 42 })
    expect(mocks.openNewConversationTab).not.toHaveBeenCalled()
  })
})
