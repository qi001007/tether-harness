import { fireEvent, render, screen } from "@testing-library/react"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { FileMentionMenu } from "./file-mention-menu"
import type { FlatFileEntry } from "@/hooks/use-file-tree"

beforeAll(() => {
  // FileMentionMenu calls scrollIntoView in a useEffect when selectedIndex
  // changes. jsdom doesn't implement it; polyfill once so render doesn't
  // throw.
  Element.prototype.scrollIntoView = vi.fn()
})

function file(name: string): FlatFileEntry {
  return {
    name,
    relativePath: name,
    kind: "file",
    lowerPath: name.toLowerCase(),
    lowerName: name.toLowerCase(),
  }
}

function dir(name: string): FlatFileEntry {
  return {
    name,
    relativePath: name,
    kind: "dir",
    lowerPath: name.toLowerCase(),
    lowerName: name.toLowerCase(),
  }
}

describe("FileMentionMenu", () => {
  it("renders nothing when files list is empty", () => {
    const { container } = render(
      <FileMentionMenu files={[]} selectedIndex={0} onSelect={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders every entry with its relative path", () => {
    render(
      <FileMentionMenu
        files={[file("src/lib/api.ts"), file("README.md"), dir("docs")]}
        selectedIndex={0}
        onSelect={() => {}}
      />
    )
    expect(screen.getByText("src/lib/api.ts")).toBeInTheDocument()
    expect(screen.getByText("README.md")).toBeInTheDocument()
    expect(screen.getByText("docs")).toBeInTheDocument()
  })

  it("applies the accent style only to the selectedIndex row", () => {
    render(
      <FileMentionMenu
        files={[file("a.ts"), file("b.ts"), file("c.ts")]}
        selectedIndex={1}
        onSelect={() => {}}
      />
    )
    const buttons = screen.getAllByRole("button")
    expect(buttons[0].className).not.toContain("bg-accent")
    expect(buttons[1].className).toContain("bg-accent")
    expect(buttons[2].className).not.toContain("bg-accent")
  })

  it("invokes onSelect with the entry on mousedown", () => {
    const onSelect = vi.fn()
    const entries = [file("a.ts"), file("b.ts")]
    render(
      <FileMentionMenu files={entries} selectedIndex={0} onSelect={onSelect} />
    )
    fireEvent.mouseDown(screen.getByText("b.ts"))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(entries[1])
  })

  it("preventDefaults the mousedown so the chat input keeps focus", () => {
    render(
      <FileMentionMenu
        files={[file("a.ts")]}
        selectedIndex={0}
        onSelect={() => {}}
      />
    )
    const target = screen.getByText("a.ts")
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    })
    const defaultPrevented = !target.dispatchEvent(event)
    expect(defaultPrevented).toBe(true)
  })
})
