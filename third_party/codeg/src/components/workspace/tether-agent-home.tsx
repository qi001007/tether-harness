"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Code2,
  FolderOpen,
  KeyRound,
  MessageSquare,
  Package,
  Plug,
  Plus,
  RotateCw,
  Save,
  SlidersHorizontal,
  Tag,
  Terminal,
  TerminalSquare,
  Trash2,
} from "lucide-react"
import { AgentIcon } from "@/components/agent-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { WorkbenchPageTitle } from "@/components/workbench/workbench-page-title"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useAcpAgents } from "@/hooks/use-acp-agents"
import { useShallow } from "zustand/react/shallow"
import { useTranslations } from "next-intl"
import { isOpenCodeV1Release } from "@/lib/agent-version"
import { acpUpdateAgentPreferences } from "@/lib/api"
import type { AcpAgentInfo, AgentType, FolderDetail } from "@/lib/types"
import { cn, randomUUID } from "@/lib/utils"

/** Vendor CLI used by the "terminal" action; ACP-only adapters have no shell. */
const AGENT_CLI: Record<string, string> = {
  codex: "codex",
  qoder: "qoder",
  gemini: "gemini",
  claude_code: "claude",
  open_code: "opencode",
  open_claw: "openclaw",
  code_buddy: "codebuddy",
  kimi_code: "kimi",
  minimax_code: "mcode",
  command_code: "command-code",
  cursor: "cursor-agent",
}

/** Herdr supports these registered agent kinds through its pane agent API. */
const HERDR_AGENT_KIND: Partial<Record<AgentType, string>> = {
  codex: "codex",
  claude_code: "claude",
  gemini: "gemini",
  open_code: "opencode",
  cursor: "cursor",
  kimi_code: "kimi",
  qwen_code: "qwen",
  qoder: "qodercli",
}

export function agentCliCommand(agentType: AgentType): string | undefined {
  return AGENT_CLI[agentType]
}

export function TetherAgentPage() {
  const { activeFolder } = useActiveFolder()
  const allFolders = useAppWorkspaceStore(
    useShallow((state) => state.allFolders)
  )
  const { openNewConversationTab } = useTabActions()
  const {
    openConversations,
    requestedAgentType,
    requestedProjectId,
    requestedTargetGroup,
  } = useWorkbenchRoute()
  const initialAgentType = useTabStore(
    (state) =>
      state.tabs.find((tab) => tab.id === state.activeTabId)?.agentType ??
      undefined
  )
  const selectedProject = useMemo(() => {
    if (requestedProjectId != null) {
      return (
        allFolders.find(
          (folder) =>
            folder.id === requestedProjectId && folder.kind !== "chat"
        ) ?? null
      )
    }
    if (!activeFolder || activeFolder.kind === "chat") return null
    return allFolders.find((folder) => folder.id === activeFolder.id) ?? null
  }, [activeFolder, allFolders, requestedProjectId])

  const handleOpenStructured = useCallback(
    (agentType: AgentType) => {
      if (!selectedProject) return
      openNewConversationTab(selectedProject.id, selectedProject.path, {
        forceAgent: agentType,
        ...(requestedTargetGroup ? { targetGroup: requestedTargetGroup } : {}),
      })
      openConversations()
    },
    [
      selectedProject,
      requestedTargetGroup,
      openConversations,
      openNewConversationTab,
    ]
  )

  const handleOpenTerminal = useCallback(
    (agent: AcpAgentInfo) => {
      const command = agentCliCommand(agent.agent_type)
      if (!command || !selectedProject) return
      const action = new URLSearchParams({
        tether_action: "open_cli",
        request_id: randomUUID(),
        agent_type: agent.agent_type,
        cwd: selectedProject.path,
      })
      window.location.hash = action.toString()
    },
    [selectedProject]
  )

  const handleOpenHerdr = useCallback(
    (agent: AcpAgentInfo) => {
      if (!selectedProject || !HERDR_AGENT_KIND[agent.agent_type]) return
      const action = new URLSearchParams({
        tether_action: "open_herdr",
        request_id: randomUUID(),
        agent_type: agent.agent_type,
        cwd: selectedProject.path,
      })
      window.location.hash = action.toString()
    },
    [selectedProject]
  )

  return (
    <TetherAgentHome
      initialAgentType={initialAgentType}
      requestedAgentType={requestedAgentType ?? undefined}
      selectedProject={selectedProject}
      onOpenStructured={handleOpenStructured}
      onOpenTerminal={handleOpenTerminal}
      onOpenHerdr={handleOpenHerdr}
    />
  )
}

export function TetherAgentPageTitle() {
  const t = useTranslations("SettingsShell.nav")
  return <WorkbenchPageTitle title={t("agents")} backLabel="返回当前会话" />
}

type EnvRow = { key: string; value: string }

function needsOpenCodeUpgrade(agent: AcpAgentInfo | null) {
  return Boolean(
    agent?.enabled &&
      agent.available &&
      agent.agent_type === "open_code" &&
      isOpenCodeV1Release(agent.installed_version ?? "")
  )
}

function statusLabel(agent: AcpAgentInfo) {
  return agent.enabled && agent.available
    ? "可用"
    : agent.enabled
      ? "未安装"
      : "已停用"
}

function distributionLabel(value: string) {
  switch (value) {
    case "builtin":
      return "内置"
    case "npm":
      return "npm"
    case "system":
      return "系统"
    case "custom":
      return "自定义"
    default:
      return value || "—"
  }
}

export function TetherAgentHome({
  initialAgentType,
  requestedAgentType,
  selectedProject,
  onOpenStructured,
  onOpenTerminal,
  onOpenHerdr,
}: {
  initialAgentType?: AgentType
  requestedAgentType?: AgentType
  selectedProject: FolderDetail | null
  onOpenStructured: (agentType: AgentType) => void
  onOpenTerminal: (agent: AcpAgentInfo) => void
  onOpenHerdr: (agent: AcpAgentInfo) => void
}) {
  const { agents, refresh } = useAcpAgents()
  const list = useMemo(() => agents.filter((agent) => agent.enabled), [agents])
  const [selectedType, setSelectedType] = useState<AgentType | null>(
    initialAgentType ?? null
  )
  const [requestedType, setRequestedType] = useState<AgentType | null>(null)
  useEffect(() => {
    setRequestedType(requestedAgentType ?? null)
    if (requestedAgentType) setSelectedType(requestedAgentType)
  }, [requestedAgentType])
  const selected = requestedType
    ? (list.find((agent) => agent.agent_type === requestedType) ?? null)
    : (list.find((agent) => agent.agent_type === selectedType) ??
      list[0] ??
      null)
  const cli = selected ? AGENT_CLI[selected.agent_type] : undefined
  const ready = Boolean(selected?.enabled && selected?.available)
  const upgradeOpenCode = needsOpenCodeUpgrade(selected)
  const structuredReady = ready && !upgradeOpenCode
  const version = selected?.installed_version || selected?.registry_version || ""

  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [configText, setConfigText] = useState("")
  const [advanced, setAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState("")

  useEffect(() => {
    setEnvRows(
      Object.entries(selected?.env || {}).map(([key, value]) => ({ key, value }))
    )
    setConfigText(selected?.config_json || "")
    setAdvanced(false)
    setNote("")
  }, [selected?.agent_type])

  const save = async (patch: { enabled?: boolean } = {}) => {
    if (!selected || saving) return
    const env: Record<string, string> = {}
    for (const row of envRows) {
      const key = row.key.trim()
      if (key) env[key] = row.value
    }
    const config: string | null = configText.trim() || null
    if (config) {
      try {
        JSON.parse(config)
      } catch {
        setNote("JSON 格式错误")
        return
      }
    }
    setSaving(true)
    setNote("")
    try {
      await acpUpdateAgentPreferences(selected.agent_type, {
        enabled: patch.enabled ?? selected.enabled,
        env,
        config_json: config,
      })
      await refresh()
      setNote("已保存")
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const updateRow = (index: number, patch: Partial<EnvRow>) => {
    setEnvRows((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full bg-background text-foreground">
      <div className="flex min-w-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r border-border/60 bg-muted/20">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/40 px-3 text-xs font-medium text-muted-foreground">
            <Bot aria-hidden className="size-3.5" />
            <span>智能体</span>
            <Badge variant="secondary" className="ml-auto h-4 px-1.5 text-[10px] tabular-nums">
              {list.length}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              title="刷新"
              aria-label="刷新 Agent"
              onClick={() => void refresh()}
              className="text-muted-foreground hover:text-foreground"
            >
              <RotateCw aria-hidden className="size-3.5" />
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {list.map((agent) => {
              const active = selected?.agent_type === agent.agent_type
              const available = agent.enabled && agent.available
              return (
                <button
                  key={agent.agent_type}
                  type="button"
                  onClick={() => {
                    setRequestedType(null)
                    setSelectedType(agent.agent_type)
                  }}
                  title={agent.name}
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    !available && "opacity-60"
                  )}
                >
                  <span className="relative grid size-7 shrink-0 place-items-center rounded-md border border-border/50 bg-background">
                    <AgentIcon agentType={agent.agent_type} className="size-4" />
                    <span
                      className={cn(
                        "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background",
                        available ? "bg-emerald-500" : "bg-amber-500"
                      )}
                    />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span
                      className={cn(
                        "truncate text-xs leading-tight",
                        active ? "font-semibold" : "font-medium"
                      )}
                    >
                      {agent.name}
                    </span>
                    {agent.installed_version ? (
                      <span className="truncate font-mono text-[10px] text-muted-foreground">
                        {agent.installed_version}
                      </span>
                    ) : null}
                  </span>
                  {needsOpenCodeUpgrade(agent) ? (
                    <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px] text-amber-600 dark:text-amber-400">
                      终端
                    </Badge>
                  ) : available ? null : (
                    <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px] text-amber-600 dark:text-amber-400">
                      未装
                    </Badge>
                  )}
                </button>
              )
            })}
            {!list.length ? (
              <div className="flex flex-col items-center justify-center gap-2 px-3 py-10 text-xs text-muted-foreground">
                <Bot aria-hidden className="size-5 opacity-50" />
                <span>暂无已启用智能体</span>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {selected ? (
            <div className="mx-auto w-full max-w-3xl space-y-6 px-7 py-6">
              {/* Header card */}
              <div className="flex items-start gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-border/70 bg-card shadow-xs">
                  <AgentIcon agentType={selected.agent_type} className="size-7" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-semibold tracking-tight text-foreground">
                      {selected.name}
                    </h2>
                    <Badge
                      variant={structuredReady ? "secondary" : "outline"}
                      className={cn(
                        "gap-1",
                        structuredReady
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "text-muted-foreground"
                      )}
                    >
                      {structuredReady ? (
                        <CheckCircle2 aria-hidden className="size-3" />
                      ) : (
                        <CircleSlash aria-hidden className="size-3" />
                      )}
                      {upgradeOpenCode ? "仅终端" : statusLabel(selected)}
                    </Badge>
                  </div>

                  {/* Compact icon metadata badges */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 font-mono text-[11px]">
                      <Tag aria-hidden className="size-3 opacity-70" />
                      {version || "—"}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[11px]">
                      <Plug aria-hidden className="size-3 opacity-70" />
                      {selected.is_acp_adapter ? "ACP" : "原生"}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[11px]">
                      <Package aria-hidden className="size-3 opacity-70" />
                      {distributionLabel(selected.distribution_type)}
                    </span>
                    {cli ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 font-mono text-[11px]">
                        <Terminal aria-hidden className="size-3 opacity-70" />
                        {cli}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 pt-1">
                  <span className="text-xs text-muted-foreground">启用</span>
                  <Switch
                    checked={Boolean(selected.enabled)}
                    onCheckedChange={(next) => void save({ enabled: next })}
                  />
                </div>
              </div>

              {/* Action bar */}
              <div className="rounded-xl border border-border/60 bg-card/50 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!selectedProject || !structuredReady}
                    onClick={() => onOpenStructured(selected.agent_type)}
                  >
                    <MessageSquare aria-hidden className="size-4" />
                    结构化
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selectedProject || !ready || !cli}
                    onClick={() => onOpenTerminal(selected)}
                    title={cli ? cli : undefined}
                  >
                    <TerminalSquare aria-hidden className="size-4" />
                    终端
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={
                      !selectedProject ||
                      !ready ||
                      !HERDR_AGENT_KIND[selected.agent_type]
                    }
                    onClick={() => onOpenHerdr(selected)}
                  >
                    <Activity aria-hidden className="size-4" />
                    Herdr
                  </Button>

                  {selectedProject ? (
                    <span
                      className="ml-auto inline-flex max-w-[260px] items-center gap-1.5 truncate rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground"
                      title={selectedProject.path}
                    >
                      <FolderOpen aria-hidden className="size-3.5 shrink-0" />
                      <span className="truncate">{selectedProject.name}</span>
                    </span>
                  ) : null}
                </div>

                {!selectedProject ? (
                  <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FolderOpen aria-hidden className="size-3.5 shrink-0" />
                    <span>从左侧选择或打开一个项目。</span>
                  </div>
                ) : null}
                {upgradeOpenCode ? (
                  <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    OpenCode 需 2.x 才支持结构化会话
                  </div>
                ) : null}
              </div>

              {/* Preferences */}
              <div className="rounded-xl border border-border/60 bg-card/40">
                <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5 text-xs font-medium text-muted-foreground">
                  <SlidersHorizontal aria-hidden className="size-3.5" />
                  <span>偏好设置</span>
                </div>

                <div className="divide-y divide-border/40 px-4">
                  <div className="group flex items-start gap-4 py-3">
                    <span className="inline-flex w-24 shrink-0 items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                      <KeyRound aria-hidden className="size-3.5 opacity-70" />
                      环境变量
                    </span>
                    <div className="min-w-0 flex-1">
                      {envRows.length ? (
                        <div className="grid gap-1.5">
                          {envRows.map((row, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <input
                                value={row.key}
                                placeholder="KEY"
                                onChange={(event) =>
                                  updateRow(index, { key: event.target.value })
                                }
                                className="h-7 w-[36%] min-w-0 rounded-md border border-border/60 bg-background px-2 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-ring"
                              />
                              <input
                                value={row.value}
                                placeholder="value"
                                onChange={(event) =>
                                  updateRow(index, {
                                    value: event.target.value,
                                  })
                                }
                                className="h-7 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-ring"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                title="删除"
                                aria-label="删除环境变量"
                                onClick={() =>
                                  setEnvRows((rows) =>
                                    rows.filter((_, i) => i !== index)
                                  )
                                }
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 aria-hidden className="size-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="inline-block pt-1 text-xs text-muted-foreground/70">
                          默认
                        </span>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        setEnvRows((rows) => [...rows, { key: "", value: "" }])
                      }
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <Plus aria-hidden className="size-3.5" />
                      添加
                    </Button>
                  </div>

                  <div className="flex items-center gap-4 py-3">
                    <span className="inline-flex w-24 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <Code2 aria-hidden className="size-3.5 opacity-70" />
                      JSON 配置
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => setAdvanced((value) => !value)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {selected.config_json ? "已配置" : "编辑"}
                      <ChevronDown
                        aria-hidden
                        className={cn(
                          "size-3.5 transition-transform",
                          advanced && "rotate-180"
                        )}
                      />
                    </Button>
                  </div>

                  {advanced ? (
                    <div className="py-3">
                      <textarea
                        value={configText}
                        spellCheck={false}
                        onChange={(event) => setConfigText(event.target.value)}
                        placeholder={'{\n  "key": "value"\n}'}
                        className="h-32 w-full resize-y rounded-lg border border-border/60 bg-background p-2.5 font-mono text-xs leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-ring"
                      />
                    </div>
                  ) : null}

                  <div className="flex items-center gap-3 py-3">
                    <Button
                      type="button"
                      size="sm"
                      disabled={saving}
                      onClick={() => void save()}
                    >
                      <Save aria-hidden className="size-3.5" />
                      {saving ? "保存中…" : "保存"}
                    </Button>
                    {note ? (
                      <span
                        className={cn(
                          "text-xs",
                          note.startsWith("已保存")
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-destructive"
                        )}
                      >
                        {note}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <Bot aria-hidden className="size-6 opacity-50" />
              <span>暂无可用智能体</span>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
