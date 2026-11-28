import { randomUUID } from "@/lib/utils"

/**
 * Asks the Tether host to show its own resource manager for picking a folder
 * or files.
 *
 * The workspace runs in two embeddings, and each has exactly one working
 * channel back to the host:
 *
 * - iframe (web/remote surface): `window.parent.postMessage` is a real
 *   cross-frame message, and the host answers with `postMessage` on the same
 *   frame.
 * - Electron `<webview>` (packaged APP): the guest is its own top window, so
 *   `postMessage` never leaves it. The established channel there is a
 *   same-document hash the host observes (`did-navigate-in-page`) — the same
 *   one the Herdr/CLI buttons use — and the host answers by dispatching a
 *   window message inside the guest.
 *
 * A browser that is neither (Codeg opened standalone) gets `""`, and callers
 * fall back to Codeg's own in-app directory browser. That fallback is the only
 * place a picker lives inside this app: whenever the host is present every
 * picker (folder or file, single or several) is answered by Tether's explorer,
 * so the user sees the same resource manager the chat uploads use.
 */
export type TetherPickMode = "iframe" | "hash" | ""
export type TetherPickKind = "folder" | "file"

const RESULT_TYPE = "tether:pick-folder-result"

type Settle = (paths: string[] | null) => void
const pending = new Map<string, Settle>()
let listening = false

function onMessage(event: MessageEvent) {
  const data = event?.data
  if (!data || typeof data !== "object") return
  if ((data as { type?: unknown }).type !== RESULT_TYPE) return
  const id = String((data as { id?: unknown }).id ?? "")
  if (!id) return
  const settle = pending.get(id)
  if (!settle) return
  pending.delete(id)
  // The host answers with `paths` (every pick) and mirrors the first one into
  // `path` for the single-folder request the bridge started with.
  const rawPaths = (data as { paths?: unknown }).paths
  const rawPath = (data as { path?: unknown }).path
  const list = Array.isArray(rawPaths)
    ? rawPaths
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : typeof rawPath === "string" && rawPath.trim()
      ? [rawPath.trim()]
      : []
  settle(list.length ? list : null)
}

function listen() {
  if (listening || typeof window === "undefined") return
  listening = true
  window.addEventListener("message", onMessage)
}

/** Which channel this page can use to reach the Tether host, if any. */
export function tetherPickMode(): TetherPickMode {
  if (typeof window === "undefined") return ""
  let inIframe = false
  try {
    if (window.parent && window.parent !== window) inIframe = true
  } catch (_) {
    // A cross-origin parent still counts: only `postMessage` is used.
    inIframe = true
  }
  const explicitEmbedded = Boolean(
    (window as unknown as { __tetherEmbeddedHost?: boolean })
      .__tetherEmbeddedHost
  )
  let storedEmbedded = false
  try {
    storedEmbedded = sessionStorage.getItem("tether_embedded_host") === "1"
  } catch (_) {
    /* sessionStorage may be unavailable */
  }
  let electronUa = false
  try {
    electronUa = /Electron\//.test(navigator.userAgent || "")
  } catch (_) {
    /* user agent is advisory */
  }
  const mode: TetherPickMode = inIframe
    ? "iframe"
    : explicitEmbedded || storedEmbedded || electronUa
      ? "hash"
      : ""
  if (mode && !storedEmbedded) {
    try {
      sessionStorage.setItem("tether_embedded_host", "1")
    } catch (_) {
      /* ignore */
    }
  }
  return mode
}

export interface TetherPickOptions {
  /** Directories by default; `file` picks files instead. */
  kind?: TetherPickKind
  /** Let the host answer with several paths instead of one. */
  multiple?: boolean
}

/**
 * Resolves with the picked path(s), or `null` when the host reported a cancel
 * (or could not answer at all — callers treat both as "nothing happened").
 */
export function requestTetherPick(
  options: TetherPickOptions = {}
): Promise<string[] | null> {
  const mode = tetherPickMode()
  if (!mode) return Promise.resolve(null)
  listen()
  const kind: TetherPickKind = options.kind === "file" ? "file" : "folder"
  const multiple = options.multiple === true
  const id = randomUUID()
  return new Promise<string[] | null>((resolve) => {
    pending.set(id, resolve)
    if (mode === "iframe") {
      try {
        window.parent.postMessage(
          { type: "tether:pick-folder", id, kind, multiple },
          "*"
        )
      } catch (_) {
        pending.delete(id)
        resolve(null)
      }
      return
    }
    const params = new URLSearchParams({
      tether_action: "pick_folder",
      request_id: id,
    })
    // The host parses only a closed set of hash keys, so the extra ones are
    // written only when they say something different from the default.
    if (kind === "file") params.set("pick_kind", "file")
    if (multiple) params.set("pick_multiple", "1")
    window.location.hash = params.toString()
  })
}

/** Single-directory pick, the shape the first callers expect. */
export async function requestTetherFolderPick(): Promise<string | null> {
  const paths = await requestTetherPick({ kind: "folder" })
  return paths && paths.length ? paths[0] : null
}