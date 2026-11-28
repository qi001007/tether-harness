import { describe, expect, it } from "vitest"

import {
  extendPrefixFingerprint,
  FNV_SEED_HEX,
  isWindowedDetail,
  turnsOffsetOf,
  turnsTotalOf,
} from "./turn-window"
import type { DbConversationDetail, MessageTurn } from "./types"

function turn(
  role: MessageTurn["role"],
  secs: number,
  id = `turn-${secs}`
): MessageTurn {
  return {
    id,
    role,
    blocks: [],
    timestamp: new Date(secs * 1000).toISOString(),
  }
}

describe("extendPrefixFingerprint", () => {
  // Shared Rust/TS test vector — must match
  // `commands::turn_window::tests::fingerprint_shared_test_vector`.
  it("matches the Rust implementation bit-for-bit", () => {
    expect(extendPrefixFingerprint(FNV_SEED_HEX, [])).toBe(FNV_SEED_HEX)
    const turns = [
      turn("user", 1_700_000_001),
      turn("assistant", 1_700_000_002),
      turn("system", 1_700_000_003),
    ]
    expect(extendPrefixFingerprint(FNV_SEED_HEX, turns.slice(0, 1))).toBe(
      "7060d8542023feb2"
    )
    expect(extendPrefixFingerprint(FNV_SEED_HEX, turns)).toBe(
      "f171a62320fc10d3"
    )
  })

  it("chains: extending stepwise equals extending at once", () => {
    const turns = [
      turn("user", 1_700_000_001),
      turn("assistant", 1_700_000_002),
      turn("system", 1_700_000_003),
    ]
    const step1 = extendPrefixFingerprint(FNV_SEED_HEX, turns.slice(0, 1))!
    const chained = extendPrefixFingerprint(step1, turns.slice(1))
    expect(chained).toBe(extendPrefixFingerprint(FNV_SEED_HEX, turns))
  })

  it("is id-free but order/timestamp sensitive", () => {
    const a = [turn("user", 1, "x"), turn("assistant", 2, "y")]
    const renamed = [turn("user", 1, "rewritten"), turn("assistant", 2, "z")]
    expect(extendPrefixFingerprint(FNV_SEED_HEX, a)).toBe(
      extendPrefixFingerprint(FNV_SEED_HEX, renamed)
    )
    const shifted = a.slice(1)
    expect(extendPrefixFingerprint(FNV_SEED_HEX, shifted)).not.toBe(
      extendPrefixFingerprint(FNV_SEED_HEX, a)
    )
  })

  it("returns null on malformed seed or timestamp", () => {
    expect(extendPrefixFingerprint("nope", [])).toBeNull()
    expect(
      extendPrefixFingerprint(FNV_SEED_HEX, [
        { ...turn("user", 1), timestamp: "not-a-date" },
      ])
    ).toBeNull()
  })
})

describe("window coordinate derivation", () => {
  const base = {
    summary: { message_count: 9 } as DbConversationDetail["summary"],
    turns: [turn("user", 1), turn("assistant", 2)],
  }

  it("legacy full response → offset 0, total = length, not windowed", () => {
    const detail = base as DbConversationDetail
    expect(turnsOffsetOf(detail)).toBe(0)
    expect(turnsTotalOf(detail)).toBe(2)
    expect(isWindowedDetail(detail)).toBe(false)
  })

  it("windowed response exposes its coordinates", () => {
    const detail = {
      ...base,
      turns_offset: 7,
      turns_total: 9,
      assistant_turns_before_offset: 3,
      prefix_hash: "00000000000000aa",
    } as DbConversationDetail
    expect(turnsOffsetOf(detail)).toBe(7)
    expect(turnsTotalOf(detail)).toBe(9)
    expect(isWindowedDetail(detail)).toBe(true)
  })

  it("null detail → zeros, not windowed", () => {
    expect(turnsOffsetOf(null)).toBe(0)
    expect(turnsTotalOf(null)).toBe(0)
    expect(isWindowedDetail(null)).toBe(false)
  })
})
