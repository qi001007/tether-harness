/**
 * Cut, made atomic: copy first, remove only on a confirmed clipboard write.
 *
 * The composer's right-click Cut writes through {@link "@/lib/utils".copyTextFromMenu},
 * which is deferred (the radix menu traps focus until it closes) and resolves
 * `false` when both the async Clipboard API and the legacy `execCommand`
 * fallback fail — e.g. a non-secure context where the write is blocked. Removing
 * the selection unconditionally would then delete the text without ever placing
 * it on the clipboard (data loss). This guard removes the content only after the
 * write succeeds; otherwise it leaves the selection intact and reports the
 * failure so the user can retry with the keyboard.
 *
 * @returns `true` when the text was copied and removed, `false` otherwise (empty
 *          selection, or a failed write that left the content in place).
 */
export async function cutSelectionToClipboard(params: {
  /** The already-extracted selection text. Empty → nothing to cut. */
  text: string
  /** Deferred clipboard write; resolves `false` on failure. */
  copy: (text: string) => Promise<boolean>
  /** Removes the selected range from the document. Called only on success. */
  remove: () => void
  /** Invoked when the clipboard write fails (the content is kept). */
  onWriteFailed: () => void
}): Promise<boolean> {
  const { text, copy, remove, onWriteFailed } = params
  if (!text) return false
  const copied = await copy(text)
  if (!copied) {
    onWriteFailed()
    return false
  }
  remove()
  return true
}
