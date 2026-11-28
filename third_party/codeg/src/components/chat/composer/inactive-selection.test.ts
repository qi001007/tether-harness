import { Editor } from "@tiptap/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { buildComposerExtensions } from "./editor-config"
import {
  INACTIVE_SELECTION_CLASS,
  inactiveSelectionDecorations,
  inactiveSelectionKey,
} from "./inactive-selection"

describe("InactiveSelectionHighlight", () => {
  let editor: Editor

  beforeEach(() => {
    editor = new Editor({ extensions: buildComposerExtensions() })
    // A single paragraph: text "hello" occupies positions 1..6.
    editor.commands.setContent("hello world")
  })

  afterEach(() => {
    editor?.destroy()
  })

  it("decorates the selected range when the editor is blurred", () => {
    editor.commands.setTextSelection({ from: 1, to: 6 })
    const set = inactiveSelectionDecorations(editor.state, false)
    expect(set).not.toBeNull()
    const decos = set!.find()
    expect(decos).toHaveLength(1)
    expect(decos[0].from).toBe(1)
    expect(decos[0].to).toBe(6)
  })

  it("paints nothing while the editor is focused (native selection shows)", () => {
    editor.commands.setTextSelection({ from: 1, to: 6 })
    expect(inactiveSelectionDecorations(editor.state, true)).toBeNull()
  })

  it("paints nothing for a collapsed (empty) selection", () => {
    editor.commands.setTextSelection({ from: 3, to: 3 })
    expect(inactiveSelectionDecorations(editor.state, false)).toBeNull()
  })

  it("registers the focus-tracking plugin in the composer extension set", () => {
    // getState returns the boolean init value only when the plugin is actually
    // installed (undefined otherwise), so this asserts the extension is wired in.
    expect(inactiveSelectionKey.getState(editor.state)).toBe(false)
  })

  it("exposes a stable decoration class shared with the CSS", () => {
    expect(INACTIVE_SELECTION_CLASS).toBe("codeg-inactive-selection")
  })
})
