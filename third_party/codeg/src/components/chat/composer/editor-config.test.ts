import { Editor, type JSONContent } from "@tiptap/core"
import { describe, expect, it } from "vitest"

import { buildComposerExtensions } from "./editor-config"

/**
 * The composer is plain text: no formatting nodes/marks and no Markdown parser.
 * Typed/pasted markdown syntax stays literal, a filename/URL never becomes a
 * link (the Link mark isn't even in the schema), and only prose + hard breaks +
 * reference badges exist. {@link buildComposerExtensions} disables every
 * StarterKit formatting extension and omits `@tiptap/markdown`.
 */

/** Every mark type name appearing anywhere in the doc. */
function markNames(doc: JSONContent): Set<string> {
  const names = new Set<string>()
  const walk = (node: JSONContent) => {
    node.marks?.forEach((mark) => mark.type && names.add(mark.type))
    node.content?.forEach(walk)
  }
  walk(doc)
  return names
}

/** Every node type name appearing anywhere in the doc. */
function nodeNames(doc: JSONContent): Set<string> {
  const names = new Set<string>()
  const walk = (node: JSONContent) => {
    if (node.type) names.add(node.type)
    node.content?.forEach(walk)
  }
  walk(doc)
  return names
}

function makeEditor(): Editor {
  return new Editor({ extensions: buildComposerExtensions() })
}

describe("plain-text composer schema", () => {
  it("registers no formatting nodes/marks and no Markdown extension", () => {
    const editor = makeEditor()
    const names = editor.extensionManager.extensions.map((e) => e.name)
    for (const gone of [
      "link",
      "bold",
      "italic",
      "strike",
      "code",
      "codeBlock",
      "heading",
      "blockquote",
      "bulletList",
      "orderedList",
      "listItem",
      "horizontalRule",
      "underline",
      "markdown",
    ]) {
      expect(names).not.toContain(gone)
    }
    // The building blocks it DOES keep.
    for (const kept of ["doc", "paragraph", "text", "hardBreak", "reference"]) {
      expect(names).toContain(kept)
    }
    // No Markdown manager — getMarkdown()/serialize()/parse() are gone. (The
    // `@tiptap/markdown` type augmentation isn't even imported here, so reach the
    // runtime property through a cast.)
    expect(
      (editor as unknown as { markdown?: unknown }).markdown
    ).toBeUndefined()
    editor.destroy()
  })

  it("keeps a filename / path / URL as plain text (there is no link mark)", () => {
    const editor = makeEditor()
    editor.commands.insertContent({
      type: "text",
      text: "see lib.rs and https://example.com and /a/b.rs",
    })
    expect(markNames(editor.getJSON()).has("link")).toBe(false)
    editor.destroy()
  })

  it("does not turn typed markdown syntax into formatting", () => {
    const editor = makeEditor()
    editor.commands.insertContent({
      type: "text",
      text: "# H **b** - item `c`",
    })
    const json = editor.getJSON()
    expect(nodeNames(json).has("heading")).toBe(false)
    expect(nodeNames(json).has("bulletList")).toBe(false)
    expect(nodeNames(json).has("codeBlock")).toBe(false)
    // No marks of any kind were applied.
    expect(markNames(json).size).toBe(0)
    editor.destroy()
  })

  it("does not linkify a pasted filename token", () => {
    const editor = makeEditor()
    editor.commands.insertContent("lib.rs ", { applyPasteRules: true })
    expect(markNames(editor.getJSON()).has("link")).toBe(false)
    editor.destroy()
  })
})
