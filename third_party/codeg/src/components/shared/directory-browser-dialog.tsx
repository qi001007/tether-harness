"use client"

import { useCallback, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  DirectoryBrowser,
  type DirectoryBrowserHandle,
} from "@/components/shared/directory-browser"

interface DirectoryBrowserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
  title?: string
  initialPath?: string
}

/**
 * Single-directory picker. A thin dialog shell around [`DirectoryBrowser`],
 * which owns the navigation and validation; multi-step flows embed that panel
 * directly instead of nesting dialogs.
 */
export function DirectoryBrowserDialog({
  open,
  onOpenChange,
  onSelect,
  title,
  initialPath,
}: DirectoryBrowserDialogProps) {
  const t = useTranslations("DirectoryBrowser")
  const [path, setPath] = useState(initialPath ?? "")
  const [confirming, setConfirming] = useState(false)
  const browserRef = useRef<DirectoryBrowserHandle>(null)

  const commit = useCallback(
    (selected: string) => {
      onSelect(selected)
      onOpenChange(false)
    },
    [onSelect, onOpenChange]
  )

  // `confirming` is mirrored from the panel rather than tracked here: a confirm
  // that outlives its browsing session must leave the flag set, so a stale
  // round trip can never re-enable a newer session's Select button.
  const handleConfirm = useCallback(async () => {
    if (confirming) return
    const selected = await browserRef.current?.confirm()
    if (selected) commit(selected)
  }, [confirming, commit])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title ?? t("title")}</DialogTitle>
        </DialogHeader>

        <DirectoryBrowser
          ref={browserRef}
          active={open}
          initialPath={initialPath}
          value={path}
          onValueChange={setPath}
          onQuickSelect={commit}
          onBusyChange={setConfirming}
        />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!path.trim() || confirming}
            type="button"
          >
            {t("select")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
