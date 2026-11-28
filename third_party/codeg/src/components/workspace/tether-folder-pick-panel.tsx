"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { FolderOpen, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { requestTetherPick } from "@/lib/tether-folder-pick"

/**
 * Folder picker used wherever Codeg would otherwise draw its own directory
 * browser while Tether is hosting the window: the folder is chosen in Tether's
 * own resource manager (asked over the host bridge, which shows it over this
 * window), so every pick looks and behaves like the pickers in Tether itself.
 *
 * The panel opens the picker by itself the first time it is shown — that is
 * what "open folder" means from the menus — and stays re-openable afterwards.
 * With `multiple` the host answers with everything ticked in one round, and
 * `onPicked` receives the whole list; otherwise `onChange` gets the folder.
 */
export function TetherFolderPickPanel({
  value,
  onChange,
  disabled = false,
  multiple = false,
  onPicked,
  title = "在 Tether 资源管理器中选择文件夹",
  hint = "尚未选择文件夹",
}: {
  value: string
  onChange: (path: string) => void
  disabled?: boolean
  /** Ask the host for several folders in one pick. */
  multiple?: boolean
  /** Receives every picked folder; takes precedence over `onChange`. */
  onPicked?: (paths: string[]) => void
  title?: string
  /** What the path line says before anything is picked. */
  hint?: string
}) {
  const [picking, setPicking] = useState(false)
  const autoStarted = useRef(false)

  const pick = useCallback(async () => {
    setPicking(true)
    try {
      const paths = await requestTetherPick({ kind: "folder", multiple })
      if (!paths || paths.length === 0) return
      if (onPicked) onPicked(paths)
      else if (paths[0]) onChange(paths[0])
    } finally {
      setPicking(false)
    }
  }, [multiple, onChange, onPicked])

  useEffect(() => {
    if (autoStarted.current) return
    autoStarted.current = true
    void pick()
  }, [pick])

  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-muted/20 px-6 py-8 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-background shadow-[0_1px_3px_rgba(9,30,66,.08)] ring-1 ring-black/[.05]">
        <FolderOpen className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <div className="text-sm font-medium">{title}</div>
      <div className="max-w-full break-all font-mono text-xs text-muted-foreground">
        {value || hint}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void pick()}
        disabled={disabled || picking}
      >
        {picking ? <Loader2 className="size-4 animate-spin" /> : null}
        {value ? "重新选择" : "选择文件夹"}
      </Button>
    </div>
  )
}