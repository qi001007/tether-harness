import { describe, expect, it } from "vitest"

import { getInstallErrorHintKey } from "./agent-install-error"

describe("getInstallErrorHintKey", () => {
  it("maps the real Volta 'could not remove directory' error to the file-lock key", () => {
    const volta =
      "ACP protocol error: failed to install npm package globally: Volta error: " +
      "Could not remove directory at C:\\Users\\Administrator\\AppData\\Local\\Volta\\tools\\image\\" +
      "packages\\@agentclientprotocol/claude-agent-acp Please ensure you have correct permissions " +
      "to the Volta directory."
    expect(getInstallErrorHintKey(volta)).toBe("errors.windowsFileLocked")
  })

  it.each([
    // Volta "Could not create environment ... Access is denied (os error 5)".
    "Volta error: Could not create environment for the package at C:\\...\\packages\\foo Access is denied. (os error 5)",
    // Plain npm on Windows — EPERM/EBUSY only count with a removal syscall.
    "npm error code EPERM\nnpm error syscall rmdir\nnpm error EPERM: operation not permitted, rmdir 'C:\\...\\node_modules\\foo'",
    "npm error EPERM: operation not permitted, unlink 'C:\\...\\bin\\foo.exe'",
    "npm error EBUSY: resource busy or locked, rmdir 'C:\\...\\foo'",
  ])("matches a genuine file-removal lock error: %s", (msg) => {
    expect(getInstallErrorHintKey(msg)).toBe("errors.windowsFileLocked")
  })

  it.each([
    // A generic Volta error must NOT misfire as the file-lock hint.
    "VOLTA ERROR: something went wrong",
    "Volta error: Could not download Node version 20",
    // EPERM/EBUSY without a removal syscall (e.g. opening a file) is unrelated.
    "npm error EPERM: operation not permitted, open 'C:\\...\\foo.json'",
    "Error: EBUSY: resource busy or locked, stat 'C:\\...\\foo'",
    // Other npm failure classes keep their raw message.
    "npm error code EACCES\nnpm error Error: EACCES: permission denied",
    "npm error code EEXIST: file already exists",
    "npm error 404 Not Found - GET https://registry.npmjs.org/foo",
    "npm error code ETARGET\nnpm error notarget No matching version found",
    "",
  ])("returns undefined for non-lock errors: %s", (msg) => {
    expect(getInstallErrorHintKey(msg)).toBeUndefined()
  })
})
