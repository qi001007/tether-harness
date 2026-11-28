import { StrictMode, type ReactNode } from "react"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useImeSafeEditorValue } from "@/hooks/use-ime-safe-editor-value"

type Listener = () => void

class FakeCompositionEditor {
  private startListeners = new Set<Listener>()
  private endListeners = new Set<Listener>()
  private modelListeners = new Set<Listener>()
  private disposeListeners = new Set<Listener>()

  onDidCompositionStart(listener: Listener) {
    this.startListeners.add(listener)
    return { dispose: () => this.startListeners.delete(listener) }
  }

  onDidCompositionEnd(listener: Listener) {
    this.endListeners.add(listener)
    return { dispose: () => this.endListeners.delete(listener) }
  }

  onDidChangeModel(listener: Listener) {
    this.modelListeners.add(listener)
    return { dispose: () => this.modelListeners.delete(listener) }
  }

  onDidDispose(listener: Listener) {
    this.disposeListeners.add(listener)
    return { dispose: () => this.disposeListeners.delete(listener) }
  }

  startComposition() {
    this.startListeners.forEach((listener) => listener())
  }

  endComposition() {
    this.endListeners.forEach((listener) => listener())
  }

  changeModel() {
    this.modelListeners.forEach((listener) => listener())
  }

  dispose() {
    this.disposeListeners.forEach((listener) => listener())
    this.disposeListeners.clear()
  }
}

let nextFrameId = 1
let frameCallbacks = new Map<number, FrameRequestCallback>()

function flushAnimationFrames() {
  const pending = [...frameCallbacks.values()]
  frameCallbacks.clear()
  pending.forEach((callback) => callback(0))
}

beforeEach(() => {
  nextFrameId = 1
  frameCallbacks = new Map()
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrameId++
    frameCallbacks.set(id, callback)
    return id
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frameCallbacks.delete(id)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useImeSafeEditorValue", () => {
  it("reports composition active until the controlled value can safely resume", () => {
    const editor = new FakeCompositionEditor()
    const onCompositionChange = vi.fn()
    const { result } = renderHook(() =>
      useImeSafeEditorValue("content", "file:///notes.md", onCompositionChange)
    )
    act(() => result.current.bindEditor(editor))

    act(() => editor.startComposition())
    expect(onCompositionChange).toHaveBeenLastCalledWith(
      true,
      "file:///notes.md"
    )
    expect(result.current.isComposing).toBe(true)

    act(() => editor.endComposition())
    expect(onCompositionChange).toHaveBeenCalledTimes(1)
    act(flushAnimationFrames)
    expect(onCompositionChange).toHaveBeenLastCalledWith(
      false,
      "file:///notes.md"
    )
    expect(result.current.isComposing).toBe(false)
  })

  it("withholds the controlled value throughout composition and restores the latest value next frame", () => {
    const editor = new FakeCompositionEditor()
    const { result, rerender } = renderHook(
      ({ value, modelKey }) => useImeSafeEditorValue(value, modelKey),
      { initialProps: { value: "before", modelKey: "file:///notes.md" } }
    )

    act(() => result.current.bindEditor(editor))
    expect(result.current.value).toBe("before")

    act(() => editor.startComposition())
    expect(result.current.value).toBeUndefined()

    rerender({ value: "beforemo", modelKey: "file:///notes.md" })
    rerender({ value: "before魔魂", modelKey: "file:///notes.md" })
    expect(result.current.value).toBeUndefined()

    act(() => editor.endComposition())
    expect(result.current.value).toBeUndefined()

    act(flushAnimationFrames)
    expect(result.current.value).toBe("before魔魂")
  })

  it("keeps ordinary input controlled when no composition is active", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useImeSafeEditorValue(value, "file:///notes.md"),
      { initialProps: { value: "a" } }
    )

    rerender({ value: "ab" })
    expect(result.current.value).toBe("ab")
  })

  it("cancels a pending resume when a new composition starts", () => {
    const editor = new FakeCompositionEditor()
    const { result } = renderHook(() =>
      useImeSafeEditorValue("content", "file:///notes.md")
    )
    act(() => result.current.bindEditor(editor))

    act(() => editor.startComposition())
    act(() => editor.endComposition())
    expect(frameCallbacks).toHaveLength(1)

    act(() => editor.startComposition())
    expect(frameCallbacks).toHaveLength(0)
    act(flushAnimationFrames)
    expect(result.current.value).toBeUndefined()
  })

  it("resets the guard and cancels resume work when the model changes", () => {
    const editor = new FakeCompositionEditor()
    const { result, rerender } = renderHook(
      ({ value, modelKey }) => useImeSafeEditorValue(value, modelKey),
      { initialProps: { value: "a", modelKey: "file:///a.md" } }
    )
    act(() => result.current.bindEditor(editor))

    act(() => editor.startComposition())
    act(() => editor.endComposition())
    expect(frameCallbacks).toHaveLength(1)

    rerender({ value: "b", modelKey: "file:///b.md" })
    act(() => editor.changeModel())
    expect(frameCallbacks).toHaveLength(0)
    expect(result.current.value).toBe("b")

    rerender({ value: "a", modelKey: "file:///a.md" })
    expect(result.current.value).toBe("a")
  })

  it("disposes listeners and pending resume work with the editor", () => {
    const editor = new FakeCompositionEditor()
    const { result } = renderHook(() =>
      useImeSafeEditorValue("content", "file:///notes.md")
    )
    act(() => result.current.bindEditor(editor))

    act(() => editor.startComposition())
    act(() => editor.endComposition())
    expect(frameCallbacks).toHaveLength(1)

    act(() => editor.dispose())
    expect(frameCallbacks).toHaveLength(0)
    expect(result.current.value).toBe("content")

    act(() => editor.startComposition())
    expect(result.current.value).toBe("content")
  })

  it("cancels pending resume work when the hook unmounts", () => {
    const editor = new FakeCompositionEditor()
    const onCompositionChange = vi.fn()
    const { result, unmount } = renderHook(() =>
      useImeSafeEditorValue("content", "file:///notes.md", onCompositionChange)
    )
    act(() => result.current.bindEditor(editor))
    act(() => editor.startComposition())
    act(() => editor.endComposition())
    expect(frameCallbacks).toHaveLength(1)

    unmount()
    expect(frameCallbacks).toHaveLength(0)
    expect(onCompositionChange).toHaveBeenLastCalledWith(
      false,
      "file:///notes.md"
    )
  })

  it("remains active after the Strict Mode effect replay", () => {
    const editor = new FakeCompositionEditor()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    )
    const { result } = renderHook(
      () => useImeSafeEditorValue("content", "file:///notes.md"),
      { wrapper }
    )
    act(() => result.current.bindEditor(editor))

    act(() => editor.startComposition())
    expect(result.current.value).toBeUndefined()
  })
})
