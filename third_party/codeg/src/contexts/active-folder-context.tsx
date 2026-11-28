"use client"

import { useShallow } from "zustand/react/shallow"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import type { FolderDetail } from "@/lib/types"

interface ActiveFolderValue {
  activeFolderId: number | null
  activeFolder: FolderDetail | null
}

/**
 * Derived view over the app-workspace store: the active folder id (driven by
 * the active tab) plus its resolved `FolderDetail`. `useShallow` keeps the
 * returned pair stable, so consumers only re-render when the id or the folder
 * object itself changes — not on unrelated folder-list churn.
 */
export function useActiveFolder(): ActiveFolderValue {
  return useAppWorkspaceStore(
    useShallow((s) => ({
      activeFolderId: s.activeFolderId,
      activeFolder:
        s.activeFolderId != null
          ? (s.allFolders.find((f) => f.id === s.activeFolderId) ?? null)
          : null,
    }))
  )
}
