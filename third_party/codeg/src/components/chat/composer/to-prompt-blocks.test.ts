import { Editor } from "@tiptap/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { PromptInputBlock } from "@/lib/types"

import { buildComposerExtensions } from "./editor-config"
import {
  docToPromptBlocks,
  serializeDocToDisplayText,
  serializeDocToText,
} from "./to-prompt-blocks"
import type { ReferenceAttrs } from "./types"

function ref(
  partial: Partial<ReferenceAttrs> & { refType: ReferenceAttrs["refType"] }
): ReferenceAttrs {
  return { id: "", label: "", uri: null, meta: null, ...partial }
}

/** Find the single text block (asserts exactly one exists). */
function textBlock(blocks: PromptInputBlock[]): string {
  const texts = blocks.filter((b) => b.type === "text")
  expect(texts).toHaveLength(1)
  return (texts[0] as Extract<PromptInputBlock, { type: "text" }>).text
}

function links(
  blocks: PromptInputBlock[]
): Extract<PromptInputBlock, { type: "resource_link" }>[] {
  return blocks.filter(
    (b): b is Extract<PromptInputBlock, { type: "resource_link" }> =>
      b.type === "resource_link"
  )
}

describe("docToPromptBlocks", () => {
  let editor: Editor

  beforeEach(() => {
    editor = new Editor({ extensions: buildComposerExtensions() })
  })

  afterEach(() => {
    editor?.destroy()
  })

  it("serializes plain prose to a single text block, markdown kept literal", () => {
    editor.commands.insertContent({
      type: "text",
      text: "hello **world** # not a heading",
    })
    const blocks = docToPromptBlocks(editor)
    expect(blocks).toHaveLength(1)
    // No Markdown parsing: the syntax is preserved verbatim on the wire.
    expect(textBlock(blocks)).toBe("hello **world** # not a heading")
  })

  it("returns no blocks for an empty document", () => {
    expect(docToPromptBlocks(editor)).toEqual([])
  })

  it("keeps an agent reference inline as text (no resource_link)", () => {
    editor
      .chain()
      .insertContent("ask ")
      .insertReference(ref({ refType: "agent", id: "codex", label: "Codex" }))
      .run()
    const blocks = docToPromptBlocks(editor)
    expect(links(blocks)).toHaveLength(0)
    expect(textBlock(blocks)).toContain("@Codex")
  })

  it("keeps an agent reference with a codeg uri inline as a markdown link", () => {
    editor
      .chain()
      .insertContent("ask ")
      .insertReference(
        ref({
          refType: "agent",
          id: "codex",
          label: "Codex",
          uri: "codeg://agent/codex",
        })
      )
      .run()
    const blocks = docToPromptBlocks(editor)
    expect(links(blocks)).toHaveLength(0)
    expect(textBlock(blocks)).toContain("[@Codex](codeg://agent/codex)")
  })

  it("keeps a skill reference inline as the /id token", () => {
    editor.commands.insertReference(
      ref({ refType: "skill", id: "code-review", label: "Code Review" })
    )
    const blocks = docToPromptBlocks(editor)
    expect(links(blocks)).toHaveLength(0)
    expect(textBlock(blocks)).toContain("/code-review")
  })

  it("keeps a session reference inline as a codeg:// link (no resource_link)", () => {
    editor
      .chain()
      .insertContent("see ")
      .insertReference(
        ref({
          refType: "session",
          id: "1",
          label: "Login refactor",
          uri: "codeg://session/1",
        })
      )
      .run()
    const blocks = docToPromptBlocks(editor)
    expect(links(blocks)).toHaveLength(0)
    expect(textBlock(blocks)).toContain("codeg://session/1")
  })

  it("keeps a commit reference inline as a codeg:// link (no resource_link)", () => {
    editor.commands.insertReference(
      ref({
        refType: "commit",
        id: "abc1234def",
        label: "abc1234",
        uri: "codeg://commit/%2Frepo@abc1234def",
      })
    )
    const blocks = docToPromptBlocks(editor)
    expect(links(blocks)).toHaveLength(0)
    expect(textBlock(blocks)).toContain("codeg://commit/")
  })

  it("does not lift a file-typed reference carrying a non-file (codeg) uri", () => {
    // A pasted/forged node could be refType "file" with a codeg: uri (the node's
    // parseHTML allow-list permits codeg:). It must stay inline, never become an
    // ACP resource_link with a non-fetchable uri.
    editor.commands.insertReference(
      ref({
        refType: "file",
        id: "x",
        label: "x",
        uri: "codeg://session/9",
      })
    )
    const blocks = docToPromptBlocks(editor)
    expect(links(blocks)).toHaveLength(0)
    expect(textBlock(blocks)).toContain("codeg://session/9")
  })

  it("drops an embedded-attachment reference from the prose without lifting it", () => {
    // A path-less pasted attachment badge carries an inert codeg://embedded uri;
    // its bytes are appended separately by the host, so it must neither survive
    // in the prose nor become a resource_link with the synthetic uri.
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
    const blocks = docToPromptBlocks(editor)
    const text = textBlock(blocks)
    expect(text).toContain("see")
    expect(text).toContain("please")
    expect(text).not.toContain("codeg://embedded")
    expect(text).not.toContain("report.pdf")
    expect(links(blocks)).toHaveLength(0)
  })

  it("keeps a file reference inline as a markdown link (no resource_link)", () => {
    editor
      .chain()
      .insertContent("see ")
      .insertReference(
        ref({
          refType: "file",
          id: "src/app.ts",
          label: "app.ts",
          uri: "file:///repo/src/app.ts",
        })
      )
      .insertContent(" please")
      .run()
    const blocks = docToPromptBlocks(editor)
    const text = textBlock(blocks)
    expect(text).toContain("see")
    expect(text).toContain("please")
    // The file stays inline, at the typed position, as a markdown link — never
    // lifted to a trailing resource_link (which would land at the end of the
    // message on cold reload).
    expect(text).toContain("[app.ts](file:///repo/src/app.ts)")
    expect(links(blocks)).toHaveLength(0)
  })

  it("emits a file-only document as a single inline-link text block", () => {
    editor.commands.insertReference(
      ref({
        refType: "file",
        id: "a.ts",
        label: "a.ts",
        uri: "file:///repo/a.ts",
      })
    )
    const blocks = docToPromptBlocks(editor)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: "text",
      text: "[a.ts](file:///repo/a.ts)",
    })
    expect(links(blocks)).toHaveLength(0)
  })

  it("keeps multiple file references inline in document order", () => {
    editor
      .chain()
      .insertContent("a ")
      .insertReference(
        ref({
          refType: "file",
          id: "1",
          label: "one.ts",
          uri: "file:///one.ts",
        })
      )
      .insertContent(" b ")
      .insertReference(
        ref({
          refType: "file",
          id: "2",
          label: "two.ts",
          uri: "file:///two.ts",
        })
      )
      .run()
    const blocks = docToPromptBlocks(editor)
    const text = textBlock(blocks)
    expect(links(blocks)).toHaveLength(0)
    expect(text).toContain("[one.ts](file:///one.ts)")
    expect(text).toContain("[two.ts](file:///two.ts)")
    expect(text.indexOf("one.ts")).toBeLessThan(text.indexOf("two.ts"))
  })

  it("inlines a no-label file reference as a link carrying its uri", () => {
    // The composer always labels a file with its basename; even without a label
    // the reference still serializes inline as a link (its uri is the
    // destination), never as a resource_link.
    editor.commands.insertReference(
      ref({
        refType: "file",
        id: "",
        label: "",
        uri: "file:///repo/deep/name.ts",
      })
    )
    const blocks = docToPromptBlocks(editor)
    expect(links(blocks)).toHaveLength(0)
    expect(textBlock(blocks)).toContain("(file:///repo/deep/name.ts)")
  })

  it("keeps prose alongside an inline file reference", () => {
    editor
      .chain()
      .insertContent("look at this ")
      .insertReference(
        ref({ refType: "file", id: "x", label: "x.ts", uri: "file:///x.ts" })
      )
      .run()
    const blocks = docToPromptBlocks(editor)
    const text = textBlock(blocks)
    expect(text).toContain("look at this")
    expect(text).toContain("[x.ts](file:///x.ts)")
    expect(links(blocks)).toHaveLength(0)
  })
})

describe("serializeDocToDisplayText vs serializeDocToText (embedded)", () => {
  let editor: Editor

  beforeEach(() => {
    editor = new Editor({ extensions: buildComposerExtensions() })
  })
  afterEach(() => editor?.destroy())

  it("display KEEPS an embedded badge inline; send DROPS it", () => {
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
    // Send text: the synthetic embedded uri never surfaces (bytes go separately).
    const sent = serializeDocToText(editor.state.doc)
    expect(sent).not.toContain("codeg://embedded")
    expect(sent).not.toContain("report.pdf")
    // Display text: the sender still sees the file they attached, as the same
    // `[label](codeg://embedded/…)` link the transcript renders back to a badge —
    // so the queue chip / optimistic bubble isn't blank ("Attached 0 attachment").
    const shown = serializeDocToDisplayText(editor.state.doc)
    expect(shown).toContain("[report.pdf](codeg://embedded/abc-123)")
    expect(shown).toContain("see")
    expect(shown).toContain("please")
  })

  it("an embedded-only document is empty on send but non-empty for display", () => {
    editor.commands.insertReference(
      ref({
        refType: "file",
        id: "report.pdf",
        label: "report.pdf",
        uri: "codeg://embedded/only-1",
      })
    )
    expect(serializeDocToText(editor.state.doc).trim()).toBe("")
    expect(serializeDocToDisplayText(editor.state.doc).trim()).toBe(
      "[report.pdf](codeg://embedded/only-1)"
    )
  })

  it("is byte-identical to the send form for content with no embedded refs", () => {
    editor
      .chain()
      .insertContent("look at ")
      .insertReference(
        ref({ refType: "file", id: "x", label: "x.ts", uri: "file:///x.ts" })
      )
      .insertContent(" and ")
      .insertReference(ref({ refType: "skill", id: "review", label: "Review" }))
      .run()
    expect(serializeDocToDisplayText(editor.state.doc)).toBe(
      serializeDocToText(editor.state.doc)
    )
  })
})
