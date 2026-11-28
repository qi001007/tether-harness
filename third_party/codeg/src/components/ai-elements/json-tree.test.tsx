import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

/**
 * The last-resort renderer for tool payloads with no dedicated card. Before it,
 * both fallback paths (`ToolOutput` results and `GenericToolInput` nested
 * values) pretty-printed the JSON into a code block — unreadable for exactly
 * the deeply-nested MCP results that lack a card in the first place.
 */

vi.mock("@/components/ai-elements/code-block", () => ({
  CodeBlock: ({ code, language }: { code: string; language?: string }) => (
    <pre data-testid="code-block" data-language={language}>
      {code}
    </pre>
  ),
}))

import { JsonTreeView, countJsonNodes, parseJsonForTree } from "./json-tree"
import enMessages from "@/i18n/messages/en.json"

function renderTree(value: unknown, rawText?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <JsonTreeView value={value} rawText={rawText} />
    </NextIntlClientProvider>
  )
}

describe("parseJsonForTree", () => {
  it("accepts objects and arrays", () => {
    expect(parseJsonForTree('{"a":1}')).toEqual({ a: 1 })
    expect(parseJsonForTree("  [1, 2]")).toEqual([1, 2])
  })

  it("rejects scalars and non-JSON — they read better as themselves", () => {
    expect(parseJsonForTree('"just text"')).toBeUndefined()
    expect(parseJsonForTree("42")).toBeUndefined()
    expect(parseJsonForTree("not json at all")).toBeUndefined()
    expect(parseJsonForTree('{"a":')).toBeUndefined()
  })
})

describe("countJsonNodes", () => {
  it("stops counting once past the cap instead of walking the whole value", () => {
    const wide = { items: Array.from({ length: 5000 }, (_, i) => i) }
    expect(countJsonNodes(wide, 10)).toBeLessThan(20)
    expect(countJsonNodes(wide, 10)).toBeGreaterThan(10)
  })
})

describe("JsonTreeView", () => {
  it("expands a small payload and reveals its leaves", () => {
    renderTree({ status: "completed", agent: { name: "codex", runs: 3 } })

    expect(screen.getByText("completed", { exact: false })).toBeInTheDocument()
    expect(screen.getByText("codex", { exact: false })).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
  })

  it("collapses containers past the auto-expand budget, and opens them on click", () => {
    const value = {
      tasks: Array.from({ length: 80 }, (_, i) => ({
        id: `task-${i}`,
        done: false,
      })),
    }
    renderTree(value)

    // The whole list would blow the row budget, so it starts collapsed…
    expect(screen.queryByText("task-0", { exact: false })).toBeNull()
    fireEvent.click(screen.getByText("80 items", { exact: false }))

    // …one click shows its 80 (still collapsed) entries…
    const entries = screen.getAllByText("2 fields", { exact: false })
    expect(entries).toHaveLength(80)

    // …and opening one reaches the leaf.
    fireEvent.click(entries[0])
    expect(screen.getByText("task-0", { exact: false })).toBeInTheDocument()
  })

  it("truncates a long string until it is clicked", () => {
    const long = "x".repeat(400)
    renderTree({ result: long })

    const preview = screen.getByRole("button", { name: /x{50}/ })
    expect(preview.textContent).not.toBe(long)
    fireEvent.click(preview)
    expect(screen.getByRole("button", { name: long })).toBeInTheDocument()
  })

  it("falls back to the code block for oversized payloads", () => {
    const huge = { rows: Array.from({ length: 3000 }, (_, i) => ({ i })) }
    renderTree(huge)

    expect(screen.getByTestId("code-block")).toHaveAttribute(
      "data-language",
      "json"
    )
  })

  it("toggles between the tree and the original raw text", () => {
    const raw = '{"b":1,"a":2}'
    renderTree(JSON.parse(raw), raw)

    expect(screen.queryByTestId("code-block")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show raw JSON" }))
    // The ORIGINAL text, key order intact — not a re-serialization.
    expect(screen.getByTestId("code-block").textContent).toBe(raw)
    fireEvent.click(screen.getByRole("button", { name: "Show tree" }))
    expect(screen.queryByTestId("code-block")).toBeNull()
  })
})
