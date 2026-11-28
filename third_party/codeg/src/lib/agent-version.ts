// SemVer 2.0.0; group 4 is the prerelease.
export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/

/**
 * Whether an installed OpenCode is a 1.x (or older) release, which codeg no
 * longer launches — mirror of `is_pre_v2_release` in the backend's
 * `opencode_launch.rs`. Only a release is judged: opencode's preview channels
 * publish as `0.0.0-<tag>` whatever the build's age, and an unparsable version
 * says nothing, so neither is flagged.
 */
export function isOpenCodeV1Release(version: string): boolean {
  const match = SEMVER_PATTERN.exec(version.trim())
  if (!match) return false
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number)
  if (major === 0 && minor === 0 && patch === 0) return false
  return major < 2
}
