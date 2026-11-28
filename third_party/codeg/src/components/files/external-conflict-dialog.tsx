"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { toErrorMessage } from "@/lib/app-error"
import { useWorkspaceExternalConflict } from "@/contexts/workspace-context"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * Always-mounted resolver for external disk-vs-buffer conflicts, driven by
 * the provider's isolated conflict slice. Lives in the workspace layout —
 * NOT the (closed-by-default) aux file tree — so a divergence detected by
 * the tab watcher is resolvable regardless of which panels are open and
 * which folder is active.
 *
 * Renders null while idle and subscribes only to the conflict slice, so it
 * costs nothing during tab/content churn. Reuses the aux panel's original
 * i18n keys (Folder.fileTreeTab.externalConflictDialog / toasts) — the
 * strings are unchanged, only the mount point moved.
 */
export function ExternalConflictDialog() {
  const t = useTranslations("Folder.fileTreeTab")
  const {
    externalConflict,
    compareExternalConflict,
    reloadExternalConflict,
    saveExternalConflictCopy,
    dismissExternalConflict,
  } = useWorkspaceExternalConflict()
  const [savingCopy, setSavingCopy] = useState(false)

  if (!externalConflict) return null

  const handleSaveCopy = async () => {
    setSavingCopy(true)
    try {
      const savedPath = await saveExternalConflictCopy()
      toast.success(t("toasts.savedAsCopy"), { description: savedPath })
    } catch (error) {
      toast.error(t("toasts.saveCopyFailed"), {
        description: toErrorMessage(error),
      })
    } finally {
      setSavingCopy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return
        dismissExternalConflict()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("externalConflictDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("externalConflictDialog.descriptionWithPath", {
              path: externalConflict.path,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={savingCopy}
            onClick={compareExternalConflict}
          >
            {t("externalConflictDialog.compare")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={savingCopy}
            onClick={() => {
              void handleSaveCopy()
            }}
          >
            {savingCopy
              ? t("externalConflictDialog.savingCopy")
              : t("externalConflictDialog.saveAsCopy")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={savingCopy}
            onClick={reloadExternalConflict}
          >
            {t("externalConflictDialog.reload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
