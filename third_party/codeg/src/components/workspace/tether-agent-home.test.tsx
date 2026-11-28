import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  project: { id: 7, kind: "project", name: "Selected", path: "D:/work/selected" },
  otherProject: { id: 8, kind: "project", name: "Other", path: "D:/work/other" },
  allFolders: [] as Array<{ id: number; kind: string; name: string; path: string }>,
  activeFolder: null as { id: number; kind: string; name: string; path: string } | null,
  requestedProjectId: null as number | null,
  agent: {
    agent_type: "codex",
    name: "Codex",
    enabled: true,
    available: true,
    env: {},
    distribution_type: "system",
  },
  openNewConversationTab: vi.fn(),
  openConversations: vi.fn(),
}))

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolder: mocks.activeFolder }),
}))
vi.mock("@/contexts/tab-context", () => ({
  useTabActions: () => ({ openNewConversationTab: mocks.openNewConversationTab }),
  useTabStore: (selector: (state: unknown) => unknown) => selector({
    tabs: [{ id: "tab-1", agentType: "codex" }],
    activeTabId: "tab-1",
  }),
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({
    openConversations: mocks.openConversations,
    requestedAgentType: null,
    requestedProjectId: mocks.requestedProjectId,
    requestedTargetGroup: null,
  }),
}))
vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: (selector: (state: unknown) => unknown) => selector({
    allFolders: mocks.allFolders,
  }),
}))
vi.mock("zustand/react/shallow", () => ({ useShallow: (selector: unknown) => selector }))
vi.mock("@/hooks/use-acp-agents", () => ({
  useAcpAgents: () => ({ agents: [mocks.agent], refresh: vi.fn() }),
}))
vi.mock("@/components/agent-icon", () => ({ AgentIcon: () => null }))
vi.mock("@/components/workbench/workbench-page-title", () => ({
  WorkbenchPageTitle: () => null,
}))
vi.mock("@/lib/api", () => ({ acpUpdateAgentPreferences: vi.fn() }))

import { TetherAgentPage } from "./tether-agent-home"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, "", "/workspace")
  mocks.openNewConversationTab.mockReset()
  mocks.openConversations.mockReset()
  mocks.allFolders = [mocks.project, mocks.otherProject]
  mocks.activeFolder = mocks.project
  mocks.requestedProjectId = null
})

beforeEach(() => {
  mocks.allFolders = [mocks.project, mocks.otherProject]
  mocks.activeFolder = mocks.project
  mocks.requestedProjectId = null
})

describe("TetherAgentPage terminal launch bridge", () => {
  it("sends a token-free typed CLI action for the selected Agent and project", () => {
    render(<TetherAgentPage />)
    fireEvent.click(screen.getByRole("button", { name: "终端" }))

    const params = new URLSearchParams(window.location.hash.slice(1))
    expect(params.get("tether_action")).toBe("open_cli")
    expect(params.get("agent_type")).toBe("codex")
    expect(params.get("cwd")).toBe(mocks.project.path)
    expect(params.get("request_id")).toMatch(/^[0-9a-f-]{36}$/i)
    expect(Array.from(params.keys()).sort()).toEqual([
      "agent_type", "cwd", "request_id", "tether_action",
    ])
    expect(params.has("command")).toBe(false)
    expect(params.has("env")).toBe(false)
    expect(mocks.openNewConversationTab).not.toHaveBeenCalled()
  })

  it("opens CLI and Herdr with getRandomValues when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0),
    })

    expect(typeof crypto.randomUUID).toBe("undefined")
    expect(typeof crypto.getRandomValues).toBe("function")

    render(<TetherAgentPage />)
    fireEvent.click(screen.getByRole("button", { name: "终端" }))

    const cliParams = new URLSearchParams(window.location.hash.slice(1))
    expect(cliParams.get("tether_action")).toBe("open_cli")
    expect(cliParams.get("request_id")).toBe("00000000-0000-4000-8000-000000000000")

    fireEvent.click(screen.getByRole("button", { name: "Herdr" }))

    const herdrParams = new URLSearchParams(window.location.hash.slice(1))
    expect(herdrParams.get("tether_action")).toBe("open_herdr")
    expect(herdrParams.get("agent_type")).toBe("codex")
    expect(herdrParams.get("cwd")).toBe(mocks.project.path)
    expect(herdrParams.get("request_id")).toBe("00000000-0000-4000-8000-000000000000")
  })

  it("uses the native sidebar's requested project for every launch mode", () => {
    mocks.requestedProjectId = mocks.otherProject.id
    render(<TetherAgentPage />)

    fireEvent.click(screen.getByRole("button", { name: "终端" }))
    expect(new URLSearchParams(window.location.hash.slice(1)).get("cwd"))
      .toBe(mocks.otherProject.path)

    fireEvent.click(screen.getByRole("button", { name: "结构化" }))
    expect(mocks.openNewConversationTab).toHaveBeenCalledWith(
      mocks.otherProject.id,
      mocks.otherProject.path,
      { forceAgent: "codex" }
    )
    expect(mocks.openConversations).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole("button", { name: "Herdr" }))
    expect(new URLSearchParams(window.location.hash.slice(1)).get("cwd"))
      .toBe(mocks.otherProject.path)
  })

  it("uses the active native folder as fallback and has no duplicate project list", () => {
    render(<TetherAgentPage />)

    expect(screen.queryByRole("button", { name: "Other D:/work/other" }))
      .not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Herdr" }))
    expect(new URLSearchParams(window.location.hash.slice(1)).get("cwd"))
      .toBe(mocks.project.path)
  })

  it("keeps all launch modes disabled until a native project is selected", () => {
    mocks.activeFolder = null
    mocks.requestedProjectId = null
    render(<TetherAgentPage />)

    expect(screen.getByText("从左侧选择或打开一个项目。")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "终端" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "结构化" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Herdr" })).toBeDisabled()
    expect(mocks.openNewConversationTab).not.toHaveBeenCalled()
  })
})
