import { importSelectedSessions, scanImportableSessions } from "@/lib/api"
import type { ScanResult, SelectedSessionKey } from "@/lib/types"

/**
 * Silent auto-import of DeepSeek harness (DSH) sessions into the sidebar.
 *
 * The DSH CLI (and the Tether node's headless harness) writes its transcripts
 * under `$DSH_HOME/sessions` and never tells codeg about them; codeg only
 * learns a session when someone opens the import picker. The harness usually
 * runs unattended, so in practice nobody clicks it and the sidebar lags behind
 * the conversations the user already had. This module closes the gap:
 * scan → keep only what the sidebar does not have → batch import. Nothing is
 * user-visible: a failed pass only logs and the next tick retries.
 *
 * Dedupe contract (server side, `commands/conversations.rs`):
 * - the scan reconciles every parsed session against
 *   `conversation.external_id` and reports `status: "new" | "imported" |
 *   "deleted"` (`build_scan_result`), so `status === "new"` IS the "not in the
 *   sidebar yet" filter;
 * - `import_one` resolves an existing row by `(external_id, agent_type)`
 *   before inserting and refreshes it in place, so a pass racing a manual
 *   import cannot double-insert (a UNIQUE index backs the pair too);
 * - `"deleted"` sessions are skipped on purpose: importing one applies
 *   `DeletedPolicy::Restore`, which would resurrect a conversation the user
 *   deliberately deleted.
 *
 * Only DeepSeek sessions are auto-imported — every other agent's conversations
 * are created from inside codeg and already reach the sidebar through the
 * normal create path.
 */

const DSH_AGENT_TYPE = "deepseek"

/** How often one silent pass runs. */
export const DSH_AUTO_SYNC_INTERVAL_MS = 60_000

/**
 * The scan walks every local agent store on the server's blocking pool and can
 * outlast the web transport's 60 s default on a large Claude/Codex store. Give
 * a pass the same headroom as the slow import-picker walks, otherwise a big
 * store would abort every tick right as the scan reaches it.
 */
const DSH_SCAN_TIMEOUT_MS = 5 * 60_000

/** Sessions the sidebar does not have yet (scan status `"new"`), DSH only. */
export function collectNewDeepseekSelections(
  scan: ScanResult
): SelectedSessionKey[] {
  const selections: SelectedSessionKey[] = []
  for (const folder of scan.folders) {
    for (const session of folder.sessions) {
      if (session.agent_type !== DSH_AGENT_TYPE || session.status !== "new") {
        continue
      }
      selections.push({
        agentType: session.agent_type,
        externalId: session.external_id,
      })
    }
  }
  return selections
}

export interface DshAutoSyncResult {
  /** Sessions that actually landed in the sidebar this pass. */
  imported: number
  /** Sessions the pass asked the backend to import. */
  selections: number
}

/**
 * One scan → filter → import pass. Throws on transport/backend errors; the
 * caller decides how loud to be (the provider only logs).
 */
export async function syncDeepseekSessionsOnce(): Promise<DshAutoSyncResult> {
  const scan = await scanImportableSessions({ timeoutMs: DSH_SCAN_TIMEOUT_MS })
  const selections = collectNewDeepseekSelections(scan)
  if (selections.length === 0) return { imported: 0, selections: 0 }
  const result = await importSelectedSessions(selections)
  return { imported: result.imported, selections: selections.length }
}

const LEADER_LOCK = "codeg:dsh-auto-sync"

/**
 * Run a pass only in the client that wins the cross-window leader lock.
 * Every client (web tab, extra desktop window) mounts the same provider and
 * the backend rejects overlapping imports (`IMPORT_GUARD`), so without the
 * lock N clients would walk the same stores and all but one would fail
 * silently on every tick. `ifAvailable` skips losers instead of queueing them;
 * the lock is released when the pass ends (or the window dies), so the next
 * tick re-elects. Without the Web Locks API the pass simply runs — a single
 * client is the normal case.
 */
export async function syncDeepseekSessionsIfLeader(): Promise<DshAutoSyncResult | null> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks
  if (!locks?.request) return syncDeepseekSessionsOnce()
  let result: DshAutoSyncResult | null = null
  await locks.request(LEADER_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) return
    result = await syncDeepseekSessionsOnce()
  })
  return result
}

let passInFlight = false

/**
 * Interval entry point used by the workspace provider: never overlaps passes
 * (one slow scan can outlast a tick), swallows every failure to the console so
 * a pass can neither block the UI nor raise a toast, and returns what landed so
 * the caller can refresh the conversation list on real progress.
 */
export async function runDshAutoSyncPass(): Promise<DshAutoSyncResult | null> {
  if (passInFlight) return null
  passInFlight = true
  try {
    const result = await syncDeepseekSessionsIfLeader()
    if (result && result.imported > 0) {
      console.info(
        `[dsh-auto-sync] imported ${result.imported}/${result.selections} DeepSeek session(s)`
      )
    }
    return result
  } catch (err) {
    console.warn("[dsh-auto-sync] pass failed, retrying next tick:", err)
    return null
  } finally {
    passInFlight = false
  }
}
