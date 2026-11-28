// A GFM autolink literal only ends at whitespace, `<`, or end of input — CJK
// punctuation is none of those, so `https://example.com/r)。` is tokenized as
// ONE url, tail and all. `@streamdown/cjk` already cuts such a url at its first
// CJK punctuation character, but it stops there, and that cut re-exposes ASCII
// punctuation which GFM's own trailing-punctuation rules never got to see (they
// only run when the literal ends at whitespace/EOF):
//
//   已推送: dca27f1 → origin/main (https://github.com/o/hap_api)。
//     micromark        → url "https://github.com/o/hap_api)。"
//     @streamdown/cjk  → url "https://github.com/o/hap_api)"  + text "。"
//                                                          ^ the reported bug
//
// So this plugin makes the CJK cut itself AND re-applies GFM's trail rules to
// the head, putting the unmatched `)` in the text node with `。`. It is
// registered on the `remarkPlugins` prop, which Streamdown runs BEFORE
// `cjk.remarkPluginsAfter` (order: cjk-before → remarkPlugins → cjk-after →
// math), so `@streamdown/cjk`'s splitter then finds no CJK punctuation left in
// the url and no-ops.
//
// Autolinks WITHOUT a CJK tail are deliberately left alone: micromark already
// trimmed those correctly, and re-trimming would break an explicitly delimited
// `<https://example.com/a)>` autolink, which is indistinguishable from a
// literal in mdast.

type MdastNodeLike = {
  type: string
  url?: unknown
  value?: unknown
  children?: unknown
}

// Mirrors the set in `@streamdown/cjk` so both plugins cut at the same place.
const CJK_PUNCTUATION = new Set(
  "。．，、？！：；（）【】「」『』〈〉《》".split("")
)

const AUTOLINK_PROTOCOL = /^(?:https?:\/\/|www\.)/i

// --- GFM trailing-punctuation rules -----------------------------------------
//
// Ported from micromark-extension-gfm-autolink-literal's `pathInside` /
// `tokenizeTrail` state machines (fuzz-checked against it for parity). The
// tokenizer's "end" is whitespace/EOF; here the CJK cut point plays that role,
// which is the whole reason these rules can fire at all.

/** Punctuation that may end the url, per micromark's `trail` states. */
const TRAIL = new Set("!\"')*,.:;?_~".split(""))

/** Punctuation that makes micromark's `pathInside` attempt a trail check. */
const PATH_PUNCTUATION = new Set([...TRAIL, "&", "<", "]"])

function isWhitespace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char)
}

/**
 * Whether everything from `start` on is trailing punctuation — i.e. a run of
 * trail characters, `&entity;` groups, and `]` that reaches the end of `url`.
 */
function isTrail(url: string, start: number): boolean {
  let i = start
  while (i < url.length) {
    const char = url[i]
    if (TRAIL.has(char)) {
      i += 1
      continue
    }
    // `&` + alphabeticals + `;` counts as trailing punctuation as a whole;
    // anything else after `&` is url content.
    if (char === "&") {
      const entity = /^&[A-Za-z]+;/.exec(url.slice(i))
      if (!entity) return false
      i += entity[0].length
      continue
    }
    // `]` ends the url when it could close a `[…](…)` / `[…][…]` wrapper.
    if (char === "]") {
      i += 1
      const next = url[i]
      if (next === "(" || next === "[" || isWhitespace(next)) return true
      continue
    }
    if (char === "<" || isWhitespace(char)) return true
    return false
  }
  return true
}

/**
 * Index at which `url` stops being a link, per GFM's trailing-punctuation and
 * unbalanced-parenthesis rules. `https://x.com/a)` → 15, but the `)` of
 * `https://x.com/a(b)` is kept because its parentheses balance.
 */
export function autolinkEnd(url: string): number {
  let open = 0
  let close = 0
  let i = 0
  while (i < url.length) {
    const char = url[i]
    if (char === "(") {
      open += 1
      i += 1
      continue
    }
    // A `)` that still has an unclosed `(` before it is url content, never a
    // trail — that is what keeps `…/Foo_(bar)` intact.
    if (char === ")" && close < open) {
      close += 1
      i += 1
      continue
    }
    if (PATH_PUNCTUATION.has(char)) {
      if (isTrail(url, i)) return i
      if (char === ")") close += 1
      i += 1
      continue
    }
    if (isWhitespace(char)) return i
    i += 1
  }
  return url.length
}

// --- mdast surgery -----------------------------------------------------------

type AutolinkLiteral = {
  /** The visible text, which is also the url minus any mdast-added protocol. */
  label: string
  /** `"http://"` for a `www.` literal (mdast prepends it), else `""`. */
  urlPrefix: string
  text: MdastNodeLike
}

/**
 * Reads `node` as an autolink literal: a link whose single text child IS its
 * url. `www.example.com` is the one literal whose url differs from its text —
 * mdast prepends `http://` — so it is matched on the prefixed form. Email
 * literals (`mailto:` + text) are excluded on purpose: micromark's email
 * tokenizer already stops at CJK punctuation.
 */
function asAutolinkLiteral(node: MdastNodeLike): AutolinkLiteral | null {
  if (node.type !== "link" || typeof node.url !== "string") return null
  const { children } = node
  if (!Array.isArray(children) || children.length !== 1) return null
  const text = children[0] as MdastNodeLike | undefined
  if (!text || text.type !== "text" || typeof text.value !== "string") {
    return null
  }
  const label = text.value
  if (!AUTOLINK_PROTOCOL.test(label)) return null
  if (node.url === label) return { label, urlPrefix: "", text }
  if (node.url === `http://${label}`) {
    return { label, urlPrefix: "http://", text }
  }
  return null
}

/** Index of the first CJK punctuation character, or -1. */
function cjkCutIndex(label: string): number {
  for (let i = 0; i < label.length; i += 1) {
    if (CJK_PUNCTUATION.has(label[i])) return i
  }
  return -1
}

/**
 * Trims the CJK tail (plus any ASCII punctuation it was hiding) off `node`,
 * returning the trimmed text so the caller can re-insert it as a sibling, or
 * null when `node` needs no change.
 */
function trimAutolinkTail(node: MdastNodeLike): string | null {
  const literal = asAutolinkLiteral(node)
  if (!literal) return null
  const cut = cjkCutIndex(literal.label)
  if (cut < 0) return null
  const head = literal.label.slice(0, autolinkEnd(literal.label.slice(0, cut)))
  // A url that is nothing but punctuation cannot happen behind the protocol
  // check, but never emit an empty link if it somehow does.
  if (!head) return null
  node.url = `${literal.urlPrefix}${head}`
  literal.text.value = head
  return literal.label.slice(head.length)
}

function splitAutolinkTails(node: MdastNodeLike): void {
  const { children } = node
  if (!Array.isArray(children)) return
  // Rebuild the child list only once a split actually happens.
  let rebuilt: MdastNodeLike[] | null = null
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i] as MdastNodeLike
    splitAutolinkTails(child)
    const tail = trimAutolinkTail(child)
    if (tail === null) {
      rebuilt?.push(child)
      continue
    }
    if (!rebuilt) rebuilt = children.slice(0, i) as MdastNodeLike[]
    rebuilt.push(child, { type: "text", value: tail })
  }
  if (rebuilt) node.children = rebuilt
}

export function remarkTrimCjkAutolinkTail() {
  return (tree: MdastNodeLike) => {
    splitAutolinkTails(tree)
  }
}
