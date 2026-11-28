import { describe, expect, it } from "vitest"

import { parseSearchOutput } from "./search-output"

describe("parseSearchOutput — matches mode", () => {
  it("groups `path:line:content` lines per file", () => {
    const parsed = parseSearchOutput(
      [
        "src/a.ts:12:  const x = 1",
        "src/a.ts:40:  const y = 2",
        "src/b.ts:7:export {}",
      ].join("\n")
    )

    expect(parsed).not.toBeNull()
    expect(parsed!.mode).toBe("matches")
    expect(parsed!.matchCount).toBe(3)
    expect(parsed!.fileCount).toBe(2)
    expect(parsed!.groups).toEqual([
      {
        path: "src/a.ts",
        lines: [
          { line: 12, text: "  const x = 1" },
          { line: 40, text: "  const y = 2" },
        ],
      },
      { path: "src/b.ts", lines: [{ line: 7, text: "export {}" }] },
    ])
  })

  it("merges non-adjacent hits for the same file and skips rg separators", () => {
    const parsed = parseSearchOutput(
      ["a.ts:1:x", "--", "b.ts:2:y", "", "a.ts:9:z"].join("\n")
    )

    expect(parsed!.fileCount).toBe(2)
    expect(parsed!.matchCount).toBe(3)
    expect(parsed!.groups[0].lines.map((l) => l.line)).toEqual([1, 9])
  })

  it("keeps colons inside the matched content", () => {
    const parsed = parseSearchOutput("Foo.java:42:  Tests run: 5, Failures: 0")
    expect(parsed!.groups[0].lines[0]).toEqual({
      line: 42,
      text: "  Tests run: 5, Failures: 0",
    })
  })

  it("parses a Windows path with a drive letter", () => {
    const parsed = parseSearchOutput("C:\\repo\\src\\a.ts:3:hit")
    expect(parsed!.groups[0].path).toBe("C:\\repo\\src\\a.ts")
    expect(parsed!.groups[0].lines[0].line).toBe(3)
  })

  it("collects unparsed lines as notes when they stay below the threshold", () => {
    const parsed = parseSearchOutput(
      [
        "a.ts:1:x",
        "b.ts:2:y",
        "c.ts:3:z",
        "d.ts:4:w",
        "rg: e.ts: No such file or directory",
      ].join("\n")
    )

    expect(parsed!.mode).toBe("matches")
    expect(parsed!.matchCount).toBe(4)
    expect(parsed!.notes).toEqual(["rg: e.ts: No such file or directory"])
  })
})

describe("parseSearchOutput — files mode", () => {
  it("recognises a bare path list", () => {
    const parsed = parseSearchOutput(
      ["src/a.ts", "src/nested/b.tsx", "README.md"].join("\n")
    )

    expect(parsed!.mode).toBe("files")
    expect(parsed!.fileCount).toBe(3)
    expect(parsed!.matchCount).toBe(0)
    expect(parsed!.groups.map((g) => g.path)).toEqual([
      "src/a.ts",
      "src/nested/b.tsx",
      "README.md",
    ])
    expect(parsed!.groups.every((g) => g.lines.length === 0)).toBe(true)
  })

  it("recognises bare `ls` names with an extension", () => {
    const parsed = parseSearchOutput(["foo.ts", "bar.ts", "baz.ts"].join("\n"))
    expect(parsed!.mode).toBe("files")
    expect(parsed!.fileCount).toBe(3)
  })
})

describe("parseSearchOutput — rejections", () => {
  it("returns null for empty or whitespace-only output", () => {
    expect(parseSearchOutput("")).toBeNull()
    expect(parseSearchOutput("   \n\n")).toBeNull()
  })

  it("returns null for prose so the caller falls back to plain text", () => {
    expect(
      parseSearchOutput(
        "Found 3 files\n(Results are truncated, use a more specific path.)"
      )
    ).toBeNull()
  })

  it("does not read timestamps or line:col diagnostics as file matches", () => {
    expect(
      parseSearchOutput(
        ["12:34:56 build finished", "2026-07-30 10:00:00 done"].join("\n")
      )
    ).toBeNull()
  })

  it("returns null for rg --count output (`path:N`, no content column)", () => {
    expect(parseSearchOutput(["a.ts:3", "b.ts:11"].join("\n"))).toBeNull()
  })

  it("returns null for rg --heading output (path header, then line:content)", () => {
    expect(
      parseSearchOutput(["src/a.ts", "12:  const x = 1", "40:  y"].join("\n"))
    ).toBeNull()
  })
})

describe("parseSearchOutput — row cap", () => {
  it("caps matched lines and reports the remainder", () => {
    const text = Array.from(
      { length: 10 },
      (_, i) => `a.ts:${i + 1}:hit ${i}`
    ).join("\n")
    const parsed = parseSearchOutput(text, { maxRows: 4 })

    expect(parsed!.matchCount).toBe(10)
    expect(parsed!.groups[0].lines).toHaveLength(4)
    expect(parsed!.hiddenCount).toBe(6)
  })

  it("caps across files without emitting empty groups", () => {
    const text = Array.from({ length: 6 }, (_, i) => `f${i}.ts:1:hit`).join(
      "\n"
    )
    const parsed = parseSearchOutput(text, { maxRows: 3 })

    expect(parsed!.groups).toHaveLength(3)
    expect(parsed!.groups.every((g) => g.lines.length === 1)).toBe(true)
    expect(parsed!.hiddenCount).toBe(3)
  })

  it("caps the file list in files mode", () => {
    const text = Array.from({ length: 5 }, (_, i) => `src/f${i}.ts`).join("\n")
    const parsed = parseSearchOutput(text, { maxRows: 2 })

    expect(parsed!.fileCount).toBe(5)
    expect(parsed!.groups).toHaveLength(2)
    expect(parsed!.hiddenCount).toBe(3)
  })
})

describe("parseSearchOutput — bare-path lookalikes", () => {
  it("does not treat version-like tokens as files", () => {
    // `rg -o '\d+\.\d+\.\d+'` output — dots, but nothing to open.
    expect(parseSearchOutput(["1.2.3", "10.0.1"].join("\n"))).toBeNull()
  })

  it("does not treat rg --json records as files", () => {
    expect(
      parseSearchOutput(
        [
          '{"type":"begin","data":{"path":{"text":"a.ts"}}}',
          '{"type":"end"}',
        ].join("\n")
      )
    ).toBeNull()
  })
})
