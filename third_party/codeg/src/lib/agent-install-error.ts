/**
 * Recognizes known agent install/upgrade/uninstall failure signatures so the
 * UI can show a clear, localized hint the user can act on, instead of the raw
 * CLI error text.
 *
 * Primary case (Windows): codeg keeps an agent's process alive for session
 * reuse. On Windows the running process holds file locks on its own files
 * inside the npm / Volta global package directory, so a reinstall can't remove
 * the old package dir to upgrade or uninstall — npm/Volta surface this as
 * "Could not remove directory" / EPERM / EBUSY (and it fails even as admin,
 * because it's a sharing violation, not a permissions problem). The fix the
 * user needs is simply to close the running sessions and retry.
 *
 * This module only classifies the error and returns a translation key; the
 * caller renders it via its own `useTranslations("AcpAgentSettings")` so the
 * key stays type-checked against the message catalog. The rule list is
 * ordered; the first match wins. Add new entries here as other recognizable
 * failures come up.
 */

/** Translation keys (relative to the `AcpAgentSettings` namespace). */
export type InstallErrorHintKey = "errors.windowsFileLocked"

type InstallErrorRule = {
  /** Tested against the lowercased raw error message. */
  match: (lowerMessage: string) => boolean
  key: InstallErrorHintKey
}

const INSTALL_ERROR_RULES: InstallErrorRule[] = [
  {
    // Windows file lock held by a running agent process, surfacing only while
    // removing/replacing the old install. Two real shapes:
    //   • Volta wraps it as "Could not remove directory" / "Could not create
    //     environment" (package-image ops on its global packages dir).
    //   • Plain npm prints "EPERM/EBUSY: operation not permitted, rmdir|unlink".
    // The phrases/codes are emitted in English regardless of OS locale. We
    // require an explicit removal context (rmdir/unlink) for the EPERM/EBUSY
    // branch so generic permission/busy errors elsewhere (e.g. EPERM on `open`,
    // a Volta download failure) — and EACCES/EEXIST/404/ETARGET — fall through
    // to the raw message rather than misfiring this hint.
    match: (m) =>
      m.includes("could not remove directory") ||
      m.includes("could not create environment") ||
      ((m.includes("eperm") || m.includes("ebusy")) &&
        (m.includes("rmdir") || m.includes("unlink"))),
    key: "errors.windowsFileLocked",
  },
]

/**
 * Returns the translation key for a recognized install error, or `undefined`
 * when the error isn't one we have specific guidance for (callers should fall
 * back to the raw message).
 */
export function getInstallErrorHintKey(
  rawMessage: string
): InstallErrorHintKey | undefined {
  const lower = rawMessage.toLowerCase()
  for (const rule of INSTALL_ERROR_RULES) {
    if (rule.match(lower)) return rule.key
  }
  return undefined
}
