import { describe, expect, it } from "vitest"

import {
  buildCodeBuddyEnv,
  codeBuddyEnvironmentFromEnv,
  isValidCodeBuddyBaseUrl,
} from "./codebuddy-config-panel"

describe("codeBuddyEnvironmentFromEnv", () => {
  it("maps internal / ioa and defaults to overseas", () => {
    expect(codeBuddyEnvironmentFromEnv({})).toBe("overseas")
    expect(
      codeBuddyEnvironmentFromEnv({
        CODEBUDDY_INTERNET_ENVIRONMENT: "internal",
      })
    ).toBe("internal")
    expect(
      codeBuddyEnvironmentFromEnv({ CODEBUDDY_INTERNET_ENVIRONMENT: "ioa" })
    ).toBe("ioa")
  })

  it("is tolerant of case and surrounding whitespace", () => {
    expect(
      codeBuddyEnvironmentFromEnv({
        CODEBUDDY_INTERNET_ENVIRONMENT: " Internal ",
      })
    ).toBe("internal")
  })

  it("falls back to overseas for an unknown value", () => {
    expect(
      codeBuddyEnvironmentFromEnv({ CODEBUDDY_INTERNET_ENVIRONMENT: "mars" })
    ).toBe("overseas")
  })

  it("reports self_hosted whenever a base URL is set", () => {
    expect(
      codeBuddyEnvironmentFromEnv({
        CODEBUDDY_BASE_URL: "https://codebuddy.acme.com",
      })
    ).toBe("self_hosted")
  })

  it("lets the base URL win over CODEBUDDY_INTERNET_ENVIRONMENT", () => {
    expect(
      codeBuddyEnvironmentFromEnv({
        CODEBUDDY_BASE_URL: "https://codebuddy.acme.com",
        CODEBUDDY_INTERNET_ENVIRONMENT: "internal",
      })
    ).toBe("self_hosted")
  })

  it("ignores a blank base URL", () => {
    expect(codeBuddyEnvironmentFromEnv({ CODEBUDDY_BASE_URL: "   " })).toBe(
      "overseas"
    )
  })
})

describe("buildCodeBuddyEnv", () => {
  it("writes a trimmed API key and clears it when blank", () => {
    expect(buildCodeBuddyEnv({}, "sk-123", "overseas")).toEqual({
      CODEBUDDY_API_KEY: "sk-123",
    })
    expect(buildCodeBuddyEnv({}, "  sk-x  ", "overseas")).toEqual({
      CODEBUDDY_API_KEY: "sk-x",
    })
    expect(
      buildCodeBuddyEnv({ CODEBUDDY_API_KEY: "old" }, "   ", "overseas")
    ).toEqual({})
  })

  it("sets the environment var for China / iOA", () => {
    expect(buildCodeBuddyEnv({}, "k", "internal")).toEqual({
      CODEBUDDY_API_KEY: "k",
      CODEBUDDY_INTERNET_ENVIRONMENT: "internal",
    })
    expect(buildCodeBuddyEnv({}, "k", "ioa")).toEqual({
      CODEBUDDY_API_KEY: "k",
      CODEBUDDY_INTERNET_ENVIRONMENT: "ioa",
    })
  })

  it("DELETES the environment var for the overseas build (must be unset, not empty)", () => {
    expect(
      buildCodeBuddyEnv(
        { CODEBUDDY_INTERNET_ENVIRONMENT: "internal" },
        "k",
        "overseas"
      )
    ).toEqual({ CODEBUDDY_API_KEY: "k" })
  })

  it("preserves unrelated env keys", () => {
    expect(buildCodeBuddyEnv({ FOO: "bar" }, "k", "internal")).toEqual({
      FOO: "bar",
      CODEBUDDY_API_KEY: "k",
      CODEBUDDY_INTERNET_ENVIRONMENT: "internal",
    })
  })

  it("writes a trimmed, trailing-slash-stripped base URL for self_hosted and clears the region", () => {
    expect(
      buildCodeBuddyEnv(
        { CODEBUDDY_INTERNET_ENVIRONMENT: "internal" },
        "k",
        "self_hosted",
        "  https://codebuddy.acme.com/  "
      )
    ).toEqual({
      CODEBUDDY_API_KEY: "k",
      CODEBUDDY_BASE_URL: "https://codebuddy.acme.com",
    })
  })

  it("clears CODEBUDDY_BASE_URL when the self_hosted URL is blank", () => {
    expect(
      buildCodeBuddyEnv(
        { CODEBUDDY_BASE_URL: "https://old.example.com" },
        "k",
        "self_hosted",
        "   "
      )
    ).toEqual({ CODEBUDDY_API_KEY: "k" })
  })

  it("removes a stale base URL when switching away from self_hosted", () => {
    expect(
      buildCodeBuddyEnv(
        { CODEBUDDY_BASE_URL: "https://codebuddy.acme.com" },
        "k",
        "internal"
      )
    ).toEqual({
      CODEBUDDY_API_KEY: "k",
      CODEBUDDY_INTERNET_ENVIRONMENT: "internal",
    })
  })

  it("removes a stale base URL for the overseas build too", () => {
    expect(
      buildCodeBuddyEnv(
        { CODEBUDDY_BASE_URL: "https://codebuddy.acme.com" },
        "k",
        "overseas"
      )
    ).toEqual({ CODEBUDDY_API_KEY: "k" })
  })
})

describe("isValidCodeBuddyBaseUrl", () => {
  it("accepts http(s) URLs (ignoring surrounding whitespace)", () => {
    expect(isValidCodeBuddyBaseUrl("https://codebuddy.acme.com")).toBe(true)
    expect(isValidCodeBuddyBaseUrl("http://10.0.0.5:8080/v1")).toBe(true)
    expect(isValidCodeBuddyBaseUrl("  https://x.com  ")).toBe(true)
  })

  it("rejects blank, schemeless, or non-http(s) values", () => {
    expect(isValidCodeBuddyBaseUrl("")).toBe(false)
    expect(isValidCodeBuddyBaseUrl("   ")).toBe(false)
    expect(isValidCodeBuddyBaseUrl("codebuddy.acme.com")).toBe(false)
    expect(isValidCodeBuddyBaseUrl("ftp://codebuddy.acme.com")).toBe(false)
  })
})
