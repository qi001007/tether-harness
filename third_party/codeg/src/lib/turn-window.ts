import type { DbConversationDetail, MessageTurn } from "@/lib/types"

/**
 * Turn-window helpers for the paginated conversation detail protocol.
 *
 * The backend parses transcripts in full but serializes only a requested
 * window (`turns_offset`/`turns_total`/`prefix_hash`/… on
 * `DbConversationDetail`). These helpers derive window coordinates from a
 * detail (falling back to legacy full-response semantics when the fields are
 * absent) and mirror the backend's structural prefix fingerprint so the
 * client can chain-extend it locally.
 */

/** FNV-1a 64-bit offset basis — the fingerprint of an empty prefix. */
export const FNV_SEED_HEX = "cbf29ce484222325"

const FNV_PRIME = 0x100000001b3n
const U64_MASK = (1n << 64n) - 1n

/** `detail.turns[0]`'s global index; 0 for legacy full responses. */
export function turnsOffsetOf(detail: DbConversationDetail | null): number {
  return detail?.turns_offset ?? 0
}

/** Full-transcript turn count; falls back to the loaded length for legacy. */
export function turnsTotalOf(detail: DbConversationDetail | null): number {
  if (!detail) return 0
  return detail.turns_total ?? detail.turns.length
}

/** A detail response carrying the windowed protocol fields. */
export type WindowedConversationDetail = DbConversationDetail & {
  turns_offset: number
  turns_total: number
  prefix_hash: string
}

/**
 * True when the response carries the windowed protocol fields. Their absence
 * means a legacy full response (old server) — windowed merging, paging and
 * fingerprint gates must all disable themselves.
 */
export function isWindowedDetail(
  detail: DbConversationDetail | null
): detail is WindowedConversationDetail {
  return (
    detail != null &&
    detail.turns_offset != null &&
    detail.turns_total != null &&
    typeof detail.prefix_hash === "string"
  )
}

function fnv1aExtendByte(hash: bigint, byte: number): bigint {
  return ((hash ^ BigInt(byte & 0xff)) * FNV_PRIME) & U64_MASK
}

function roleTag(role: MessageTurn["role"]): number {
  switch (role) {
    case "user":
      return 0
    case "assistant":
      return 1
    case "system":
      return 2
  }
}

/**
 * Chain-extend a prefix fingerprint over `turns`, bit-for-bit equal to the
 * Rust implementation (`commands::turn_window::prefix_fingerprint`): per turn,
 * FNV-1a over the role tag byte then the timestamp epoch-millis as 8
 * little-endian bytes. Id-free on purpose — see the Rust doc comment.
 *
 * `seedHex` is a prior fingerprint (16-hex); pass [`FNV_SEED_HEX`] for an
 * empty prefix. Returns null when a timestamp fails to parse — callers treat
 * an uncomputable fingerprint as "cannot verify" (skip, never guess).
 */
export function extendPrefixFingerprint(
  seedHex: string,
  turns: readonly MessageTurn[]
): string | null {
  if (!/^[0-9a-f]{16}$/.test(seedHex)) return null
  let hash = BigInt(`0x${seedHex}`)
  for (const turn of turns) {
    const millis = Date.parse(turn.timestamp)
    if (!Number.isFinite(millis)) return null
    hash = fnv1aExtendByte(hash, roleTag(turn.role))
    // i64 little-endian bytes of the millisecond timestamp (BigInt.asUintN
    // maps the two's-complement view, matching Rust's to_le_bytes).
    let v = BigInt.asUintN(64, BigInt(millis))
    for (let i = 0; i < 8; i++) {
      hash = fnv1aExtendByte(hash, Number(v & 0xffn))
      v >>= 8n
    }
  }
  return hash.toString(16).padStart(16, "0")
}
