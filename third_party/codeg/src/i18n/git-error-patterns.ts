/**
 * Fallback pattern that identifies a "not a git repository" error from the
 * raw stderr of a failed git invocation.
 *
 * The primary detection path is the typed `not_a_git_repository` error code
 * returned by backend commands wrapped with a filesystem preflight check
 * (see `src-tauri/src/git_repo.rs::ensure_git_repo`). This pattern only
 * applies when an un-preflighted command leaks raw stderr to the client.
 *
 * Only the English form is needed: `src-tauri/src/process.rs` pins
 * `LANG=C.UTF-8` / `LC_ALL=C.UTF-8` on every spawned child process, so git
 * stderr is always English regardless of the system locale.
 */
export const NOT_A_GIT_REPO_PATTERNS: readonly RegExp[] = [
  /not a git repository/i,
]
