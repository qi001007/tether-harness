import { describe, expect, it, vi } from "vitest"
import { collectNewDeepseekSelections } from "@/lib/dsh-auto-sync"
import type { ScanResult, ScanSession } from "@/lib/types"

// The module imports the API client at load time; stub it so this suite stays a
// pure filter test (the scan/import round-trip is covered end to end against a
// live server, not in jsdom).
vi.mock("@/lib/api", () => ({
  importSelectedSessions: vi.fn(),
  scanImportableSessions: vi.fn(),
}))

function makeSession(overrides: Partial<ScanSession>): ScanSession {
  return {
    external_id: "session",
    agent_type: "deepseek",
    title: null,
    started_at: "2026-11-01T00:00:00Z",
    ended_at: null,
    message_count: 1,
    model: null,
    git_branch: null,
    status: "new",
    ...overrides,
  }
}

function makeScan(sessions: ScanSession[]): ScanResult {
  return {
    folders: [
      {
        path: "E:\\proj",
        name: "proj",
        exists_in_codeg: false,
        folder_id: null,
        agent_types: ["deepseek", "claude_code"],
        sessions,
      },
    ],
    no_folder_count: 0,
    total_sessions: sessions.length,
    importable_count: sessions.filter((s) => s.status === "new").length,
  }
}

describe("collectNewDeepseekSelections", () => {
  it("keeps only DeepSeek sessions the sidebar does not have yet", () => {
    const scan = makeScan([
      makeSession({ external_id: "new-dsh", status: "new" }),
      makeSession({ external_id: "old-dsh", status: "imported" }),
      makeSession({ external_id: "gone-dsh", status: "deleted" }),
      makeSession({
        external_id: "new-claude",
        agent_type: "claude_code",
        status: "new",
      }),
    ])

    expect(collectNewDeepseekSelections(scan)).toEqual([
      { agentType: "deepseek", externalId: "new-dsh" },
    ])
  })

  it("never selects a soft-deleted session (import would restore it)", () => {
    const scan = makeScan([
      makeSession({ external_id: "x", status: "deleted" }),
    ])

    expect(collectNewDeepseekSelections(scan)).toEqual([])
  })

  it("returns nothing when every session is already imported", () => {
    const scan = makeScan([
      makeSession({ external_id: "a", status: "imported" }),
      makeSession({ external_id: "b", status: "imported" }),
    ])

    expect(collectNewDeepseekSelections(scan)).toEqual([])
  })
})
