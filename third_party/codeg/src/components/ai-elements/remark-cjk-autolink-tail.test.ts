import { describe, expect, it } from "vitest"
import {
  autolinkEnd,
  remarkTrimCjkAutolinkTail,
} from "./remark-cjk-autolink-tail"

// Minimal mdast node shapes for the transform.
type Node = {
  type: string
  url?: string
  value?: string
  children?: Node[]
}

/** A paragraph holding one autolink literal, as GFM parses it. */
function literalTree(label: string, url = label): Node {
  return {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "text", value: "见 " },
          { type: "link", url, children: [{ type: "text", value: label }] },
        ],
      },
    ],
  }
}

/** `[link url, rendered label, text after the link]` after the transform. */
function split(tree: Node): [string | undefined, string | undefined, string[]] {
  remarkTrimCjkAutolinkTail()(tree)
  const paragraph = tree.children![0]
  const linkIndex = paragraph.children!.findIndex((n) => n.type === "link")
  const link = paragraph.children![linkIndex]
  return [
    link?.url,
    link?.children?.[0]?.value,
    paragraph
      .children!.slice(linkIndex + 1)
      .map((n) => n.value ?? `<${n.type}>`),
  ]
}

describe("remarkTrimCjkAutolinkTail", () => {
  it("keeps the unmatched `)` out of a parenthesized url before `。`", () => {
    // The reported bug: micromark ran the literal to the space, so it never
    // applied its own trailing-paren rule.
    expect(split(literalTree("https://github.com/o/hap_api)。"))).toEqual([
      "https://github.com/o/hap_api",
      "https://github.com/o/hap_api",
      [")。"],
    ])
  })

  it("trims a CJK tail that is more than one character", () => {
    expect(split(literalTree("https://x.com/a)。（下一句）"))).toEqual([
      "https://x.com/a",
      "https://x.com/a",
      [")。（下一句）"],
    ])
  })

  it("trims a CJK tail with no ASCII punctuation to re-trim", () => {
    expect(split(literalTree("https://x.com/a，然后"))).toEqual([
      "https://x.com/a",
      "https://x.com/a",
      ["，然后"],
    ])
  })

  it("keeps balanced parentheses inside the url", () => {
    expect(
      split(literalTree("https://en.wikipedia.org/wiki/Foo_(bar)。"))
    ).toEqual([
      "https://en.wikipedia.org/wiki/Foo_(bar)",
      "https://en.wikipedia.org/wiki/Foo_(bar)",
      ["。"],
    ])
  })

  it("drops only the unmatched parenthesis when both kinds are present", () => {
    expect(
      split(literalTree("https://en.wikipedia.org/wiki/Foo_(bar))。"))
    ).toEqual([
      "https://en.wikipedia.org/wiki/Foo_(bar)",
      "https://en.wikipedia.org/wiki/Foo_(bar)",
      [")。"],
    ])
  })

  it("keeps a query string intact while trimming its tail", () => {
    expect(split(literalTree("https://x.com/a?b=1&c=2)。"))).toEqual([
      "https://x.com/a?b=1&c=2",
      "https://x.com/a?b=1&c=2",
      [")。"],
    ])
  })

  it("re-prefixes the mdast protocol of a `www.` literal", () => {
    // mdast stores `www.x.com` as `http://www.x.com`; the trimmed url has to
    // keep that prefix while the visible label stays bare.
    expect(
      split(literalTree("www.x.com/a)。", "http://www.x.com/a)。"))
    ).toEqual(["http://www.x.com/a", "www.x.com/a", [")。"]])
  })

  it("leaves an autolink with no CJK tail untouched", () => {
    // micromark already trimmed these; re-trimming would corrupt an explicit
    // `<https://x.com/a)>` autolink, which looks identical in mdast.
    expect(split(literalTree("https://x.com/a)"))).toEqual([
      "https://x.com/a)",
      "https://x.com/a)",
      [],
    ])
  })

  it("leaves a labeled markdown link untouched", () => {
    const tree = literalTree("https://x.com/a)。")
    const link = tree.children![0].children![1]
    link.children = [{ type: "text", value: "文档" }]
    remarkTrimCjkAutolinkTail()(tree)
    expect(link.url).toBe("https://x.com/a)。")
  })

  it("leaves a non-http link untouched", () => {
    // Notably `[文档。md](文档。md)`, which has the text-equals-url shape.
    expect(split(literalTree("文档。md"))).toEqual(["文档。md", "文档。md", []])
  })

  it("trims autolinks nested in emphasis", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "emphasis",
              children: [
                {
                  type: "link",
                  url: "https://x.com/a)。",
                  children: [{ type: "text", value: "https://x.com/a)。" }],
                },
              ],
            },
          ],
        },
      ],
    }
    remarkTrimCjkAutolinkTail()(tree)
    const emphasis = tree.children![0].children![0]
    expect(emphasis.children!.map((n) => n.url ?? n.value)).toEqual([
      "https://x.com/a",
      ")。",
    ])
  })
})

describe("autolinkEnd", () => {
  // Parity spot-checks against micromark's trail tokenizer.
  it.each([
    ["https://x.com/a", 15],
    ["https://x.com/a)", 15],
    ["https://x.com/a))", 15],
    ["https://x.com/a).", 15],
    ["https://x.com/a(b)", 18],
    ["https://x.com/a(b))", 18],
    ["https://x.com/a.", 15],
    ["https://x.com/a!", 15],
    ["https://x.com/a?b=1&c=2", 23],
    ["https://x.com/a&amp;", 15],
    ["https://x.com/a&amp", 19],
    ["https://x.com/a]", 15],
    ["https://x.com/a<b", 15],
    ["https://x.com/a_b", 17],
    ["https://x.com/a_", 15],
  ])("ends %s at %i", (url, end) => {
    expect(autolinkEnd(url)).toBe(end)
  })
})
