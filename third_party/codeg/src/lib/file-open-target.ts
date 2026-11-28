// Absolute-path plumbing for the unified file-tab identity model.
//
// A file tab is identified by the file's absolute normalized path; folder
// association is DERIVED here (boundary longest-prefix over the registered
// folders) only where a folder is genuinely needed — watch subscriptions,
// git-base fetches, preview roots. IO never needs a folder: every read/write
// goes through the backend's `(root_path, relative)` contract as
// `(dirname, basename)`.
//
// Normalization is load-bearing: tab identity, watch-event joins, and folder
// matching must agree byte-for-byte, so they all funnel through
// `normalizeAbsPath` / `joinRootRel` in this module.

import { getHomeDirectory } from "@/lib/api"
import { isAbsoluteFilePath, normalizeSlashPath } from "@/lib/file-path-display"

const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:/

/**
 * True for a Windows UNC path (`//server/share/…`). Callers that resolve
 * sub-resources through a URL round-trip (markdown/HTML preview) cannot
 * carry the `//server/share` authority and must disable local resolution
 * for such documents rather than collapse them to a wrong single-slash
 * local path.
 */
export function isUncPath(path: string): boolean {
  return normalizeSlashPath(path).startsWith("//")
}

/**
 * Canonical form used as tab identity: forward slashes; `.` and `..`
 * segments resolved (floored at the root — `..` can never climb above it,
 * so a lexical alias like `/repo/../etc/x` collapses to `/etc/x` and is
 * classified by where it actually points); duplicate separators collapsed;
 * no trailing slash (except the bare `/` and `X:/` roots); Windows drive
 * letter uppercased so `c:/repo` and `C:/repo` are one identity. A UNC
 * `//server/share` prefix is preserved. POSIX case is preserved
 * (case-sensitivity matches the backend's treatment of relative paths
 * today).
 */
export function normalizeAbsPath(path: string): string {
  let normalized = normalizeSlashPath(path.trim())
  // URL-style Windows paths ("/C:/x") — the leading slash is a URL
  // artifact (e.g. rehype-harden's re-rooting), not a path component.
  if (/^\/[a-zA-Z]:\//.test(normalized)) {
    normalized = normalized.slice(1)
  }
  if (WINDOWS_DRIVE_PREFIX.test(normalized)) {
    normalized = normalized[0].toUpperCase() + normalized.slice(1)
  }

  const drive = WINDOWS_DRIVE_PREFIX.test(normalized)
    ? normalized.slice(0, 2)
    : null
  const isUnc = !drive && normalized.startsWith("//")
  const isPosix = !drive && !isUnc && normalized.startsWith("/")

  if (drive || isUnc || isPosix) {
    const body = drive ? normalized.slice(2) : normalized
    // ".." floors at the root designator. A UNC root is //server/share —
    // its two leading segments are part of the designator (Windows resolves
    // ".." at a share root to the share root itself), so they are protected
    // from popping just like "/" and "C:/" are.
    const floor = isUnc ? 2 : 0
    const parts: string[] = []
    for (const segment of body.split("/")) {
      if (!segment || segment === ".") continue
      if (segment === "..") {
        if (parts.length > floor) parts.pop()
        continue
      }
      parts.push(segment)
    }
    const prefix = drive ? `${drive}/` : isUnc ? "//" : "/"
    return parts.length > 0 ? prefix + parts.join("/") : prefix
  }

  // Relative (or otherwise unrooted) input: leave segments alone, only
  // strip trailing slashes.
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

/**
 * Split an absolute file path into the `(root_path, relative)` pair the
 * backend file IO contract requires. Degenerate roots are preserved as valid
 * directories: `/hosts` → (`/`, `hosts`), `C:/x.ts` → (`C:/`, `x.ts`) — a
 * bare `C:` is not a usable directory path, so the slash is re-appended.
 * Returns null when no file name remains (the path was a root).
 */
export function splitAbsPath(
  absPath: string
): { rootPath: string; ioPath: string } | null {
  const normalized = normalizeAbsPath(absPath)
  if (!isAbsoluteFilePath(normalized)) return null

  const lastSlash = normalized.lastIndexOf("/")
  if (lastSlash < 0) return null
  const ioPath = normalized.slice(lastSlash + 1)
  if (!ioPath) return null

  let rootPath = normalized.slice(0, lastSlash)
  if (!rootPath) {
    rootPath = "/"
  } else if (/^[a-zA-Z]:$/.test(rootPath)) {
    rootPath = `${rootPath}/`
  }
  return { rootPath, ioPath }
}

/**
 * Join a workspace root and a root-relative path into the same canonical
 * absolute form `normalizeAbsPath` produces — watch events (root + relative
 * changed path) must land byte-identical on tab identities.
 */
export function joinRootRel(rootPath: string, relPath: string): string {
  const root = normalizeAbsPath(rootPath)
  const rel = normalizeSlashPath(relPath).replace(/^\.?\/+/, "")
  if (!rel) return root
  // Funnel the join back through normalizeAbsPath so dot segments and
  // duplicate separators inside `rel` cannot mint a second byte-form of
  // the same file.
  return normalizeAbsPath(
    root.endsWith("/") ? `${root}${rel}` : `${root}/${rel}`
  )
}

export interface OwningFolderMatch {
  folderId: number
  rootPath: string
  relPath: string
}

/**
 * Boundary-safe containment: true when `absPath` names a file strictly
 * inside `rootPath`. Windows drive paths AND UNC shares compare
 * case-insensitively (both live on case-insensitive filesystems); the
 * root itself is not "under" itself. Both inputs are normalized here, so
 * callers may pass raw values.
 */
export function isPathUnderRoot(absPath: string, rootPath: string): boolean {
  const path = normalizeAbsPath(absPath)
  const root = normalizeAbsPath(rootPath)
  if (!root || !isAbsoluteFilePath(root)) return false
  const prefix = root.endsWith("/") ? root : `${root}/`
  if (WINDOWS_DRIVE_PREFIX.test(prefix) || prefix.startsWith("//")) {
    return path.toLowerCase().startsWith(prefix.toLowerCase())
  }
  return path.startsWith(prefix)
}

/**
 * Find the registered folder containing `absPath`, if any. Boundary-aware
 * (`/a` never claims `/ab/file`), deepest root wins for nested roots
 * (worktrees, sub-folder registrations), and Windows drive paths compare
 * case-insensitively (mirroring `toFolderRelativePath`) while the returned
 * `relPath` keeps the original casing. A path equal to a folder root itself
 * is not a file inside it — no match.
 */
export function findOwningFolder(
  absPath: string,
  folders: ReadonlyArray<{ id: number; path: string }>
): OwningFolderMatch | null {
  const normalized = normalizeAbsPath(absPath)
  if (!isAbsoluteFilePath(normalized)) return null

  let best: OwningFolderMatch | null = null
  let bestRootLength = -1

  for (const folder of folders) {
    const root = normalizeAbsPath(folder.path)
    if (!root || !isAbsoluteFilePath(root)) continue
    if (!isPathUnderRoot(normalized, root)) continue
    if (root.length <= bestRootLength) continue

    const prefix = root.endsWith("/") ? root : `${root}/`
    best = {
      folderId: folder.id,
      rootPath: root,
      relPath: normalized.slice(prefix.length),
    }
    bestRootLength = root.length
  }

  return best
}

// Home expansion is lazy (only `~` / `~/…` paths touch the backend) and the
// promise is cached module-wide so concurrent expansions dedupe. A failed
// lookup clears the cache (retry-able) and the input passes through
// unchanged — callers surface the eventual "does not exist" IO error instead
// of us throwing here.
let homeDirPromise: Promise<string> | null = null

/** Test-only: drop the cached home-directory promise. */
export function resetHomeDirCacheForTests(): void {
  homeDirPromise = null
}

function fetchHomeDir(): Promise<string> {
  if (!homeDirPromise) {
    homeDirPromise = getHomeDirectory().catch((error) => {
      homeDirPromise = null
      throw error
    })
  }
  return homeDirPromise
}

/** True when the path is `~` or starts with `~/` (or `~\`). */
export function isHomeRelativePath(path: string): boolean {
  const trimmed = path.trim()
  return (
    trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")
  )
}

export async function expandHomePath(path: string): Promise<string> {
  if (!isHomeRelativePath(path)) return path
  try {
    const home = await fetchHomeDir()
    const trimmed = path.trim()
    const remainder = trimmed === "~" ? "" : trimmed.slice(2)
    return joinRootRel(home, remainder)
  } catch {
    return path
  }
}
