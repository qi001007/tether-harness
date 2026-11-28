"use client"

import { FolderOpen } from "lucide-react"
import { useTranslations } from "next-intl"

export function AuxPanelNoFolderEmpty() {
  const t = useTranslations("Folder.auxPanel")
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
      <FolderOpen className="size-5 text-muted-foreground/60" aria-hidden />
      <p className="text-sm font-medium">{t("noFolderTitle")}</p>
      <p className="text-xs text-muted-foreground">{t("noFolderHint")}</p>
    </div>
  )
}
