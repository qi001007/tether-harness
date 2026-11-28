import { foldReferenceLinks } from "@/lib/reference-link"

/**
 * A conversation's auto-title is parsed from the first user message, which since
 * the inline-file-badge work can carry Markdown reference links — a `@`-file
 * mention, a session/commit/agent reference — serialized as `[label](uri)` (see
 * `referenceToMarkdown`). Shown verbatim, a tab or the sidebar reads as raw
 * `[README.md](file:///…)` noise. {@link formatConversationTitle} folds each
 * such link back to just its bracket label (the human-readable badge text),
 * leaving all other title text untouched, so titles display the way the message
 * does. Display-only — the stored title (rename, search, export) is unchanged.
 *
 * The folding itself (a single-pass O(n) scan, ReDoS-safe) lives in the shared
 * {@link foldReferenceLinks} so the title, the transcript extractor and every
 * other reference-link consumer parse `[label](uri)` exactly one way.
 */
export function formatConversationTitle(
  title: string | null | undefined
): string {
  return foldReferenceLinks(title)
}
