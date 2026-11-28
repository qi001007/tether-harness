"use client"

import { MessagesSquare } from "lucide-react"
import { useTranslations } from "next-intl"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { formatFolderLabelWithAlias } from "@/lib/folder-display"

/**
 * The conversation column while tabs follow the folder and the selected one
 * has no conversation open. Nothing is opened for it unasked — every folder
 * the user passes through would collect a draft — so this says which folder
 * is on screen and offers the first step; the strip above keeps its "+" too.
 * The active folder IS the selected one here (an empty scope owns it), and
 * none means the chat scope.
 */
export function FolderTabsEmptyState() {
  const t = useTranslations("Folder.conversation")
  const { activeFolder } = useActiveFolder()
  const { openAgentsHome } = useWorkbenchRoute()
  const folder = activeFolder?.kind === "chat" ? null : activeFolder

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <MessagesSquare
        aria-hidden="true"
        className="h-8 w-8 text-muted-foreground/60"
      />
      <p className="text-sm text-muted-foreground">
        {folder
          ? t("emptyFolderScope", { name: formatFolderLabelWithAlias(folder) })
          : t("emptyChatScope")}
      </p>
      <button
        type="button"
        onClick={() =>
          openAgentsHome(folder ? { projectId: folder.id } : undefined)
        }
        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        选择 Agent 开始
      </button>
    </div>
  )
}
