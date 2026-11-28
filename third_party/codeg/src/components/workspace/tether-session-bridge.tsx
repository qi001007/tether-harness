"use client"

import { useEffect } from "react"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import type { AgentType } from "@/lib/types"

/** Tether home agent ids → Codeg built-in agent types. */
const AGENT_ALIASES: Record<string, string> = {
  claude: "claude_code",
  opencode: "open_code",
  openclaw: "open_claw",
  codebuddy: "code_buddy",
  kimi: "kimi_code",
  minimax: "minimax_code",
  "command-code": "command_code",
}

/**
 * Bridge for the Tether host page embedding this workspace: the host posts
 * `{type:"tether:new-session", id, agent}` when the user picks an agent on the
 * Tether home, and this opens the shared Agent home with that agent selected.
 * The host retries until it sees `tether:new-session-ack`;
 * the id dedupe keeps those retries from changing the selection repeatedly.
 */
export function TetherSessionBridge() {
  const { openAgentsHome } = useWorkbenchRoute()

  useEffect(() => {
    const seen = new Set<string>()
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== "object" || data.type !== "tether:new-session") {
        return
      }
      const id = String((data as { id?: unknown }).id ?? "")
      if (id) {
        if (seen.has(id)) return
        seen.add(id)
      }
      const raw = String((data as { agent?: unknown }).agent ?? "")
      const agent = AGENT_ALIASES[raw] ?? raw
      openAgentsHome(agent ? { agentType: agent as AgentType } : undefined)
      ;(event.source as WindowProxy | null)?.postMessage(
        { type: "tether:new-session-ack", id },
        "*"
      )
    }

    window.addEventListener("message", onMessage)
    return () => {
      window.removeEventListener("message", onMessage)
    }
  }, [openAgentsHome])

  return null
}