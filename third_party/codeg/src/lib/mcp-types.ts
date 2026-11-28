export type CanonicalMcpType = "stdio" | "http" | "sse" | "local" | "remote"

const PRECISE_MAP: Record<string, CanonicalMcpType> = {
  stdio: "stdio",
  http: "http",
  sse: "sse",
  local: "local",
  remote: "remote",
}

export function normalizeMcpType(raw: string): CanonicalMcpType | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const lower = trimmed.toLowerCase()
  if (lower in PRECISE_MAP) return PRECISE_MAP[lower]

  const collapsed = lower.replace(/[^a-z0-9]/g, "")
  if (collapsed === "streamablehttp") return "http"

  return null
}
