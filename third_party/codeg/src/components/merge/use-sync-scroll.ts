import { useCallback, useRef } from "react"
import type { editor as MonacoEditorNs } from "monaco-editor"

type EditorInstance = MonacoEditorNs.IStandaloneCodeEditor

/**
 * Hook to synchronize scrolling between multiple Monaco editors.
 * Uses a flag to prevent infinite scroll loops.
 */
export function useSyncScroll() {
  const isSyncing = useRef(false)
  const editorsRef = useRef<EditorInstance[]>([])

  const registerEditor = useCallback(
    (editor: EditorInstance, index: number) => {
      editorsRef.current[index] = editor

      editor.onDidScrollChange(() => {
        if (isSyncing.current) return
        isSyncing.current = true

        const scrollTop = editor.getScrollTop()
        const scrollLeft = editor.getScrollLeft()

        for (let i = 0; i < editorsRef.current.length; i++) {
          if (i !== index && editorsRef.current[i]) {
            editorsRef.current[i].setScrollPosition({
              scrollTop,
              scrollLeft,
            })
          }
        }

        // Use rAF to release the sync flag after all scroll events settle
        requestAnimationFrame(() => {
          isSyncing.current = false
        })
      })
    },
    []
  )

  return { registerEditor }
}
