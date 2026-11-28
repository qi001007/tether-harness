"use client"

import { useCallback, useEffect, useRef, useState } from "react"

interface Disposable {
  dispose: () => void
}

export interface ImeCompositionEditor {
  onDidCompositionStart: (listener: () => void) => Disposable
  onDidCompositionEnd: (listener: () => void) => Disposable
  onDidChangeModel: (listener: () => void) => Disposable
  onDidDispose: (listener: () => void) => Disposable
}

interface ImeSafeEditorValue<T> {
  value: T | undefined
  isComposing: boolean
  bindEditor: (editor: ImeCompositionEditor | null) => void
}

/**
 * Prevents a controlled Monaco value from replacing the model while an IME
 * composition is active. The wrapper treats `undefined` as uncontrolled, so
 * intermediate composition text remains owned by Monaco until the next frame
 * after composition ends.
 */
export function useImeSafeEditorValue<T>(
  value: T,
  modelKey: string,
  onCompositionChange?: (composing: boolean, modelKey: string) => void
): ImeSafeEditorValue<T> {
  const modelKeyRef = useRef(modelKey)
  const [composingModelKey, setComposingModelKey] = useState<string | null>(
    null
  )
  const composingModelKeyRef = useRef<string | null>(null)
  const resumeFrameRef = useRef<number | null>(null)
  const unbindRef = useRef<(() => void) | null>(null)
  const mountedRef = useRef(true)
  // Keep the latest callback in a ref so editor listeners bound once at mount
  // never call a stale closure — the hook must not require callers to memoize
  // `onCompositionChange`.
  const onCompositionChangeRef = useRef(onCompositionChange)

  const cancelResume = useCallback(() => {
    if (resumeFrameRef.current === null) return
    cancelAnimationFrame(resumeFrameRef.current)
    resumeFrameRef.current = null
  }, [])

  const finishComposition = useCallback((expectedModelKey?: string) => {
    const current = composingModelKeyRef.current
    if (!current || (expectedModelKey && current !== expectedModelKey)) return
    composingModelKeyRef.current = null
    if (mountedRef.current) setComposingModelKey(null)
    onCompositionChangeRef.current?.(false, current)
  }, [])

  const bindEditor = useCallback(
    (editor: ImeCompositionEditor | null) => {
      unbindRef.current?.()
      unbindRef.current = null
      cancelResume()
      if (mountedRef.current) setComposingModelKey(null)
      if (!editor) return

      let released = false
      let startDisposable: Disposable | null = null
      let endDisposable: Disposable | null = null
      let modelDisposable: Disposable | null = null
      let editorDisposable: Disposable | null = null
      let unbind: (() => void) | null = null

      const release = (resetState: boolean) => {
        if (released) return
        released = true
        startDisposable?.dispose()
        endDisposable?.dispose()
        modelDisposable?.dispose()
        editorDisposable?.dispose()
        cancelResume()
        if (unbindRef.current === unbind) unbindRef.current = null
        if (resetState) finishComposition()
      }

      startDisposable = editor.onDidCompositionStart(() => {
        cancelResume()
        const startingModelKey = modelKeyRef.current
        composingModelKeyRef.current = startingModelKey
        setComposingModelKey(startingModelKey)
        onCompositionChangeRef.current?.(true, startingModelKey)
      })
      endDisposable = editor.onDidCompositionEnd(() => {
        cancelResume()
        const endingModelKey = modelKeyRef.current
        resumeFrameRef.current = requestAnimationFrame(() => {
          resumeFrameRef.current = null
          if (mountedRef.current && modelKeyRef.current === endingModelKey) {
            finishComposition(endingModelKey)
          }
        })
      })
      modelDisposable = editor.onDidChangeModel(() => {
        cancelResume()
        finishComposition()
      })
      editorDisposable = editor.onDidDispose(() => release(true))
      unbind = () => release(true)
      unbindRef.current = unbind
    },
    [cancelResume, finishComposition]
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const unbind = unbindRef.current
      unbindRef.current = null
      unbind?.()
      cancelResume()
    }
  }, [cancelResume])

  useEffect(() => {
    modelKeyRef.current = modelKey
    cancelResume()
  }, [cancelResume, modelKey])

  useEffect(() => {
    onCompositionChangeRef.current = onCompositionChange
  }, [onCompositionChange])

  return {
    value: composingModelKey === modelKey ? undefined : value,
    isComposing: composingModelKey === modelKey,
    bindEditor,
  }
}
