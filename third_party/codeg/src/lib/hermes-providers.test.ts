import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { HERMES_PROVIDERS } from "./types"

/**
 * The Hermes provider table is mirrored in two languages: the Rust source of
 * truth (`src-tauri/src/commands/acp.rs`, derived from Hermes' own auth.py
 * PROVIDER_REGISTRY) and this TS table the settings UI binds to. They must stay
 * in lockstep — a drift would let the panel offer a provider the backend rejects,
 * or map a key to the wrong `.env` variable. This test parses the Rust table and
 * asserts id/order/`needsBaseUrl`/key-presence parity.
 */
describe("HERMES_PROVIDERS Rust↔TS parity", () => {
  it("matches the backend HERMES_PROVIDERS table", () => {
    // vitest runs from the project root.
    const rustPath = join(process.cwd(), "src-tauri/src/commands/acp.rs")
    const rust = readFileSync(rustPath, "utf8")
    const start = rust.indexOf("const HERMES_PROVIDERS: &[HermesProvider] = &[")
    expect(start).toBeGreaterThan(-1)
    const end = rust.indexOf("\n];", start)
    expect(end).toBeGreaterThan(start)
    const block = rust.slice(start, end)

    const entry =
      /HermesProvider\s*\{\s*id:\s*"([^"]+)",\s*key_env_var:\s*"([^"]*)",\s*needs_base_url:\s*(true|false),\s*base_url_env_var:\s*"([^"]*)",\s*\}/g
    const rustRows = [...block.matchAll(entry)].map((m) => ({
      id: m[1],
      hasKey: m[2].length > 0,
      needsBaseUrl: m[3] === "true",
    }))

    expect(rustRows.length).toBe(HERMES_PROVIDERS.length)
    // Same ids in the same order.
    expect(rustRows.map((r) => r.id)).toEqual(HERMES_PROVIDERS.map((p) => p.id))

    // Per entry: `needsBaseUrl` matches, and an api-key provider carries a `.env`
    // key var while oauth / aws providers do not.
    for (const ts of HERMES_PROVIDERS) {
      const rs = rustRows.find((r) => r.id === ts.id)
      expect(rs, `Rust table is missing ${ts.id}`).toBeDefined()
      expect(rs!.needsBaseUrl, `${ts.id} needsBaseUrl`).toBe(ts.needsBaseUrl)
      if (ts.id === "custom") {
        // `custom` is the exception: an apiKey-kind provider whose key AND
        // endpoint live INLINE in config.yaml (model.api_key / model.base_url),
        // so it carries no `.env` key var. Every other apiKey provider maps to
        // a `.env` key.
        expect(rs!.hasKey, "custom has no .env key var").toBe(false)
      } else {
        expect(rs!.hasKey, `${ts.id} key presence`).toBe(ts.kind === "apiKey")
      }
    }
  })
})
