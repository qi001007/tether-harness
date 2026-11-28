import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { FolderDetail } from "@/lib/types"
import { FolderTabsEmptyState } from "./folder-tabs-empty-state"

const h = vi.hoisted(() => ({
  activeFolder: null as Partial<FolderDetail> | null,
  openNewConversationTab: vi.fn(),
  openChatModeTab: vi.fn(),
  openAgentsHome: vi.fn(),
}))

vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolder: h.activeFolder }),
}))
vi.mock("@/contexts/tab-context", () => ({
  useTabActions: () => ({
    openNewConversationTab: h.openNewConversationTab,
    openChatModeTab: h.openChatModeTab,
  }),
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ openAgentsHome: h.openAgentsHome }),
}))

function renderEmpty() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <FolderTabsEmptyState />
    </NextIntlClientProvider>
  )
}

describe("FolderTabsEmptyState", () => {
  beforeEach(() => {
    h.openNewConversationTab.mockClear()
    h.openChatModeTab.mockClear()
    h.openAgentsHome.mockClear()
  })

  it("names the selected folder and opens Agent home for it", () => {
    h.activeFolder = {
      id: 3,
      path: "/repo3",
      name: "repo3",
      alias: "Web",
      kind: "regular",
    }
    renderEmpty()
    expect(
      screen.getByText("No open conversations in Web [ repo3 ]")
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "选择 Agent 开始" }))
    expect(h.openAgentsHome).toHaveBeenCalledWith({ projectId: 3 })
    expect(h.openNewConversationTab).not.toHaveBeenCalled()
    expect(h.openChatModeTab).not.toHaveBeenCalled()
  })

  it("opens Agent home for chat scope, where a project must be selected", () => {
    h.activeFolder = null
    renderEmpty()
    expect(screen.getByText("No open chats")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "选择 Agent 开始" }))
    expect(h.openAgentsHome).toHaveBeenCalledWith(undefined)
    expect(h.openChatModeTab).not.toHaveBeenCalled()
    expect(h.openNewConversationTab).not.toHaveBeenCalled()
  })
})
