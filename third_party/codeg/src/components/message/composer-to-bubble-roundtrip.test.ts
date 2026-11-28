import { Editor } from "@tiptap/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { buildComposerExtensions } from "@/components/chat/composer/editor-config"
import { docToPromptBlocks } from "@/components/chat/composer/to-prompt-blocks"
import type { ReferenceAttrs } from "@/components/chat/composer/types"

import { parseUserMessageSegments } from "./user-message-segments"

/**
 * End-to-end contract for the plain-text feature: what a user builds in the
 * composer (prose + reference badges, NO Markdown) must render identically in
 * the transcript bubble. Serialize a composer document to the wire text, then
 * parse it back with the bubble renderer — references become badges, everything
 * else stays literal.
 */
function ref(
  partial: Partial<ReferenceAttrs> & { refType: ReferenceAttrs["refType"] }
): ReferenceAttrs {
  return { id: "", label: "", uri: null, meta: null, ...partial }
}

/** Serialize the editor doc the way `buildDraft` does, then render it. */
function composerToBubble(editor: Editor) {
  const blocks = docToPromptBlocks(editor)
  const text = blocks[0]?.type === "text" ? blocks[0].text : ""
  return parseUserMessageSegments(text)
}

describe("composer → bubble round-trip", () => {
  let editor: Editor

  beforeEach(() => {
    editor = new Editor({ extensions: buildComposerExtensions() })
  })
  afterEach(() => editor?.destroy())

  it("renders every reference kind as a badge, in place", () => {
    editor
      .chain()
      .insertContent("look at ")
      .insertReference(
        ref({
          refType: "file",
          id: "app.ts",
          label: "app.ts",
          uri: "file:///repo/app.ts",
          meta: { fileKind: "file" },
        })
      )
      .insertContent(" ask ")
      .insertReference(
        ref({
          refType: "agent",
          id: "codex",
          label: "Codex",
          uri: "codeg://agent/codex",
        })
      )
      .insertContent(" run ")
      .insertReference(
        ref({
          refType: "skill",
          id: "code-review",
          label: "Code review",
          meta: { invocationPrefix: "/" },
        })
      )
      .run()

    const segments = composerToBubble(editor)
    const kinds = segments
      .filter((s) => s.kind === "reference")
      .map((s) => (s as { attrs: ReferenceAttrs }).attrs.refType)
    expect(kinds).toEqual(["file", "agent", "skill"])
    // The surrounding prose survives as literal text between the badges.
    const text = segments
      .filter((s) => s.kind === "text")
      .map((s) => (s as { text: string }).text)
      .join("")
    expect(text).toContain("look at")
    expect(text).toContain("ask")
    expect(text).toContain("run")
  })

  it("keeps typed Markdown syntax literal end-to-end (no formatting)", () => {
    editor.commands.insertContent({
      type: "text",
      text: "# Heading **bold** - item `code`",
    })
    const segments = composerToBubble(editor)
    // One literal text segment — no reference badges, syntax preserved verbatim.
    expect(segments).toEqual([
      { kind: "text", text: "# Heading **bold** - item `code`" },
    ])
  })

  it("drops an embedded-attachment badge from the rendered prose", () => {
    editor
      .chain()
      .insertContent("see ")
      .insertReference(
        ref({
          refType: "file",
          id: "report.pdf",
          label: "report.pdf",
          uri: "codeg://embedded/abc-123",
        })
      )
      .insertContent(" please")
      .run()
    const segments = composerToBubble(editor)
    expect(segments.every((s) => s.kind === "text")).toBe(true)
    const text = segments.map((s) => (s as { text: string }).text).join("")
    expect(text).not.toContain("report.pdf")
    expect(text).toContain("see")
    expect(text).toContain("please")
  })
})
