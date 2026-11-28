/**
 * Direct bridge to a running DeepSeek Harness (DSH) session, relayed by the
 * Tether host page that embeds this app.
 *
 * Why it exists: DSH is a resident daemon on the machine, and it keeps a write
 * handle open on the session it is driving. deepseek-acp (what Codeg normally
 * talks to) cannot take that handle at the same time — `session/load` answers
 * `session "<id>" is already owned by an active write handle` — so an ACP
 * connection to a live DSH session is not available while DSH owns it. The
 * transcript is still readable (the parser re-reads the session log on every
 * detail fetch), and DSH still accepts prompts through its own live API, so the
 * conversation stays usable: the host page relays a prompt over
 * `/api/devices/<dev>/dsh/live/sessions/<sid>/prompt` and the new turns show up
 * in the log the panel already re-reads.
 *
 * The embedded page has no node token of its own, which is why the send is a
 * `postMessage` to the host rather than a fetch: the host holds the session and
 * the credential. Wire format (both directions carry `id` so the host can be
 * answered out of order):
 *
 *   guest → host  { type: "tether:dsh-prompt", id, sessionId, text }
 *   host → guest  { type: "tether:dsh-prompt-result", id, ok, status, error }
 *
 * `device` is deliberately omitted: the guest is served by codeg's own origin
 * and cannot see which Tether device it belongs to, so the host fills in its
 * own local device (see `packages/tether-ui/src/agents-page.js`).
 */

/** Guest → host: send this text into the named DSH session. */
export const DSH_PROMPT_TYPE = "tether:dsh-prompt"
/** Host → guest: the outcome of one `DSH_PROMPT_TYPE`. */
export const DSH_PROMPT_RESULT_TYPE = "tether:dsh-prompt-result"

/**
 * DSH session ids are `session-<uuid>` (the same shape the host validates
 * before it relays one). Narrow on purpose: this id is interpolated into the
 * host's URL path, so nothing else may pass.
 */
const DSH_SESSION_ID = /^session-[A-Za-z0-9._-]{1,200}$/

export function isDshSessionId(value: unknown): value is string {
  return typeof value === "string" && DSH_SESSION_ID.test(value)
}

/**
 * A conversation that is really a DSH session: the DeepSeek agent parsed the
 * harness' own session log, so `external_id` is a `session-…` id rather than an
 * ACP session id minted by codeg. Those are the ones DSH itself may be driving.
 */
export function isDshExternalSession(
  agentType: string | null | undefined,
  externalId: string | null | undefined
): boolean {
  return agentType === "deepseek" && isDshSessionId(externalId)
}

export interface DshPromptResult {
  ok: boolean
  /** HTTP status the host saw, 0 when the request never left the page. */
  status: number
  error: string | null
}

function failed(error: string): DshPromptResult {
  return { ok: false, status: 0, error }
}

/** How long to wait for the host's reply before calling the send a failure. */
export const DSH_PROMPT_TIMEOUT_MS = 60_000

let promptSequence = 0

/**
 * Ask the embedding host to deliver `text` into `sessionId`.
 *
 * Never throws: every failure — not embedded, host silent, host refused — comes
 * back as `{ ok: false, error }` so the caller has one branch to render.
 */
export function sendDshPrompt(
  sessionId: string,
  text: string,
  options?: { timeoutMs?: number }
): Promise<DshPromptResult> {
  const timeoutMs = options?.timeoutMs ?? DSH_PROMPT_TIMEOUT_MS
  return new Promise<DshPromptResult>((resolve) => {
    if (typeof window === "undefined") {
      resolve(failed("Not in a browser context"))
      return
    }
    // `window.parent` is this very window when the app is opened standalone
    // (or inside an Electron <webview>, whose guest has no parent window), so
    // both cases mean "there is no host to relay through".
    const host = window.parent
    if (!host || host === window) {
      resolve(failed("No Tether host page: open this workspace inside Tether"))
      return
    }

    promptSequence += 1
    const id = `dsh-${Date.now().toString(36)}-${promptSequence.toString(36)}`
    let timer: ReturnType<typeof setTimeout> | null = null
    const settle = (result: DshPromptResult) => {
      if (timer) clearTimeout(timer)
      timer = null
      window.removeEventListener("message", onMessage)
      resolve(result)
    }
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data
      if (!data || typeof data !== "object") return
      const payload = data as {
        type?: unknown
        id?: unknown
        ok?: unknown
        status?: unknown
        error?: unknown
      }
      if (payload.type !== DSH_PROMPT_RESULT_TYPE || payload.id !== id) return
      const status = Number(payload.status)
      settle({
        ok: payload.ok === true,
        status: Number.isFinite(status) ? status : 0,
        error:
          payload.ok === true
            ? null
            : String(payload.error ?? "The host reported no reason"),
      })
    }

    window.addEventListener("message", onMessage)
    timer = setTimeout(
      () => settle(failed("The Tether host did not answer in time")),
      timeoutMs
    )
    try {
      host.postMessage({ type: DSH_PROMPT_TYPE, id, sessionId, text }, "*")
    } catch (error) {
      settle(failed(error instanceof Error ? error.message : String(error)))
    }
  })
}